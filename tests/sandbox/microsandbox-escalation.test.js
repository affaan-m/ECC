'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateManifest, validateReport } = require('../../scripts/sandbox/contracts');
const {
  defaultHost,
  resolveRuntimeEscalation,
  resolveTierOneFallback,
} = require('../../scripts/sandbox/router');
const { buildSingleReport } = require('../../scripts/sandbox/report');
const {
  containerNativeFailure,
  executeRoute,
  executeWithEscalation,
} = require('../../scripts/sandbox/ecc-sandbox');
const {
  MICROSANDBOX_VERSION,
  executeMicrosandbox,
  memoryForMsb,
  networkArgs,
  requestedImageDigest,
  sandboxRunArgs,
  seedCreateArgs,
  snapshotName,
  snapshotMatchesImage,
} = require('../../scripts/sandbox/backends/microsandbox');

const repoRoot = path.join(__dirname, '..', '..');
const cliPath = path.join(repoRoot, 'scripts', 'sandbox', 'ecc-sandbox');
const PINNED_IMAGE = `docker.io/ecc/sandbox@sha256:${'a'.repeat(64)}`;
const PODMAN_IMAGE_ID = `sha256:${'b'.repeat(64)}`;
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
    name: 'microsandbox-test',
    needs: {
      os: overrides.os || ['linux'],
      capabilities: overrides.capabilities || ['clean-home'],
      trust: overrides.trust || 'untrusted',
      native: false,
    },
    resources: { cpu: 2, memory: '512MB', timeout: 30 },
    steps: {
      setup: overrides.setup || ['printf setup'],
      assert: overrides.assert || ['printf assert'],
    },
    report: overrides.report || 'install-diff',
  });
}

function result(status, stdout = '', stderr = '', error = null) {
  return { status, stdout, stderr, error };
}

function sequenceRunner(results, calls) {
  let index = 0;
  return (executable, argv, options) => {
    calls.push({ executable, argv, options });
    const value = results[index];
    index += 1;
    return value || result(null, '', '', new Error('mock sequence exhausted'));
  };
}

function runDirect(results, extras = {}) {
  const calls = [];
  let tick = 0;
  const outcome = executeMicrosandbox(extras.manifest || manifest(), {
    arch: 'arm64',
    clock: () => 1_700_000_000_000 + (tick++ * 5),
    cwd: repoRoot,
    image: extras.image || PINNED_IMAGE,
    manifestPath: path.join(repoRoot, 'sandbox.yaml'),
    mock: true,
    run: sequenceRunner(results, calls),
    sandboxName: 'ecc-msb-test',
    snapshot: extras.snapshot || 'ecc-pristine-test',
  });
  return { calls, outcome };
}

console.log('\n=== ECC Microsandbox and escalation tests ===\n');

test('pins the beta CLI contract and deterministic snapshot name', () => {
  assert.strictEqual(MICROSANDBOX_VERSION, '0.6.8');
  assert.strictEqual(memoryForMsb('2GB'), '2G');
  assert.strictEqual(memoryForMsb('512MB'), '512M');
  assert.strictEqual(snapshotName(PINNED_IMAGE, 'arm64'), snapshotName(PINNED_IMAGE, 'arm64'));
  assert.notStrictEqual(snapshotName(PINNED_IMAGE, 'arm64'), snapshotName(PINNED_IMAGE, 'x86_64'));
  assert.strictEqual(requestedImageDigest(PINNED_IMAGE), `sha256:${'a'.repeat(64)}`);
});

test('requires snapshot integrity output to match the requested image digest', () => {
  const matching = result(0, [
    `Image:          ${PINNED_IMAGE}`,
    `Image Manifest: ${`sha256:${'a'.repeat(64)}`}`,
  ].join('\n'));
  const substituted = result(0, [
    `Image:          docker.io/ecc/other@sha256:${'b'.repeat(64)}`,
    `Image Manifest: ${`sha256:${'b'.repeat(64)}`}`,
  ].join('\n'));
  const contradictory = result(0, [
    `Image:          ${PINNED_IMAGE}`,
    `Image Manifest: ${`sha256:${'b'.repeat(64)}`}`,
  ].join('\n'));
  assert.strictEqual(snapshotMatchesImage(matching, PINNED_IMAGE), true);
  assert.strictEqual(snapshotMatchesImage(substituted, PINNED_IMAGE), false);
  assert.strictEqual(snapshotMatchesImage(contradictory, PINNED_IMAGE), false);
});

