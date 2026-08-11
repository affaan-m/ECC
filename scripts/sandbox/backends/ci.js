'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { contractDigest, readBoundedRegularFile, validateReport } = require('../contracts');
const { buildAggregateReport, buildSingleReport, tailOutput } = require('../report');

const CI_WORKFLOW = 'sandbox-matrix.yml';
const MAX_EXEC_BUFFER = 1024 * 1024;
const MAX_ARTIFACT_FILES = 64;
const RUN_DISCOVERY_ATTEMPTS = 10;
const RUN_DISCOVERY_DELAY_MS = 2_000;

function defaultRunner(executable, argv, options = {}) {
  return spawnSync(executable, argv, {
    ...options,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: options.maxBuffer || MAX_EXEC_BUFFER,
  });
}

function defaultSleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function succeeded(result) {
  return !result.error && result.status === 0;
}

function commandDetail(result) {
  return tailOutput(
    [result.stderr, result.stdout, result.error?.message].filter(Boolean).join('\n'),
    50,
    4_000
  );
}

function firstLine(value) {
  return String(value || '').trim().split(/\r?\n/, 1)[0] || null;
}

function parseRunList(value) {
  const parsed = JSON.parse(String(value || ''));
  if (!Array.isArray(parsed)) throw new Error('GitHub run listing was not an array');
  return parsed;
}

function discoverRunId(run, options) {
  let diagnostic = 'workflow run has not appeared yet';
  for (let attempt = 0; attempt < RUN_DISCOVERY_ATTEMPTS; attempt += 1) {
    const listing = run('gh', [
      'run', 'list',
      '--repo', options.repository,
      '--workflow', CI_WORKFLOW,
      '--branch', options.ref,
      '--event', 'workflow_dispatch',
      '--limit', '20',
      '--json', 'databaseId,displayTitle,headSha',
    ], { cwd: options.gitRoot });
    if (succeeded(listing)) {
      try {
        const title = `ECC Sandbox ${options.correlation}`;
        const match = parseRunList(listing.stdout).find(candidate => (
          candidate.displayTitle === title
          && (!options.refSha || candidate.headSha === options.refSha)
          && Number.isSafeInteger(candidate.databaseId)
          && candidate.databaseId > 0
        ));
        if (match) return String(match.databaseId);
        diagnostic = `no run matched title ${title} and the dispatched ref`;
      } catch (error) {
        diagnostic = error.message;
      }
    } else {
      diagnostic = commandDetail(listing);
    }
    if (attempt + 1 < RUN_DISCOVERY_ATTEMPTS) options.sleep(RUN_DISCOVERY_DELAY_MS);
  }
  throw new Error(diagnostic);
}

function targetKey(target) {
  return `${target.os}/${target.arch}`;
}

function validateCiTranscript(report, manifest) {
  const expectedCommands = [...manifest.steps.setup, ...manifest.steps.assert];
  const actualCommands = report.steps.map(step => step.cmd);
  if (
    actualCommands.length > expectedCommands.length
    || actualCommands.some((command, index) => command !== expectedCommands[index])
  ) {
    throw new Error('CI report command transcript does not match the manifest prefix');
  }
  const firstFailure = report.steps.findIndex(step => step.exit !== 0);
  if (firstFailure !== -1 && firstFailure !== report.steps.length - 1) {
    throw new Error('CI report contains commands after its first failed step');
  }
  if (report.result === 'pass' && actualCommands.length !== expectedCommands.length) {
    throw new Error('passing CI report omitted manifest commands');
  }

  const assertionSteps = report.steps.slice(manifest.steps.setup.length);
  if (
    report.assertions.length !== assertionSteps.length
    || report.assertions.some((assertion, index) => (
      assertion.cmd !== assertionSteps[index].cmd
      || assertion.pass !== (assertionSteps[index].exit === 0)
    ))
  ) {
    throw new Error('CI report assertion evidence does not match its command transcript');
  }
}

