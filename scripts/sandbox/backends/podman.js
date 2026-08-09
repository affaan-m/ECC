'use strict';

const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  buildSingleReport,
  emptyInstallDiff,
  normalizeStep,
  tailOutput,
} = require('../report');

const DEFAULT_IMAGE = 'localhost/ecc-sandbox:ubuntu-lts';
const MAX_EXEC_BUFFER = 1024 * 1024;
const MAX_DIFF_BUFFER = 16 * 1024 * 1024;
const MAX_DIFF_ITEMS = 1_000;
const CLEANUP_TIMEOUT_MS = 30_000;

function defaultRunner(executable, argv, options = {}) {
  return spawnSync(executable, argv, {
    ...options,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: options.maxBuffer || MAX_EXEC_BUFFER,
  });
}

function succeeded(result) {
  return !result.error && result.status === 0;
}

function firstLine(value) {
  return String(value || '').trim().split(/\r?\n/, 1)[0] || null;
}

function resultDetail(result) {
  return tailOutput([result.stderr, result.stdout, result.error?.message]
    .filter(Boolean)
    .join('\n')
    .trim(), 50, 4_000);
}

function hasOpenNetwork(manifest) {
  return manifest.needs.capabilities.includes('network:*');
}

function buildCreateArgs(manifest, options) {
  // DECISION: conventions items 20-21 keep the host source read-only and
  // reserve in-container sudo for first-party work inside a rootless runtime.
  const args = [
    'create',
    '--name', options.containerName,
    '--cap-drop', 'ALL',
    '--pids-limit', '256',
    '--cpus', String(manifest.resources.cpu),
    '--memory', manifest.resources.memory.toLowerCase(),
    '--tmpfs', '/tmp:rw,nosuid,nodev,exec,size=256m',
    '--volume', `${path.resolve(options.cwd)}:/workspace/source:ro`,
    '--workdir', '/workspace',
    '--user', '1000:1000',
    '--hostname', 'ecc-sandbox',
  ];
  if (manifest.needs.trust === 'untrusted') {
    args.push('--security-opt', 'no-new-privileges');
  }
  if (!hasOpenNetwork(manifest)) args.push('--network', 'none');
  args.push(options.image, 'sleep', 'infinity');
  return args;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function bounded(values) {
  const sorted = uniqueSorted(values);
  return { values: sorted.slice(0, MAX_DIFF_ITEMS), truncated: sorted.length > MAX_DIFF_ITEMS };
}

function parseContainerDiff(output, method = 'podman-layer') {
  const changes = { A: [], C: [], D: [] };
  let malformed = false;
  for (const line of String(output || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^([ACD])\s+(.+)$/);
    if (!match || !match[2].startsWith('/') || match[2].length > 4_096) {
      malformed = true;
      continue;
    }
    changes[match[1]].push(match[2]);
  }

  const added = bounded(changes.A);
  const changed = bounded(changes.C);
  const deleted = bounded(changes.D);
  const touched = uniqueSorted([...changes.A, ...changes.C, ...changes.D]);
  const present = uniqueSorted([...changes.A, ...changes.C]);
  const pathChanges = bounded(touched.filter(filePath => (
    /^\/(?:usr\/)?(?:local\/)?bin\//.test(filePath)
    || /^\/home\/[^/]+\/\.local\/bin\//.test(filePath)
  )));
  const services = bounded(present.filter(filePath => (
    /\/(?:systemd\/system|init\.d|rc\.d)\//.test(filePath)
  )));
  const dotfiles = bounded(touched.flatMap(filePath => {
    const match = filePath.match(/^(\/(?:home\/[^/]+|root)\/\.[^/]+)(?:\/|$)/);
    return match ? [match[1]] : [];
  }));
  const truncated = [added, changed, deleted, pathChanges, services, dotfiles]
    .some(entry => entry.truncated);

  return {
    diff: {
      method,
      complete: !malformed && !truncated,
      files_added: added.values,
      files_changed: changed.values,
      files_deleted: deleted.values,
      path_changes: pathChanges.values,
      services_registered: services.values,
      dotfiles_touched: dotfiles.values,
    },
    malformed,
    truncated,
  };
}

function imageCheckArgs(runtime, image) {
  return ['image', 'inspect', '--format', '{{.Id}}', image];
}

function podmanInfoIsRootless(result) {
  if (!succeeded(result)) return false;
  try {
    return JSON.parse(result.stdout)?.host?.security?.rootless === true;
  } catch {
    return false;
  }
}

function missingContainer(result) {
  return /(?:no such container|container .* not found|does not exist)/i.test(resultDetail(result));
}

function imageBuildFix(runtime) {
  const imageRoot = path.resolve(__dirname, '..', '..', '..', 'images', 'sandbox');
  return `${runtime} build --file "${path.join(imageRoot, 'Containerfile.ubuntu')}" --tag ${DEFAULT_IMAGE} "${imageRoot}"`;
}

function executeContainer(manifest, options = {}) {
  const runtime = options.runtime || 'podman';
  if (!['podman', 'docker'].includes(runtime)) {
    throw new Error(`Unsupported Tier 1 runtime: ${runtime}`);
  }
  const cwd = path.resolve(options.cwd || process.cwd());
  const image = options.image || DEFAULT_IMAGE;
  const containerName = options.containerName
    || `ecc-sandbox-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const run = options.run || defaultRunner;
  const clock = options.clock || (() => Date.now());
  const startedMs = clock();
  const started = new Date(startedMs).toISOString();
  const deadline = startedMs + (manifest.resources.timeout * 1000);
  const steps = [];
  const assertions = [];
  const notes = [...(options.notes || [])];
  let installDiff = emptyInstallDiff();
  let createAttempted = false;
  let created = false;
  let executionError = false;
  let cleanupSucceeded = false;
  let unsafeToDiff = false;

  const invoke = (argv, maxBuffer = MAX_EXEC_BUFFER, timeout) => run(runtime, argv, {
    cwd,
    timeout: timeout || Math.max(1, deadline - clock()),
    maxBuffer,
  });

  let runtimeReady = true;
  if (runtime === 'podman') {
    const info = invoke(['info', '--format', 'json']);
    runtimeReady = podmanInfoIsRootless(info);
    if (!runtimeReady) {
      executionError = true;
      notes.push(
        "Podman is not confirmed rootless — run as an unprivileged user and verify: podman info --format '{{.Host.Security.Rootless}}'"
      );
    }
  }

  const imageResult = runtimeReady
    ? invoke(imageCheckArgs(runtime, image))
    : { status: null, stdout: '', stderr: '', error: null };
  const imageId = firstLine(imageResult.stdout);
  if (runtimeReady && (!succeeded(imageResult) || !imageId)) {
    executionError = true;
    notes.push(
      `${runtime} image ${image} is unavailable — build the pinned snapshot: ${imageBuildFix(runtime)}`
    );
    const detail = resultDetail(imageResult);
    if (detail) notes.push(`${runtime} image check: ${detail}`);
  } else if (runtimeReady) {
    notes.push(`image_ref=${image}`);
    notes.push(`image_id=${imageId}`);
    createAttempted = true;
    const createResult = invoke(buildCreateArgs(manifest, {
      containerName,
      cwd,
      // Use the inspected immutable ID, not the mutable reference, so the
      // evidence and executed snapshot cannot diverge through a retag race.
      image: imageId,
    }));
    if (!succeeded(createResult)) {
      executionError = true;
      notes.push(`${runtime} create failed: ${resultDetail(createResult) || 'unknown error'}`);
    } else {
      created = true;
      const startMs = clock();
      const startResult = invoke(['start', containerName]);
      const containerStartMs = Math.max(0, clock() - startMs);
      notes.push(`container_start_ms=${containerStartMs}`);
      if (!succeeded(startResult)) {
        executionError = true;
        notes.push(`${runtime} start failed: ${resultDetail(startResult) || 'unknown error'}`);
      } else {
        const execute = (command, assertion) => {
          const execution = invoke([
            'exec',
            containerName,
            '/bin/bash',
            '-lc',
            command,
          ]);
          const step = normalizeStep(command, execution);
          steps.push(step);
          if (assertion) assertions.push({ cmd: command, pass: step.exit === 0 });
          if (execution.error || execution.status === null) {
            executionError = true;
            const stop = invoke(
              ['stop', '--time', '0', containerName],
              MAX_EXEC_BUFFER,
              CLEANUP_TIMEOUT_MS
            );
            if (succeeded(stop)) {
              notes.push(`${runtime} stopped the container after an indeterminate or timed-out exec`);
            } else {
              unsafeToDiff = true;
              notes.push(`${runtime} could not stop the container after exec failure; diff skipped before forced cleanup`);
            }
          }
          return step.exit === 0;
        };

        let setupPassed = true;
        for (const command of manifest.steps.setup) {
          if (!execute(command, false)) {
            setupPassed = false;
            break;
          }
        }
        if (setupPassed) {
          for (const command of manifest.steps.assert) {
            if (!execute(command, true)) break;
          }
        }

        if (manifest.report === 'install-diff' && !unsafeToDiff) {
          const diffResult = invoke(
            ['diff', containerName],
            MAX_DIFF_BUFFER,
            CLEANUP_TIMEOUT_MS
          );
          if (succeeded(diffResult)) {
            const parsed = parseContainerDiff(diffResult.stdout, `${runtime}-layer`);
            installDiff = parsed.diff;
            notes.push(`${runtime} diff reports changed filesystem paths, including directories`);
            if (parsed.malformed) notes.push(`${runtime} diff contained malformed lines; evidence is incomplete`);
            if (parsed.truncated) notes.push(`install diff exceeded ${MAX_DIFF_ITEMS} entries; evidence is truncated`);
            if (!parsed.diff.complete) executionError = true;
          } else {
            executionError = true;
            notes.push(`${runtime} diff failed: ${resultDetail(diffResult) || 'unknown error'}`);
          }
        }
      }
    }
  }

  if (createAttempted) {
    const cleanup = invoke(
      ['rm', '--force', containerName],
      MAX_EXEC_BUFFER,
      CLEANUP_TIMEOUT_MS
    );
    cleanupSucceeded = succeeded(cleanup) || (!created && missingContainer(cleanup));
    if (!cleanupSucceeded) {
      executionError = true;
      notes.push(
        `${runtime} cleanup failed for ${containerName} — remove it manually: ${runtime} rm --force ${containerName}`
      );
    }
  }
  if (options.mock) notes.push(`Mock ${runtime} execution: no container was created`);

  const report = buildSingleReport({
    manifest: options.manifestPath,
    backend: runtime,
    tier: 1,
    os: 'linux',
    arch: options.arch,
    executionMode: options.mock ? 'mock' : 'real',
    started,
    durationMs: clock() - startedMs,
    steps,
    assertions,
    installDiff,
    executionError,
    notes,
  });
  return {
    report,
    exitCode: report.result === 'pass' ? 0 : (report.result === 'fail' ? 1 : 2),
    cleanup: { attempted: createAttempted, pass: cleanupSucceeded, container: containerName },
  };
}

module.exports = {
  DEFAULT_IMAGE,
  CLEANUP_TIMEOUT_MS,
  MAX_DIFF_BUFFER,
  MAX_DIFF_ITEMS,
  buildCreateArgs,
  defaultRunner,
  executeContainer,
  hasOpenNetwork,
  imageBuildFix,
  parseContainerDiff,
  podmanInfoIsRootless,
};