test('generates explicit closed, open, and domain network policies', () => {
  assert.deepStrictEqual(networkArgs(manifest()), ['--no-net']);
  assert.deepStrictEqual(networkArgs(manifest({ capabilities: ['network:*'] })), [
    '--net', 'all',
  ]);
  assert.deepStrictEqual(networkArgs(manifest({
    capabilities: ['network:npmjs.org', 'network:registry.npmjs.org'],
  })), [
    '--no-net',
    '--net-rule', 'allow@npmjs.org',
    '--net-rule', 'allow@registry.npmjs.org',
  ]);
});

test('builds bounded snapshot seed and independent fork commands', () => {
  const testManifest = manifest();
  const seed = seedCreateArgs(testManifest, { image: PINNED_IMAGE, seedName: 'seed' });
  assert.ok(seed.includes('--pull'));
  assert.ok(seed.includes('never'));
  assert.ok(seed.includes('--no-net'));
  assert.ok(seed.includes('restricted'));
  const fork = sandboxRunArgs(testManifest, {
    cwd: repoRoot,
    sandboxName: 'child',
    snapshot: 'pristine',
  });
  assert.ok(fork.includes('--from-snapshot'));
  assert.ok(fork.includes('--no-tty'));
  assert.ok(fork.includes('--mount-dir'));
  assert.ok(fork.includes(`${repoRoot}:/workspace/source:ro`));
  assert.ok(fork.includes('restricted'));
});

test('runtime escalation reuses hardened Tier 1 preference and any-to-Linux mapping', () => {
  const host = defaultHost();
  const testManifest = manifest({ os: ['any'] });
  const capabilities = {
    schema_version: 1,
    host,
    backends: {
      microsandbox: {
        available: true,
        targets: [{ os: 'linux', arch: host.arch }],
      },
      podman: {
        available: true,
        targets: [{ os: 'linux', arch: host.arch }],
      },
    },
  };
  const route = resolveRuntimeEscalation(testManifest, capabilities, {
    backend: 'srt', os: host.os, arch: host.arch,
  });
  assert.strictEqual(route.result, 'routable');
  assert.strictEqual(route.os, 'linux');
  assert.strictEqual(route.backend, 'microsandbox');
});

test('recognizes only paired high-confidence native command and failure signatures', () => {
  const report = (cmd, stderr) => buildSingleReport({
    manifest: '/repo/sandbox.yaml',
    backend: 'podman',
    tier: 1,
    os: 'linux',
    arch: 'arm64',
    executionMode: 'mock',
    started: '2026-08-08T12:00:00.000Z',
    durationMs: 1,
    steps: [{ cmd, exit: 1, stdout_tail: '', stderr_tail: stderr }],
    assertions: [],
    notes: [],
  });
  assert.strictEqual(
    containerNativeFailure(report(
      'systemctl start ecc-demo',
      'System has not been booted with systemd as init system'
    )).family,
    'systemd'
  );
  assert.strictEqual(
    containerNativeFailure(report('reg.exe add HKLM\\Software\\ECC', "'reg.exe' is not recognized")).family,
    'registry'
  );
  assert.strictEqual(
    containerNativeFailure(report('xdg-open installer.desktop', 'cannot open display')).family,
    'gui'
  );
  assert.strictEqual(
    containerNativeFailure(report(
      'printf preparing\nsystemctl start ecc-demo',
      'Failed to connect to bus: No such file or directory'
    )).family,
    'systemd'
  );
  assert.strictEqual(containerNativeFailure(report('printf ok', 'cannot open display')), null);
  assert.strictEqual(containerNativeFailure(report('systemctl start demo', 'ordinary exit 1')), null);
  assert.strictEqual(containerNativeFailure(report(
    "printf 'systemctl start demo'",
    'System has not been booted with systemd as init system'
  )), null);
});