function syntheticErrorChild(target, options, note) {
  return buildSingleReport({
    manifest: options.manifestPath,
    backend: 'ci-native',
    tier: 3,
    os: target.os,
    arch: target.arch,
    executionMode: options.executionMode,
    started: options.started,
    durationMs: 0,
    steps: [],
    assertions: [],
    executionError: true,
    notes: [tailOutput(note, 20, 4_000)],
  });
}

function reportFiles(root) {
  const files = [];
  const pending = [{ directory: path.resolve(root), depth: 0 }];
  while (pending.length > 0) {
    const { directory, depth } = pending.pop();
    if (depth > 4) throw new Error('CI artifact directory nesting exceeds four levels');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('CI artifacts must not contain symbolic links');
      if (entry.isDirectory()) pending.push({ directory: candidate, depth: depth + 1 });
      else if (entry.isFile() && entry.name === 'report.json') files.push(candidate);
      if (files.length > MAX_ARTIFACT_FILES) {
        throw new Error(`CI artifacts contain more than ${MAX_ARTIFACT_FILES} reports`);
      }
    }
  }
  return files.sort();
}

function collectCiReports(directory, expectedTargets, options) {
  if (!options.expectedManifest) {
    throw new Error('CI artifact validation requires the expected manifest contract');
  }
  const expectedManifestDigest = contractDigest(options.expectedManifest);
  const expected = new Map(expectedTargets.map(target => [targetKey(target), target]));
  const reports = new Map();
  const notes = [];
  let integrityFailure = null;
  try {
    for (const reportPath of reportFiles(directory)) {
      const report = validateReport(JSON.parse(
        readBoundedRegularFile(reportPath, 'CI sandbox report')
      ));
      const key = targetKey(report);
      const manifestNotes = report.notes.filter(note => note.startsWith('manifest_sha256='));
      if (
        report.backend !== 'ci-native'
        || report.tier !== 3
        || report.execution_mode !== options.executionMode
        || (options.requireNoEscalations === true && report.escalations.length !== 0)
        || !expected.has(key)
        || reports.has(key)
      ) {
        throw new Error(`unexpected or duplicate CI report target: ${key}`);
      }
      if (
        manifestNotes.length !== 1
        || manifestNotes[0] !== `manifest_sha256=${expectedManifestDigest}`
      ) {
        throw new Error(`CI report manifest digest mismatch for ${key}`);
      }
      validateCiTranscript(report, options.expectedManifest);
      reports.set(key, validateReport({ ...report, manifest: options.manifestPath }));
    }
  } catch (error) {
    integrityFailure = error.message;
  }

  if (integrityFailure) {
    notes.push(`CI artifact validation failed closed: ${tailOutput(integrityFailure, 10, 2_000)}`);
    return {
      children: expectedTargets.map(target => syntheticErrorChild(
        target,
        options,
        `CI artifact integrity failure: ${integrityFailure}`
      )),
      notes,
    };
  }

  const children = expectedTargets.map(target => {
    const key = targetKey(target);
    return reports.get(key) || syntheticErrorChild(
      target,
      options,
      `CI report artifact is missing for ${key}`
    );
  });
  notes.push(`ci_reports_collected=${reports.size}/${expectedTargets.length}`);
  return { children, notes };
}

function buildOutcome(targets, options, children, notes, startedMs) {
  const report = buildAggregateReport({
    manifest: options.manifestPath,
    venue: 'ci',
    started: options.started,
    durationMs: options.clock() - startedMs,
    children,
    notes,
  });
  return {
    report,
    exitCode: report.result === 'pass' ? 0 : (report.result === 'fail' ? 1 : 2),
    targets,
  };
}

