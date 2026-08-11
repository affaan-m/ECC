'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  contractDigest,
  loadManifest,
  validateManifest,
  validateReport,
} = require('../../scripts/sandbox/contracts');
const { probeCapabilities } = require('../../scripts/sandbox/probe');
const { defaultHost, routeManifest } = require('../../scripts/sandbox/router');
const { buildAggregateReport, buildSingleReport } = require('../../scripts/sandbox/report');
const {
  executeCiNative,
  nativeCommand,
  sanitizeCiEnvironment,
} = require('../../scripts/sandbox/backends/ci-native');
const { collectCiReports, executeCi } = require('../../scripts/sandbox/backends/ci');
const {
  appendExecutionReport,
  executeWithEscalation,
} = require('../../scripts/sandbox/ecc-sandbox');

const repoRoot = path.join(__dirname, '..', '..');
const cliPath = path.join(repoRoot, 'scripts', 'sandbox', 'ecc-sandbox');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.stack || error.message}`);
    failed += 1;
  }
}

function manifest(overrides = {}) {
  return validateManifest({
    name: 'ci-test',
    needs: {
      os: overrides.os || ['linux'],
      capabilities: overrides.capabilities || ['network:*'],
      trust: overrides.trust || 'first-party',
      native: overrides.native ?? true,
    },
    resources: { cpu: 1, memory: '256MB', timeout: 30 },
    steps: {
      setup: overrides.setup || ['printf setup'],
      assert: overrides.assert || ['printf assert'],
    },
    report: overrides.report || 'exit-only',
  });
}

function result(status, stdout = '', stderr = '', error = null) {
  return { status, stdout, stderr, error };
}

function childReport(target, manifestPath, executionMode = 'mock', expectedManifest = manifest()) {
  return buildSingleReport({
    manifest: manifestPath,
    backend: 'ci-native',
    tier: 3,
    os: target.os,
    arch: target.arch,
    executionMode,
    started: '2026-08-08T12:00:00.000Z',
    durationMs: 10,
    steps: [
      { cmd: expectedManifest.steps.setup[0], exit: 0, stdout_tail: 'setup', stderr_tail: '' },
      { cmd: expectedManifest.steps.assert[0], exit: 0, stdout_tail: 'assert', stderr_tail: '' },
    ],
    assertions: [{ cmd: expectedManifest.steps.assert[0], pass: true }],
    notes: [`manifest_sha256=${contractDigest(expectedManifest)}`],
  });
}

function writeArtifact(root, target, report) {
  const directory = path.join(root, `sandbox-test-${target.os}-${target.arch}`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report));
}

console.log('\n=== ECC sandbox CI tests ===\n');

test('gates ci-native capability on the explicit GitHub workflow environment', () => {
  const base = {
    platform: 'linux',
    architecture: 'x64',
    cpus: 2,
    now: new Date('2026-08-08T12:00:00.000Z'),
    run: () => result(null, '', '', new Error('missing')),
    fileExists: () => false,
    readFile: () => '',
    canAccess: () => false,
  };
  const unavailable = probeCapabilities({ ...base, env: {} });
  assert.strictEqual(unavailable.backends['ci-native'].available, false);
  const ready = probeCapabilities({
    ...base,
    env: { GITHUB_ACTIONS: 'true', ECC_SANDBOX_CI_NATIVE: '1' },
  });
  assert.strictEqual(ready.backends['ci-native'].available, true);
  assert.deepStrictEqual(ready.backends['ci-native'].targets, [
    { os: 'linux', arch: 'x86_64' },
  ]);
});

test('routes native local-only work to an explicitly enabled CI runner', () => {
  const testManifest = manifest();
  const capabilities = {
    schema_version: 1,
    host: { os: 'linux', arch: 'x86_64' },
    backends: {
      'ci-native': {
        available: true,
        targets: [{ os: 'linux', arch: 'x86_64' }],
      },
    },
  };
  const decision = routeManifest(testManifest, capabilities, { localOnly: true });
  assert.strictEqual(decision.routes[0].backend, 'ci-native');
  assert.strictEqual(decision.routes[0].tier, 3);
});

test('prefers the gated CI runner over incidental VM tools on its image', () => {
  const testManifest = manifest();
  const capabilities = {
    schema_version: 1,
    host: { os: 'linux', arch: 'x86_64' },
    backends: {
      lima: {
        available: true,
        targets: [{ os: 'linux', arch: 'x86_64' }],
      },
      'ci-native': {
        available: true,
        targets: [{ os: 'linux', arch: 'x86_64' }],
      },
    },
  };
  const decision = routeManifest(testManifest, capabilities, { localOnly: true });
  assert.strictEqual(decision.routes[0].backend, 'ci-native');
});

test('forced matrix routing bypasses Tier 1 without changing a non-native manifest', () => {
  const testManifest = manifest({
    capabilities: ['clean-home', 'network:*'],
    native: false,
    setup: ['systemctl start ecc-demo'],
    assert: ['systemctl is-active ecc-demo'],
  });
  const capabilities = {
    schema_version: 1,
    host: { os: 'linux', arch: 'x86_64' },
    backends: {
      podman: { available: true, targets: [{ os: 'linux', arch: 'x86_64' }] },
      'ci-native': {
        available: true,
        targets: [{ os: 'linux', arch: 'x86_64' }],
      },
    },
  };
  assert.strictEqual(
    routeManifest(testManifest, capabilities, { localOnly: true }).routes[0].backend,
    'podman'
  );
  const forced = routeManifest(testManifest, capabilities, {
    forceCiNative: true,
    localOnly: true,
  });
  assert.strictEqual(forced.routes[0].backend, 'ci-native');
  assert.deepStrictEqual(testManifest.steps, {
    setup: ['systemctl start ecc-demo'],
    assert: ['systemctl is-active ecc-demo'],
  });
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'sandbox-matrix.yml'),
    'utf8'
  );
  assert.match(workflow, /ECC_SANDBOX_CI_FORCE_NATIVE: '1'/);
});

test('shard selection runs exactly one declared target and rejects an undeclared target', () => {
  const testManifest = manifest({ os: ['all'] });
  const capabilities = {
    schema_version: 1,
    host: { os: 'linux', arch: 'x86_64' },
    backends: {
      'ci-native': {
        available: true,
        targets: [{ os: 'linux', arch: 'x86_64' }],
      },
    },
  };
  const decision = routeManifest(testManifest, capabilities, {
    localOnly: true,
    shard: { os: 'linux', arch: 'x86_64' },
  });
  assert.strictEqual(decision.routes.length, 1);
  assert.throws(() => routeManifest(testManifest, capabilities, {
    shard: { os: 'linux', arch: 'arm64' },
  }), /not declared/);
});

test('executes declared commands through the native shell with a sanitized environment', () => {
  const calls = [];
  const results = [result(0, 'setup'), result(0, 'assert')];
  const outcome = executeCiNative(manifest(), {
    arch: 'x86_64',
    cwd: repoRoot,
    env: {
      GITHUB_ACTIONS: 'true',
      ECC_SANDBOX_CI_NATIVE: '1',
      PATH: process.env.PATH,
      CUSTOM_FLAG: 'do-not-pass-either',
      DEMO_SECRET_TOKEN: 'do-not-pass',
    },
    manifestPath: path.join(repoRoot, 'sandbox.yaml'),
    mock: true,
    os: 'linux',
    platform: 'linux',
    run: (executable, argv, options) => {
      calls.push({ executable, argv, options });
      return results[calls.length - 1];
    },
  });
  assert.strictEqual(validateReport(outcome.report), outcome.report);
  assert.strictEqual(outcome.report.result, 'pass');
  assert.ok(outcome.report.notes.includes(`manifest_sha256=${contractDigest(manifest())}`));
  assert.deepStrictEqual(calls.map(call => call.executable), ['/bin/bash', '/bin/bash']);
  assert.strictEqual(calls[0].options.env.CUSTOM_FLAG, undefined);
  assert.strictEqual(calls[0].options.env.DEMO_SECRET_TOKEN, undefined);
  assert.strictEqual(calls[0].options.env.ECC_SANDBOX_TARGET_OS, 'linux');
  assert.deepStrictEqual(nativeCommand('Get-Date', 'win32'), {
    executable: 'powershell.exe',
    argv: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Get-Date'],
  });
  assert.strictEqual(sanitizeCiEnvironment({ API_TOKEN: 'x', PATH: 'y' }).API_TOKEN, undefined);
});

test('refuses direct ci-native execution without the explicit workflow gate', () => {
  let calls = 0;
  const outcome = executeCiNative(manifest(), {
    arch: 'x86_64',
    cwd: repoRoot,
    env: { GITHUB_ACTIONS: 'true' },
    manifestPath: path.join(repoRoot, 'sandbox.yaml'),
    os: 'linux',
    platform: 'linux',
    run: () => {
      calls += 1;
      return result(0);
    },
  });
  assert.strictEqual(calls, 0);
  assert.strictEqual(outcome.exitCode, 2);
  assert.strictEqual(outcome.report.result, 'error');
  assert.match(outcome.report.notes[0], /restricted to the ECC sandbox matrix workflow/);
});

test('builds and validates one deterministic aggregate report', () => {
  const targets = [
    { os: 'windows', arch: 'x86_64' },
    { os: 'linux', arch: 'x86_64' },
  ];
  const aggregate = buildAggregateReport({
    manifest: '/repo/sandbox.yaml',
    venue: 'ci',
    started: '2026-08-08T12:00:00.000Z',
    durationMs: 20,
    children: targets.map(target => childReport(target, '/runner/sandbox.yaml')),
  });
  assert.strictEqual(validateReport(aggregate), aggregate);
  assert.deepStrictEqual(aggregate.children.map(child => child.os), ['linux', 'windows']);
  assert.strictEqual(aggregate.result, 'pass');
});

test('run aggregation flattens a container-to-CI result and lifts its escalation', () => {
  const nested = buildAggregateReport({
    manifest: '/repo/sandbox.yaml',
    venue: 'ci',
    started: '2026-08-08T12:00:00.000Z',
    durationMs: 20,
    escalations: [{
      from: 'podman',
      reason: 'container systemd failure requires native OS behavior',
      to: 'ci',
    }],
    children: [childReport({ os: 'linux', arch: 'x86_64' }, '/runner/sandbox.yaml')],
    notes: ['nested-ci-note'],
  });
  const local = buildSingleReport({
    manifest: '/repo/sandbox.yaml',
    backend: 'srt',
    tier: 0,
    os: 'macos',
    arch: 'arm64',
    executionMode: 'mock',
    started: '2026-08-08T12:00:00.000Z',
    durationMs: 1,
    steps: [{ cmd: 'printf local', exit: 0, stdout_tail: 'local', stderr_tail: '' }],
    assertions: [],
    notes: [],
  });
  const state = { children: [], escalations: [], notes: [], usedCi: false };
  appendExecutionReport(nested, state);
  appendExecutionReport(local, state);
  const outer = buildAggregateReport({
    manifest: '/repo/sandbox.yaml',
    venue: state.usedCi ? 'mixed' : 'local',
    started: '2026-08-08T12:00:00.000Z',
    durationMs: 21,
    children: state.children,
    escalations: state.escalations,
    notes: state.notes,
  });
  assert.strictEqual(validateReport(outer), outer);
  assert.strictEqual(outer.venue, 'mixed');
  assert.strictEqual(outer.children.length, 2);
  assert.ok(outer.children.every(child => child.backend !== 'aggregate'));
  assert.strictEqual(outer.escalations.length, 1);
  assert.ok(outer.notes.includes('nested-ci-note'));
});

test('collects expected reports and synthesizes a missing-target error', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ci-artifacts-'));
  try {
    const targets = [
      { os: 'linux', arch: 'x86_64' },
      { os: 'windows', arch: 'x86_64' },
    ];
    writeArtifact(tempRoot, targets[0], childReport(targets[0], '/runner/sandbox.yaml'));
    const collected = collectCiReports(tempRoot, targets, {
      executionMode: 'mock',
      expectedManifest: manifest(),
      manifestPath: '/repo/sandbox.yaml',
      started: '2026-08-08T12:00:00.000Z',
    });
    assert.strictEqual(collected.children[0].manifest, '/repo/sandbox.yaml');
    assert.strictEqual(collected.children.filter(child => child.result === 'error').length, 1);
    assert.match(collected.children.find(child => child.result === 'error').notes[0], /missing/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('fails closed on substituted, duplicate, or symbolic-link artifacts', () => {
  const expected = [{ os: 'linux', arch: 'x86_64' }];
  const options = {
    executionMode: 'mock',
    expectedManifest: manifest(),
    manifestPath: '/repo/sandbox.yaml',
    started: '2026-08-08T12:00:00.000Z',
  };
  for (const variant of ['substituted', 'duplicate', 'symlink']) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ecc-ci-${variant}-`));
    try {
      if (variant === 'substituted') {
        const target = { os: 'macos', arch: 'x86_64' };
        writeArtifact(tempRoot, target, childReport(target, '/runner/sandbox.yaml'));
      } else {
        writeArtifact(tempRoot, expected[0], childReport(expected[0], '/runner/sandbox.yaml'));
        if (variant === 'duplicate') {
          const second = path.join(tempRoot, 'second');
          fs.mkdirSync(second);
          fs.writeFileSync(
            path.join(second, 'report.json'),
            JSON.stringify(childReport(expected[0], '/runner/sandbox.yaml'))
          );
        } else {
          fs.symlinkSync(path.join(tempRoot, 'sandbox-test-linux-x86_64'), path.join(tempRoot, 'alias'));
        }
      }
      const collected = collectCiReports(tempRoot, expected, options);
      assert.strictEqual(collected.children[0].result, 'error', variant);
      assert.match(collected.notes[0], /failed closed/, variant);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

test('rejects a mock report when real CI evidence is required', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ci-mode-mismatch-'));
  try {
    const target = { os: 'linux', arch: 'x86_64' };
    writeArtifact(tempRoot, target, childReport(target, '/runner/sandbox.yaml', 'mock'));
    const collected = collectCiReports(tempRoot, [target], {
      executionMode: 'real',
      expectedManifest: manifest(),
      manifestPath: '/repo/sandbox.yaml',
      started: '2026-08-08T12:00:00.000Z',
    });
    assert.strictEqual(collected.children[0].result, 'error');
    assert.match(collected.notes[0], /failed closed/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('rejects a forced-native artifact that already records an escalation', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ci-double-escalation-'));
  try {
    const target = { os: 'linux', arch: 'x86_64' };
    const report = childReport(target, '/runner/sandbox.yaml');
    report.escalations = [{ from: 'srt', reason: 'unexpected retry', to: 'podman' }];
    writeArtifact(tempRoot, target, report);
    const collected = collectCiReports(tempRoot, [target], {
      executionMode: 'mock',
      expectedManifest: manifest(),
      manifestPath: '/repo/sandbox.yaml',
      requireNoEscalations: true,
      started: '2026-08-08T12:00:00.000Z',
    });
    assert.strictEqual(collected.children[0].result, 'error');
    assert.match(collected.notes[0], /failed closed/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('binds CI artifacts to one manifest digest and exact command transcript', () => {
  const target = { os: 'linux', arch: 'x86_64' };
  const expectedManifest = manifest();
  const variants = {
    'missing digest': report => { report.notes = []; },
    'duplicate digest': report => { report.notes.push(report.notes[0]); },
    'substituted digest': report => { report.notes[0] = `manifest_sha256=${'0'.repeat(64)}`; },
    'reordered commands': report => { report.steps.reverse(); },
    'appended command': report => {
      report.steps.push({ cmd: 'printf forged', exit: 0, stdout_tail: '', stderr_tail: '' });
    },
    'omitted passing command': report => {
      report.steps.pop();
      report.assertions = [];
    },
    'relabeled assertion': report => { report.assertions[0].cmd = 'printf forged'; },
  };
  for (const [name, mutate] of Object.entries(variants)) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ci-binding-'));
    try {
      const report = childReport(target, '/runner/sandbox.yaml', 'mock', expectedManifest);
      mutate(report);
      writeArtifact(tempRoot, target, report);
      const collected = collectCiReports(tempRoot, [target], {
        executionMode: 'mock',
        expectedManifest,
        manifestPath: '/repo/sandbox.yaml',
        requireNoEscalations: true,
        started: '2026-08-08T12:00:00.000Z',
      });
      assert.strictEqual(collected.children[0].result, 'error', name);
      assert.match(collected.notes[0], /failed closed/, name);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'sandbox-matrix.yml'),
    'utf8'
  );
  assert.match(workflow, /manifest_sha256/);
  assert.match(workflow, /expectedManifest: loadManifest/);
  assert.match(workflow, /requireNoEscalations: true/);
});

test('refuses to dispatch when the remote ref differs from local HEAD', () => {
  const localSha = '1'.repeat(40);
  const remoteSha = '2'.repeat(40);
  let dispatched = false;
  const outcome = executeCi(manifest(), [{ os: 'linux', arch: 'x86_64' }], {
    clock: () => Date.parse('2026-08-08T12:00:00.000Z'),
    gitRoot: repoRoot,
    manifestPath: path.join(repoRoot, 'tests', 'fixtures', 'sandbox', 'ci-matrix.yaml'),
    ref: 'feat/test',
    repository: 'example/ecc',
    run: (executable, argv) => {
      if (executable === 'git' && argv[0] === 'ls-files') return result(0);
      if (executable === 'git' && argv[0] === 'diff') return result(0);
      if (executable === 'git' && argv[0] === 'rev-parse') return result(0, `${localSha}\n`);
      if (executable === 'gh' && argv[0] === 'auth') return result(0);
      if (executable === 'gh' && argv[0] === 'api') return result(0, `${remoteSha}\n`);
      if (executable === 'gh' && argv[0] === 'workflow') dispatched = true;
      throw new Error(`unexpected command: ${executable} ${argv.join(' ')}`);
    },
  });
  assert.strictEqual(dispatched, false);
  assert.strictEqual(outcome.exitCode, 2);
  assert.match(outcome.report.notes.join('\n'), /does not resolve to local HEAD/);
});

test('discovers a correlated workflow run when dispatch returns no URL', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ci-run-discovery-'));
  try {
    const target = { os: 'linux', arch: 'x86_64' };
    writeArtifact(tempRoot, target, childReport(target, '/runner/sandbox.yaml'));
    const correlation = 'ecc-abcdef123456';
    const outcome = executeCi(manifest(), [target], {
      artifactDirectory: tempRoot,
      clock: () => Date.parse('2026-08-08T12:00:00.000Z'),
      correlation,
      gitRoot: repoRoot,
      manifestPath: path.join(repoRoot, 'tests', 'fixtures', 'sandbox', 'ci-matrix.yaml'),
      mock: true,
      ref: 'feat/test',
      repository: 'example/ecc',
      run: (executable, argv) => {
        if (executable === 'gh' && argv[0] === 'auth') return result(0);
        if (executable === 'gh' && argv[0] === 'workflow') return result(0);
        if (executable === 'gh' && argv[0] === 'run' && argv[1] === 'list') {
          return result(0, JSON.stringify([{
            databaseId: 654321,
            displayTitle: `ECC Sandbox ${correlation}`,
            headSha: '1'.repeat(40),
          }]));
        }
        if (executable === 'gh' && argv[0] === 'run' && argv[1] === 'watch') return result(0);
        if (executable === 'gh' && argv[0] === 'run' && argv[1] === 'download') return result(0);
        throw new Error(`unexpected command: ${executable} ${argv.join(' ')}`);
      },
      sleep: () => assert.fail('first discovery attempt should find the run'),
    });
    assert.strictEqual(outcome.exitCode, 0);
    assert.ok(outcome.report.notes.includes('ci_run_id=654321'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('upgrades a passing report when the surrounding workflow fails', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ci-watch-failure-'));
  try {
    const target = { os: 'linux', arch: 'x86_64' };
    writeArtifact(tempRoot, target, childReport(target, '/runner/sandbox.yaml'));
    const outcome = executeCi(manifest(), [target], {
      artifactDirectory: tempRoot,
      clock: () => Date.parse('2026-08-08T12:00:00.000Z'),
      gitRoot: repoRoot,
      manifestPath: path.join(repoRoot, 'tests', 'fixtures', 'sandbox', 'ci-matrix.yaml'),
      mock: true,
      ref: 'feat/test',
      repository: 'example/ecc',
      run: (executable, argv) => {
        if (executable === 'gh' && argv[0] === 'auth') return result(0);
        if (executable === 'gh' && argv[0] === 'workflow') {
          return result(0, 'https://github.com/example/ecc/actions/runs/123456\n');
        }
        if (executable === 'gh' && argv[0] === 'run' && argv[1] === 'watch') {
          return result(1, '', 'workflow failed');
        }
        if (executable === 'gh' && argv[0] === 'run' && argv[1] === 'download') {
          return result(0);
        }
        throw new Error(`unexpected command: ${executable} ${argv.join(' ')}`);
      },
    });
    assert.strictEqual(outcome.exitCode, 2);
    assert.strictEqual(outcome.report.result, 'error');
    assert.match(outcome.report.notes.join('\n'), /workflow completed non-successfully/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI mock dispatch downloads and merges three target reports', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ci-cli-'));
  try {
    const host = defaultHost();
    const targets = ['linux', 'macos', 'windows'].map(targetOs => ({
      os: targetOs,
      arch: host.arch,
    }));
    const capabilitiesPath = path.join(tempRoot, 'capabilities.json');
    const mockPath = path.join(tempRoot, 'mock.json');
    const artifactRoot = path.join(tempRoot, 'artifacts');
    const matrixManifest = loadManifest(path.join(
      repoRoot,
      'tests',
      'fixtures',
      'sandbox',
      'ci-matrix.yaml'
    ));
    fs.mkdirSync(artifactRoot);
    for (const target of targets) {
      writeArtifact(
        artifactRoot,
        target,
        childReport(target, '/runner/tests/fixtures/sandbox/ci-matrix.yaml', 'mock', matrixManifest)
      );
    }
    fs.writeFileSync(capabilitiesPath, JSON.stringify({
      schema_version: 1,
      host,
      backends: { ci: { available: true, targets } },
    }));
    fs.writeFileSync(mockPath, JSON.stringify({ results: [
      { status: 0 },
      { status: 0, stdout: 'https://github.com/example/ecc/actions/runs/123456\n' },
      { status: 0 },
      { status: 0 },
    ] }));
    const cli = spawnSync(process.execPath, [
      cliPath, 'run', 'tests/fixtures/sandbox/ci-matrix.yaml',
      '--capabilities', capabilitiesPath,
      '--mock', mockPath,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        ECC_SANDBOX_CI_ARTIFACT_DIR: artifactRoot,
        ECC_SANDBOX_CI_GIT_ROOT: repoRoot,
        ECC_SANDBOX_CI_REF: 'feat/test',
        ECC_SANDBOX_CI_REPO: 'example/ecc',
      },
      shell: false,
      timeout: 30_000,
    });
    assert.strictEqual(cli.status, 0, cli.stderr || cli.stdout);
    const report = validateReport(JSON.parse(cli.stdout));
    assert.strictEqual(report.backend, 'aggregate');
    assert.strictEqual(report.venue, 'ci');
    assert.strictEqual(report.execution_mode, 'mock');
    assert.strictEqual(report.children.length, 3);
    assert.ok(report.notes.includes('ci_run_id=123456'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('executes one Podman-to-CI native escalation with unchanged commands', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ci-native-escalation-'));
  try {
    const manifestPath = path.join(
      repoRoot,
      'tests',
      'fixtures',
      'sandbox',
      'container-native-escalation.yaml'
    );
    const testManifest = loadManifest(manifestPath);
    const target = { os: 'linux', arch: 'arm64' };
    const artifact = buildSingleReport({
      manifest: manifestPath,
      backend: 'ci-native',
      tier: 3,
      os: target.os,
      arch: target.arch,
      executionMode: 'mock',
      started: '2026-08-08T12:00:00.000Z',
      durationMs: 10,
      steps: [
        { cmd: testManifest.steps.setup[0], exit: 0, stdout_tail: '', stderr_tail: '' },
        { cmd: testManifest.steps.assert[0], exit: 0, stdout_tail: 'active', stderr_tail: '' },
      ],
      assertions: [{ cmd: testManifest.steps.assert[0], pass: true }],
      notes: [`manifest_sha256=${contractDigest(testManifest)}`],
    });
    writeArtifact(tempRoot, target, artifact);
    const calls = [];
    const mockResults = [
      result(0, '{"host":{"security":{"rootless":true}}}'),
      result(0, `sha256:${'b'.repeat(64)}`),
      result(0), result(0),
      result(1, '', 'System has not been booted with systemd as init system'),
      result(0),
      result(0),
      result(0, 'https://github.com/example/ecc/actions/runs/123456\n'),
      result(0), result(0),
    ];
    let index = 0;
    const outcome = executeWithEscalation({
      manifest: testManifest,
      manifestPath,
      capabilities: {
        schema_version: 1,
        host: { os: 'macos', arch: 'arm64' },
        backends: {
          podman: { available: true, targets: [target] },
          ci: { available: true, targets: [target] },
        },
      },
    }, {
      backend: 'podman', os: target.os, arch: target.arch, notes: [],
    }, {
      localOnly: false,
      mock: true,
      run: (executable, argv, options) => {
        calls.push({ executable, argv, options });
        return mockResults[index++] || result(null, '', '', new Error('mock exhausted'));
      },
      ciOptions: {
        artifactDirectory: tempRoot,
        gitRoot: repoRoot,
        ref: 'feat/test',
        repository: 'example/ecc',
      },
    });
    assert.strictEqual(validateReport(outcome.report), outcome.report);
    assert.strictEqual(outcome.report.backend, 'aggregate');
    assert.strictEqual(outcome.report.venue, 'ci');
    assert.strictEqual(outcome.report.result, 'pass');
    assert.deepStrictEqual(outcome.report.escalations, [{
      from: 'podman',
      reason: 'container systemd failure requires native OS behavior',
      to: 'ci',
    }]);
    assert.deepStrictEqual(
      outcome.report.children[0].steps.map(step => step.cmd),
      [...testManifest.steps.setup, ...testManifest.steps.assert]
    );
    const dispatch = calls.find(call => call.executable === 'gh' && call.argv[0] === 'workflow');
    assert.ok(dispatch);
    assert.ok(dispatch.argv.includes(`manifest=tests/fixtures/sandbox/container-native-escalation.yaml`));
    assert.ok(dispatch.argv.includes(`manifest_sha256=${contractDigest(testManifest)}`));
    assert.strictEqual(index, mockResults.length);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