test('container native escalation prefers local Tier 2 and honors local-only', () => {
  const testManifest = manifest({
    capabilities: ['clean-home', 'network:*'],
    trust: 'first-party',
  });
  const host = { os: 'macos', arch: 'arm64' };
  const base = {
    schema_version: 1,
    host,
    backends: {
      lima: { available: true, targets: [{ os: 'linux', arch: 'arm64' }] },
      ci: { available: true, targets: [{ os: 'linux', arch: 'arm64' }] },
    },
  };
  const local = resolveRuntimeEscalation(testManifest, base, {
    backend: 'podman', os: 'linux', arch: 'arm64',
  });
  assert.strictEqual(local.backend, 'lima');
  assert.strictEqual(local.tier, 2);

  const ciOnly = { ...base, backends: { ci: base.backends.ci } };
  const remote = resolveRuntimeEscalation(testManifest, ciOnly, {
    backend: 'podman', os: 'linux', arch: 'arm64',
  });
  assert.strictEqual(remote.backend, 'ci');
  const localOnly = resolveRuntimeEscalation(testManifest, ciOnly, {
    backend: 'podman', os: 'linux', arch: 'arm64',
  }, { localOnly: true });
  assert.strictEqual(localOnly.result, 'error');
  assert.match(localOnly.reason, /no local backend/);
});

test('container native escalation cannot widen trust or network authority through CI', () => {
  const capabilities = {
    schema_version: 1,
    host: { os: 'macos', arch: 'arm64' },
    backends: {
      ci: { available: true, targets: [{ os: 'linux', arch: 'arm64' }] },
    },
  };
  const source = { backend: 'microsandbox', os: 'linux', arch: 'arm64' };
  const offline = resolveRuntimeEscalation(manifest({
    capabilities: ['clean-home'],
    trust: 'first-party',
  }), capabilities, source);
  assert.strictEqual(offline.result, 'error');
  assert.match(offline.reason, /cannot enforce disabled egress/);

  const untrusted = resolveRuntimeEscalation(manifest({
    capabilities: ['clean-home', 'network:*'],
    trust: 'untrusted',
  }), capabilities, source);
  assert.strictEqual(untrusted.result, 'error');
  assert.match(untrusted.reason, /cannot produce trustworthy evidence/);
});

test('executes exactly one Podman-to-Lima native escalation and records it', () => {
  const testManifest = manifest({
    capabilities: ['clean-home', 'network:*'],
    trust: 'first-party',
    report: 'exit-only',
    setup: ['systemctl start ecc-demo'],
    assert: ['systemctl is-active ecc-demo'],
  });
  const capabilities = {
    schema_version: 1,
    host: { os: 'macos', arch: 'arm64' },
    backends: {
      podman: { available: true, targets: [{ os: 'linux', arch: 'arm64' }] },
      lima: { available: true, targets: [{ os: 'linux', arch: 'arm64' }] },
    },
  };
  const calls = [];
  const outcome = executeWithEscalation({
    manifest: testManifest,
    manifestPath: '/repo/sandbox.yaml',
    capabilities,
  }, {
    backend: 'podman', os: 'linux', arch: 'arm64', notes: [],
  }, {
    localOnly: false,
    mock: true,
    run: sequenceRunner([
      result(0, '{"host":{"security":{"rootless":true}}}'),
      result(0, PODMAN_IMAGE_ID),
      result(0), result(0),
      result(1, '', 'System has not been booted with systemd as init system'),
      result(0),
      result(0, JSON.stringify([{
        status: 'Stopped', arch: 'aarch64',
        config: { os: 'Linux', arch: 'aarch64', plain: true },
      }])),
      result(0), result(0), result(0), result(0),
      result(0, 'started'), result(0, 'active'),
      result(0), result(0),
    ], calls),
  });
  assert.strictEqual(validateReport(outcome.report), outcome.report);
  assert.strictEqual(outcome.report.backend, 'lima');
  assert.strictEqual(outcome.report.result, 'pass');
  assert.deepStrictEqual(outcome.report.escalations, [{
    from: 'podman',
    reason: 'container systemd failure requires native OS behavior',
    to: 'lima',
  }]);
  assert.strictEqual(calls.filter(call => call.executable === 'podman').length, 6);
  assert.strictEqual(calls.filter(call => call.executable === 'limactl').length, 9);
});