function executeCi(manifest, targets, options = {}) {
  const run = options.run || defaultRunner;
  const sleep = options.sleep || defaultSleep;
  const clock = options.clock || (() => Date.now());
  const startedMs = clock();
  const started = new Date(startedMs).toISOString();
  const executionMode = options.mock ? 'mock' : 'real';
  const baseOptions = {
    ...options,
    clock,
    executionMode,
    expectedManifest: manifest,
    started,
  };
  const fail = note => buildOutcome(
    targets,
    baseOptions,
    targets.map(target => syntheticErrorChild(target, baseOptions, note)),
    [tailOutput(note, 20, 4_000)],
    startedMs
  );
  if (targets.length === 0) throw new Error('CI dispatch has no target shards');

  let gitRoot = options.gitRoot;
  if (!gitRoot) {
    const rootResult = run('git', ['rev-parse', '--show-toplevel'], { cwd: options.cwd });
    if (!succeeded(rootResult)) {
      return fail(`Cannot resolve repository root: ${commandDetail(rootResult)}`);
    }
    gitRoot = firstLine(rootResult.stdout);
  }
  const relativeManifest = path.relative(path.resolve(gitRoot), path.resolve(options.manifestPath));
  if (
    !relativeManifest
    || relativeManifest.startsWith('..')
    || path.isAbsolute(relativeManifest)
  ) {
    return fail('CI manifests must be regular files inside the current Git repository');
  }
  const manifestInput = relativeManifest.split(path.sep).join('/');

  if (!options.mock) {
    const tracked = run('git', ['ls-files', '--error-unmatch', '--', relativeManifest], {
      cwd: gitRoot,
    });
    const unstaged = run('git', ['diff', '--quiet', '--', relativeManifest], { cwd: gitRoot });
    const staged = run('git', ['diff', '--cached', '--quiet', '--', relativeManifest], {
      cwd: gitRoot,
    });
    if (!succeeded(tracked) || !succeeded(unstaged) || !succeeded(staged)) {
      return fail('CI manifest must be tracked, committed, and unchanged at the dispatched ref');
    }
  }

  let repository = options.repository;
  if (!repository) {
    const repositoryResult = run('gh', [
      'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner',
    ], { cwd: gitRoot });
    if (!succeeded(repositoryResult)) {
      return fail(`Cannot resolve GitHub repository: ${commandDetail(repositoryResult)}`);
    }
    repository = firstLine(repositoryResult.stdout);
  }
  let ref = options.ref;
  if (!ref) {
    const refResult = run('git', ['branch', '--show-current'], { cwd: gitRoot });
    if (!succeeded(refResult) || !firstLine(refResult.stdout)) {
      return fail('CI dispatch requires a named branch; set ECC_SANDBOX_CI_REF');
    }
    ref = firstLine(refResult.stdout);
  }

  const auth = run('gh', ['auth', 'status', '--hostname', 'github.com'], { cwd: gitRoot });
  if (!succeeded(auth)) {
    return fail('GitHub CLI authentication is unavailable — run: gh auth login');
  }
  let refSha = null;
  if (!options.mock) {
    const localHead = run('git', ['rev-parse', 'HEAD'], { cwd: gitRoot });
    const remoteHead = run('gh', [
      'api',
      '--method', 'GET',
      `repos/${repository}/commits/${encodeURIComponent(ref)}`,
      '--jq', '.sha',
    ], { cwd: gitRoot });
    if (!succeeded(localHead) || !succeeded(remoteHead)) {
      return fail(
        `Cannot bind the dispatched ref to local HEAD — push ${ref} to ${repository} and retry`
      );
    }
    const localSha = firstLine(localHead.stdout);
    refSha = firstLine(remoteHead.stdout);
    if (!/^[0-9a-f]{40}$/i.test(localSha || '') || localSha !== refSha) {
      return fail(
        `Dispatched ref ${repository}@${ref} does not resolve to local HEAD — push the exact commit and retry`
      );
    }
  }
  const correlation = options.correlation || `ecc-${crypto.randomBytes(12).toString('hex')}`;
  const manifestSha256 = contractDigest(manifest);
  const osTargets = [...new Set(targets.map(target => target.os))].sort();
  const targetInputs = targets.map(targetKey).sort();
  const dispatch = run('gh', [
    'workflow', 'run', CI_WORKFLOW,
    '--repo', repository,
    '--ref', ref,
    '-f', `manifest=${manifestInput}`,
    '-f', `os=${JSON.stringify(osTargets)}`,
    '-f', `targets=${JSON.stringify(targetInputs)}`,
    '-f', `correlation=${correlation}`,
    '-f', `manifest_sha256=${manifestSha256}`,
  ], { cwd: gitRoot });
  if (!succeeded(dispatch)) {
    return fail(`CI workflow dispatch failed: ${commandDetail(dispatch)}`);
  }
  let runId = `${dispatch.stdout || ''}\n${dispatch.stderr || ''}`
    .match(/\/actions\/runs\/(\d+)/)?.[1];
  if (!runId) {
    try {
      runId = discoverRunId(run, {
        correlation,
        gitRoot,
        ref,
        refSha,
        repository,
        sleep,
      });
    } catch (error) {
      return fail(`Cannot locate the dispatched CI workflow run: ${error.message}`);
    }
  }

  const watch = run('gh', [
    'run', 'watch', runId,
    '--repo', repository,
    '--compact',
    '--exit-status',
  ], {
    cwd: gitRoot,
    timeout: (manifest.resources.timeout + 600) * 1000,
  });
  const ownedArtifactDirectory = !options.artifactDirectory;
  const artifactDirectory = options.artifactDirectory
    ? path.resolve(options.artifactDirectory)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-sandbox-ci-'));
  let collected;
  try {
    const download = run('gh', [
      'run', 'download', runId,
      '--repo', repository,
      '--pattern', `sandbox-${correlation}-*`,
      '--dir', artifactDirectory,
    ], { cwd: gitRoot, timeout: 120_000 });
    if (!succeeded(download)) {
      collected = {
        children: targets.map(target => syntheticErrorChild(
          target,
          baseOptions,
          `CI artifact download failed: ${commandDetail(download)}`
        )),
        notes: [`CI artifact download failed: ${commandDetail(download)}`],
      };
    } else {
      collected = collectCiReports(artifactDirectory, targets, baseOptions);
    }
  } finally {
    if (ownedArtifactDirectory) {
      fs.rmSync(artifactDirectory, { recursive: true, force: true });
    }
  }

  const notes = [
    `ci_run_id=${runId}`,
    `ci_repository=${repository}`,
    `ci_ref=${ref}`,
    'ci_execution=forced-native',
    ...(refSha ? [`ci_ref_sha=${refSha}`] : []),
    ...collected.notes,
  ];
  if (!succeeded(watch)) {
    notes.push(`CI workflow completed non-successfully: ${commandDetail(watch)}`);
    if (collected.children.every(child => child.result === 'pass')) {
      const [first, ...rest] = collected.children;
      collected.children = [validateReport({
        ...first,
        result: 'error',
        notes: [...first.notes, 'CI workflow failed outside the sandbox command'],
      }), ...rest];
    }
  }
  if (options.mock) notes.push('Mock CI orchestration: no workflow was dispatched');
  return buildOutcome(targets, baseOptions, collected.children, notes, startedMs);
}

module.exports = {
  CI_WORKFLOW,
  MAX_ARTIFACT_FILES,
  MAX_EXEC_BUFFER,
  RUN_DISCOVERY_ATTEMPTS,
  RUN_DISCOVERY_DELAY_MS,
  collectCiReports,
  commandDetail,
  defaultSleep,
  defaultRunner,
  discoverRunId,
  executeCi,
  reportFiles,
  syntheticErrorChild,
  targetKey,
  validateCiTranscript,
};