test('local-only leaves a native container failure local when no Tier 2 backend exists', () => {
  const testManifest = manifest({
    capabilities: ['clean-home', 'network:*'],
    trust: 'first-party',
    report: 'exit-only',
    setup: ['systemctl start ecc-demo'],
  });
  const calls = [];
  const outcome = executeWithEscalation({
    manifest: testManifest,
    manifestPath: '/repo/sandbox.yaml',
    capabilities: {
      schema_version: 1,
      host: { os: 'macos', arch: 'arm64' },
      backends: {
        podman: { available: true, targets: [{ os: 'linux', arch: 'arm64' }] },
        ci: { available: true, targets: [{ os: 'linux', arch: 'arm64' }] },
      },
    },
  }, {
    backend: 'podman', os: 'linux', arch: 'arm64', notes: [],
  }, {
    localOnly: true,
    mock: true,
    run: sequenceRunner([
      result(0, '{"host":{"security":{"rootless":true}}}'),
      result(0, PODMAN_IMAGE_ID),
      result(0), result(0),
      result(1, '', 'System has not been booted with systemd as init system'),
      result(0),
    ], calls),
  });
  assert.strictEqual(outcome.report.backend, 'podman');
  assert.strictEqual(outcome.report.result, 'fail');
  assert.deepStrictEqual(outcome.report.escalations, []);
  assert.deepStrictEqual([...new Set(calls.map(call => call.executable))], ['podman']);
  assert.match(outcome.report.notes.join('\n'), /Automatic native escalation unavailable/);
  assert.match(outcome.report.notes.join('\n'), /no local backend/);
});

test('shares one escalation budget across an orchestration run', () => {
  const testManifest = manifest({
    capabilities: ['clean-home', 'network:*'],
    trust: 'first-party',
    report: 'exit-only',
    setup: ['systemctl start ecc-demo'],
  });
  const capabilities = {
    schema_version: 1,
    host: { os: 'macos', arch: 'arm64' },
    backends: {
      podman: { available: true, targets: [{ os: 'linux', arch: 'arm64' }] },
      lima: { available: true, targets: [{ os: 'linux', arch: 'arm64' }] },
    },
  };
  const resolved = {
    manifest: testManifest,
    manifestPath: '/repo/sandbox.yaml',
    capabilities,
  };
  const route = { backend: 'podman', os: 'linux', arch: 'arm64', notes: [] };
  const escalationBudget = { remaining: 1 };
  const first = executeWithEscalation(resolved, route, {
    escalationBudget,
    localOnly: true,
    mock: true,
    run: sequenceRunner([
      result(0, '{"host":{"security":{"rootless":true}}}'),
      result(0, PODMAN_IMAGE_ID),
      result(0), result(0),
      result(1, '', 'System has not been booted with systemd as init system'),
      result(0),
      result(0, JSON.stringify([{
        status: 'Stopped', arch: 'aarch64',
        config: { os: 'Linux', arch: 'aarch64', plain: true },
      }])),
      result(0), result(0), result(0), result(0),
      result(0, 'started'),
      result(0), result(0),
    ], []),
  });
  assert.strictEqual(first.report.escalations.length, 1);
  assert.strictEqual(escalationBudget.remaining, 0);

  const secondCalls = [];
  const second = executeWithEscalation(resolved, route, {
    escalationBudget,
    localOnly: true,
    mock: true,
    run: sequenceRunner([
      result(0, '{"host":{"security":{"rootless":true}}}'),
      result(0, PODMAN_IMAGE_ID),
      result(0), result(0),
      result(1, '', 'System has not been booted with systemd as init system'),
      result(0),
    ], secondCalls),
  });
  assert.strictEqual(second.report.backend, 'podman');
  assert.deepStrictEqual(second.report.escalations, []);
  assert.match(second.report.notes.join('\n'), /run-wide one-escalation budget/);
  assert.deepStrictEqual([...new Set(secondCalls.map(call => call.executable))], ['podman']);
});

test('Microsandbox startup fallback fails closed for a domain allowlist', () => {
  const host = defaultHost();
  const testManifest = manifest({ capabilities: ['network:npmjs.org'] });
  const route = resolveTierOneFallback(testManifest, {
    schema_version: 1,
    host,
    backends: {
      podman: {
        available: true,
        targets: [{ os: 'linux', arch: host.arch }],
      },
    },
  }, { os: 'linux', arch: host.arch }, { exclude: ['microsandbox'] });
  assert.strictEqual(route.result, 'error');
  assert.match(route.reason, /strict domain allowlists/);
});

test('reuses an integrity-checked snapshot and emits a valid report', () => {
  const { calls, outcome } = runDirect([
    result(0, 'msb 0.6.8\n'),
    result(0, 'doctor ok\n'),
    result(0, `Image: ${PINNED_IMAGE}\nImage Manifest: sha256:${'a'.repeat(64)}\n`),
    result(0, 'ecc-msb-test\n'),
    result(0, 'setup\n'),
    result(0, 'assert\n'),
    result(0),
  ]);
  assert.strictEqual(validateReport(outcome.report), outcome.report);
  assert.strictEqual(outcome.report.result, 'pass');
  assert.strictEqual(outcome.report.backend, 'microsandbox');
  assert.strictEqual(outcome.report.install_diff.method, 'none');
  assert.strictEqual(outcome.startupFailure, false);
  assert.deepStrictEqual(calls.map(call => call.argv[0]), [
    '--version', 'doctor', 'snapshot', 'run', 'exec', 'exec', 'remove',
  ]);
  const execCall = calls.find(call => call.argv[0] === 'exec');
  assert.ok(execCall.argv.includes('--stream'));
  assert.ok(execCall.argv.includes('--no-tty'));
  assert.strictEqual(outcome.cleanup.pass, true);
});

test('creates one pristine integrity snapshot before the test fork', () => {
  const { calls, outcome } = runDirect([
    result(0, 'msb 0.6.8\n'), result(0),
    result(1, '', 'snapshot not found'),
    result(0), result(0), result(0), result(0),
    result(0, `Image: ${PINNED_IMAGE}\nImage Manifest: sha256:${'a'.repeat(64)}\n`),
    result(0),
    result(0), result(0), result(0), result(0),
  ]);
  assert.strictEqual(outcome.report.result, 'pass');
  assert.deepStrictEqual(calls.map(call => call.argv.slice(0, 2).join(' ')), [
    '--version', 'doctor', 'snapshot inspect', 'pull docker.io/ecc/sandbox@sha256:' + 'a'.repeat(64),
    'create --name', 'stop --force', 'snapshot create', 'snapshot inspect', 'remove --force',
    'run --name', 'exec ecc-msb-test', 'exec ecc-msb-test', 'remove --force',
  ]);
  assert.strictEqual(outcome.cleanup.seed_attempted, true);
});

test('fails startup without mutation when doctor does not pass', () => {
  const { calls, outcome } = runDirect([
    result(0, 'msb 0.6.8\n'),
    result(1, '', 'KVM unavailable'),
  ]);
  assert.strictEqual(outcome.startupFailure, true);
  assert.strictEqual(outcome.report.result, 'error');
  assert.deepStrictEqual(calls.map(call => call.argv[0]), ['--version', 'doctor']);
  assert.match(outcome.report.notes.join('\n'), /doctor failed/);
});

test('requires a digest reference before creating a shared snapshot', () => {
  const { calls, outcome } = runDirect([
    result(0, 'msb 0.6.8\n'), result(0),
  ], { image: 'registry.example/ecc:latest' });
  assert.strictEqual(outcome.startupFailure, true);
  assert.deepStrictEqual(calls.map(call => call.argv[0]), ['--version', 'doctor']);
  assert.match(outcome.report.notes.join('\n'), /OCI digest reference/);
});

test('rejects an integrity-valid snapshot whose recorded image was substituted', () => {
  const otherImage = `docker.io/ecc/other@sha256:${'b'.repeat(64)}`;
  const { calls, outcome } = runDirect([
    result(0, 'msb 0.6.8\n'), result(0),
    result(0, `Image: ${otherImage}\nImage Manifest: sha256:${'b'.repeat(64)}\n`),
  ]);
  assert.strictEqual(outcome.startupFailure, true);
  assert.strictEqual(outcome.report.result, 'error');
  assert.deepStrictEqual(calls.map(call => call.argv[0]), ['--version', 'doctor', 'snapshot']);
  assert.match(outcome.report.notes.join('\n'), /does not match requested image digest/);
});

test('does not mask a failed Microsandbox cleanup with container fallback', () => {
  const host = defaultHost();
  const testManifest = manifest({ report: 'exit-only' });
  const calls = [];
  const previousImage = process.env.ECC_SANDBOX_IMAGE;
  let outcome;
  try {
    process.env.ECC_SANDBOX_IMAGE = PINNED_IMAGE;
    outcome = executeRoute({
      manifest: testManifest,
      manifestPath: path.join(repoRoot, 'sandbox.yaml'),
      capabilities: {
        schema_version: 1,
        host,
        backends: {
          microsandbox: { available: true, targets: [{ os: 'linux', arch: host.arch }] },
          podman: { available: true, targets: [{ os: 'linux', arch: host.arch }] },
        },
      },
    }, {
      backend: 'microsandbox', os: 'linux', arch: host.arch, notes: [],
    }, {
      mock: true,
      run: sequenceRunner([
        result(0, 'msb 0.6.8\n'), result(0),
        result(0, `Image: ${PINNED_IMAGE}\nImage Manifest: sha256:${'a'.repeat(64)}\n`),
        result(1, '', 'fork failed'),
        result(1, '', 'remove failed'),
      ], calls),
    });
  } finally {
    if (previousImage === undefined) delete process.env.ECC_SANDBOX_IMAGE;
    else process.env.ECC_SANDBOX_IMAGE = previousImage;
  }
  assert.strictEqual(outcome.report.backend, 'microsandbox');
  assert.strictEqual(outcome.report.result, 'error');
  assert.strictEqual(outcome.cleanup.safe_for_fallback, false);
  assert.deepStrictEqual([...new Set(calls.map(call => call.executable))], ['msb']);
  assert.match(outcome.report.notes.join('\n'), /cleanup failed/);
});

test('CLI automatically escalates one SRT installer denial to Podman', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-escalation-'));
  try {
    const host = defaultHost();
    const manifestPath = path.join(tempRoot, 'sandbox.yaml');
    const capabilitiesPath = path.join(tempRoot, 'capabilities.json');
    const mockPath = path.join(tempRoot, 'mock.json');
    fs.writeFileSync(manifestPath, [
      'name: escalation-test',
      'needs:',
      '  os: [any]',
      '  capabilities: [fs-write]',
      '  trust: first-party',
      '  native: false',
      'resources:',
      '  cpu: 1',
      '  memory: 256MB',
      '  timeout: 30',
      'steps:',
      '  setup: ["apt-get install demo"]',
      '  assert: ["command -v demo"]',
      'report: exit-only',
      '',
    ].join('\n'));
    fs.writeFileSync(capabilitiesPath, JSON.stringify({
      schema_version: 1,
      host,
      backends: {
        srt: { available: true, targets: [{ os: host.os, arch: host.arch }] },
        podman: { available: true, targets: [{ os: 'linux', arch: host.arch }] },
      },
    }));
    fs.writeFileSync(mockPath, JSON.stringify({ results: [
      { status: 1, stderr: 'Permission denied by sandbox policy' },
      { status: 0, stdout: '{"host":{"security":{"rootless":true}}}\n' },
      { status: 0, stdout: `${PODMAN_IMAGE_ID}\n` },
      { status: 0 }, { status: 0 },
      { status: 0, stdout: 'installed\n' },
      { status: 0, stdout: '/usr/bin/demo\n' },
      { status: 0 },
    ] }));
    const cli = spawnSync(process.execPath, [
      cliPath, 'run', manifestPath,
      '--capabilities', capabilitiesPath,
      '--mock', mockPath,
    ], { cwd: repoRoot, encoding: 'utf8', shell: false, timeout: 30_000 });
    assert.strictEqual(cli.status, 0, cli.stderr || cli.stdout);
    assert.strictEqual(cli.stderr, '');
    const report = validateReport(JSON.parse(cli.stdout));
    assert.strictEqual(report.backend, 'podman');
    assert.strictEqual(report.result, 'pass');
    assert.deepStrictEqual(report.escalations, [{
      from: 'srt',
      reason: 'installer or system-write policy denial',
      to: 'podman',
    }]);
    assert.match(report.notes.join('\n'), /Initial SRT attempt denied/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI escalate consumes an eligible SRT report without repeating Tier 0', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-manual-escalation-'));
  try {
    const host = defaultHost();
    const manifestPath = path.join(tempRoot, 'sandbox.yaml');
    const reportPath = path.join(tempRoot, 'srt-report.json');
    const capabilitiesPath = path.join(tempRoot, 'capabilities.json');
    const mockPath = path.join(tempRoot, 'mock.json');
    fs.writeFileSync(manifestPath, [
      'name: manual-escalation-test',
      'needs:',
      '  os: [any]',
      '  capabilities: [fs-write]',
      '  trust: first-party',
      '  native: false',
      'resources:',
      '  cpu: 1',
      '  memory: 256MB',
      '  timeout: 30',
      'steps:',
      '  setup: ["apt-get install demo"]',
      '  assert: ["command -v demo"]',
      'report: exit-only',
      '',
    ].join('\n'));
    fs.writeFileSync(capabilitiesPath, JSON.stringify({
      schema_version: 1,
      host,
      backends: {
        podman: { available: true, targets: [{ os: 'linux', arch: host.arch }] },
      },
    }));
    fs.writeFileSync(reportPath, JSON.stringify(buildSingleReport({
      manifest: manifestPath,
      backend: 'srt',
      tier: 0,
      os: host.os,
      arch: host.arch,
      executionMode: 'mock',
      started: '2026-08-08T12:00:00.000Z',
      durationMs: 5,
      steps: [{
        cmd: 'apt-get install demo',
        exit: 1,
        stdout_tail: '',
        stderr_tail: 'Permission denied by sandbox policy',
      }],
      assertions: [],
      notes: [
        'suspected-srt-denial: installer or system-write command is eligible for one-hop escalation',
      ],
    })));
    fs.writeFileSync(mockPath, JSON.stringify({ results: [
      { status: 0, stdout: '{"host":{"security":{"rootless":true}}}\n' },
      { status: 0, stdout: `${PODMAN_IMAGE_ID}\n` },
      { status: 0 }, { status: 0 },
      { status: 0, stdout: 'installed\n' },
      { status: 0, stdout: '/usr/bin/demo\n' },
      { status: 0 },
    ] }));
    const cli = spawnSync(process.execPath, [
      cliPath, 'escalate', reportPath,
      '--capabilities', capabilitiesPath,
      '--mock', mockPath,
    ], { cwd: repoRoot, encoding: 'utf8', shell: false, timeout: 30_000 });
    assert.strictEqual(cli.status, 0, cli.stderr || cli.stdout);
    const report = validateReport(JSON.parse(cli.stdout));
    assert.strictEqual(report.backend, 'podman');
    assert.strictEqual(report.steps.length, 2);
    assert.strictEqual(report.duration_ms >= 5, true);
    assert.strictEqual(report.escalations.length, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI reports degraded Podman fallback when a probed Microsandbox cannot start', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-msb-fallback-'));
  try {
    const host = defaultHost();
    const manifestPath = path.join(tempRoot, 'sandbox.yaml');
    const capabilitiesPath = path.join(tempRoot, 'capabilities.json');
    const mockPath = path.join(tempRoot, 'mock.json');
    fs.writeFileSync(manifestPath, [
      'name: microsandbox-fallback-test',
      'needs:',
      '  os: [linux]',
      '  capabilities: [clean-home]',
      '  trust: untrusted',
      '  native: false',
      'resources:',
      '  cpu: 1',
      '  memory: 256MB',
      '  timeout: 30',
      'steps:',
      '  setup: ["printf setup"]',
      '  assert: ["printf assert"]',
      'report: exit-only',
      '',
    ].join('\n'));
    fs.writeFileSync(capabilitiesPath, JSON.stringify({
      schema_version: 1,
      host,
      backends: {
        microsandbox: {
          available: true,
          targets: [{ os: 'linux', arch: host.arch }],
        },
        podman: { available: true, targets: [{ os: 'linux', arch: host.arch }] },
      },
    }));
    fs.writeFileSync(mockPath, JSON.stringify({ results: [
      { status: null, error: 'spawn msb ENOENT' },
      { status: 0, stdout: '{"host":{"security":{"rootless":true}}}\n' },
      { status: 0, stdout: `${PODMAN_IMAGE_ID}\n` },
      { status: 0 }, { status: 0 },
      { status: 0, stdout: 'setup\n' },
      { status: 0, stdout: 'assert\n' },
      { status: 0 },
    ] }));
    const cli = spawnSync(process.execPath, [
      cliPath, 'run', manifestPath,
      '--capabilities', capabilitiesPath,
      '--mock', mockPath,
    ], { cwd: repoRoot, encoding: 'utf8', shell: false, timeout: 30_000 });
    assert.strictEqual(cli.status, 0, cli.stderr || cli.stdout);
    const report = validateReport(JSON.parse(cli.stdout));
    assert.strictEqual(report.backend, 'podman');
    assert.deepStrictEqual(report.escalations, []);
    assert.match(report.notes.join('\n'), /Microsandbox startup failed; fell back within Tier 1/);
    assert.match(report.notes.join('\n'), /spawn msb ENOENT/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
