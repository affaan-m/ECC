'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateManifest, validateReport } = require('../../scripts/sandbox/contracts');
const { defaultHost } = require('../../scripts/sandbox/router');
const {
  DEFAULT_IMAGE,
  buildCreateArgs,
  executeContainer,
  parseContainerDiff,
} = require('../../scripts/sandbox/backends/podman');

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
    name: 'podman-test',
    needs: {
      os: ['linux'],
      capabilities: overrides.capabilities || ['pkg-install', 'network:*'],
      trust: overrides.trust || 'first-party',
      native: false,
    },
    resources: { cpu: 2, memory: '512MB', timeout: 30 },
    steps: {
      setup: overrides.setup || ['npm install --global cowsay@1.6.0 --ignore-scripts'],
      assert: overrides.assert || ['command -v cowsay'],
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
  const runtime = extras.runtime || 'podman';
  const runtimeResults = runtime === 'podman'
    ? [result(0, '{"host":{"security":{"rootless":true}}}\n'), ...results]
    : results;
  const outcome = executeContainer(extras.manifest || manifest(), {
    arch: 'arm64',
    clock: () => 1_700_000_000_000 + (tick++ * 5),
    containerName: 'ecc-sandbox-test',
    cwd: repoRoot,
    manifestPath: path.join(repoRoot, 'sandbox.yaml'),
    mock: true,
    notes: extras.notes,
    run: sequenceRunner(runtimeResults, calls),
    runtime,
  });
  return { outcome, calls };
}

console.log('\n=== ECC sandbox Podman adapter tests ===\n');

test('ships three digest-pinned non-root Linux snapshot definitions', () => {
  for (const distro of ['ubuntu', 'debian', 'fedora']) {
    const source = fs.readFileSync(
      path.join(repoRoot, 'images', 'sandbox', `Containerfile.${distro}`),
      'utf8'
    );
    assert.match(source, /^ARG BASE_IMAGE=[^\n]+@sha256:[a-f0-9]{64}$/m);
    assert.match(source, /^ARG NODE_IMAGE=[^\n]+@sha256:[a-f0-9]{64}$/m);
    assert.match(source, /^USER 1000:1000$/m);
  }
});

test('builds a bounded rootless create command with network off by default', () => {
  const args = buildCreateArgs(manifest({ capabilities: ['pkg-install'] }), {
    containerName: 'ecc-sandbox-test',
    cwd: repoRoot,
    image: DEFAULT_IMAGE,
  });
  assert.deepStrictEqual(args.slice(0, 3), ['create', '--name', 'ecc-sandbox-test']);
  assert.ok(args.includes('--cap-drop'));
  assert.ok(args.includes('ALL'));
  assert.strictEqual(args.includes('no-new-privileges'), false);
  assert.ok(args.includes('--network'));
  assert.ok(args.includes('none'));
  assert.ok(args.includes(`${repoRoot}:/workspace/source:ro`));
  assert.deepStrictEqual(args.slice(-3), [DEFAULT_IMAGE, 'sleep', 'infinity']);

  const untrusted = buildCreateArgs(manifest({
    capabilities: ['pkg-install'], trust: 'untrusted',
  }), {
    containerName: 'ecc-sandbox-test', cwd: repoRoot, image: DEFAULT_IMAGE,
  });
  assert.ok(untrusted.includes('no-new-privileges'));

  const open = buildCreateArgs(manifest(), {
    containerName: 'ecc-sandbox-test', cwd: repoRoot, image: DEFAULT_IMAGE,
  });
  assert.strictEqual(open.includes('--network'), false);
});

test('normalizes Podman diff paths into install evidence', () => {
  const parsed = parseContainerDiff([
    'A /home/ecc/.local/bin/cowsay',
    'A /home/ecc/.local/lib/node_modules/cowsay/index.js',
    'C /home/ecc/.npm/_logs/install.log',
    'A /etc/systemd/system/demo.service',
    'D /home/ecc/.local/bin/old-tool',
    'D /home/ecc/.config/old-tool/config.json',
    '',
  ].join('\n'));
  assert.strictEqual(parsed.diff.method, 'podman-layer');
  assert.strictEqual(parsed.diff.complete, true);
  assert.ok(parsed.diff.files_added.includes('/home/ecc/.local/bin/cowsay'));
  assert.ok(parsed.diff.files_deleted.includes('/home/ecc/.local/bin/old-tool'));
  assert.deepStrictEqual(parsed.diff.path_changes, [
    '/home/ecc/.local/bin/cowsay',
    '/home/ecc/.local/bin/old-tool',
  ]);
  assert.deepStrictEqual(parsed.diff.services_registered, ['/etc/systemd/system/demo.service']);
  assert.ok(parsed.diff.dotfiles_touched.includes('/home/ecc/.npm'));
  assert.ok(parsed.diff.dotfiles_touched.includes('/home/ecc/.config'));
});

test('executes create-start-steps-diff-remove and emits a valid report', () => {
  const { outcome, calls } = runDirect([
    result(0, 'sha256:mock-image\n'),
    result(0, 'container-id\n'),
    result(0),
    result(0, 'installed\n'),
    result(0, '/home/ecc/.local/bin/cowsay\n'),
    result(0, 'A /home/ecc/.local/bin/cowsay\nA /home/ecc/.npm/_logs/install.log\n'),
    result(0),
  ], { notes: ['microsandbox unavailable; using documented degraded Podman isolation'] });
  assert.strictEqual(validateReport(outcome.report), outcome.report);
  assert.strictEqual(outcome.exitCode, 0);
  assert.strictEqual(outcome.report.result, 'pass');
  assert.strictEqual(outcome.report.execution_mode, 'mock');
  assert.deepStrictEqual(calls.map(call => call.argv[0]), [
    'info', 'image', 'create', 'start', 'exec', 'exec', 'diff', 'rm',
  ]);
  assert.ok(outcome.report.install_diff.files_added.includes('/home/ecc/.local/bin/cowsay'));
  assert.strictEqual(outcome.cleanup.pass, true);
  assert.match(outcome.report.notes.join('\n'), /container_start_ms=/);
  assert.ok(outcome.report.notes.includes('image_id=sha256:mock-image'));
  const createCall = calls.find(call => call.argv[0] === 'create');
  assert.deepStrictEqual(createCall.argv.slice(-3), ['sha256:mock-image', 'sleep', 'infinity']);
});

test('still captures diff and removes the container after a failed step', () => {
  const { outcome, calls } = runDirect([
    result(0, 'sha256:mock-image\n'), result(0), result(0),
    result(1, '', 'installer failed'),
    result(0, 'C /home/ecc/.npm/_logs/failure.log\n'),
    result(0),
  ]);
  assert.strictEqual(outcome.report.result, 'fail');
  assert.deepStrictEqual(calls.map(call => call.argv[0]), [
    'info', 'image', 'create', 'start', 'exec', 'diff', 'rm',
  ]);
  assert.strictEqual(outcome.cleanup.pass, true);
});

test('cleanup failure upgrades the report to error with a recovery command', () => {
  const { outcome } = runDirect([
    result(0, 'sha256:mock-image\n'), result(0), result(0), result(0), result(0), result(0, ''),
    result(1, '', 'container busy'),
  ]);
  assert.strictEqual(outcome.report.result, 'error');
  assert.strictEqual(outcome.exitCode, 2);
  assert.match(outcome.report.notes.join('\n'), /podman rm --force ecc-sandbox-test/);
});

test('attempts cleanup even when create reports failure', () => {
  const { outcome, calls } = runDirect([
    result(0, 'sha256:mock-image\n'),
    result(1, '', 'create failed after allocating state'),
    result(1, '', 'no such container'),
  ]);
  assert.strictEqual(outcome.report.result, 'error');
  assert.strictEqual(outcome.cleanup.attempted, true);
  assert.strictEqual(outcome.cleanup.pass, true);
  assert.deepStrictEqual(calls.map(call => call.argv[0]), ['info', 'image', 'create', 'rm']);
});

test('stops an indeterminate exec before collecting diff evidence', () => {
  const { outcome, calls } = runDirect([
    result(0, 'sha256:mock-image\n'), result(0), result(0),
    result(null, '', '', new Error('ETIMEDOUT')),
    result(0),
    result(0, 'C /home/ecc/.npm/_logs/timeout.log\n'),
    result(0),
  ]);
  assert.strictEqual(outcome.report.result, 'error');
  assert.deepStrictEqual(calls.map(call => call.argv[0]), [
    'info', 'image', 'create', 'start', 'exec', 'stop', 'diff', 'rm',
  ]);
  assert.match(outcome.report.notes.join('\n'), /stopped the container/);
});

test('incomplete diff evidence upgrades an otherwise passing run to error', () => {
  const oversized = '/tmp/' + 'x'.repeat(4_100);
  const { outcome } = runDirect([
    result(0, 'sha256:mock-image\n'), result(0), result(0),
    result(0), result(0), result(0, `A ${oversized}\n`), result(0),
  ]);
  assert.strictEqual(outcome.report.result, 'error');
  assert.strictEqual(outcome.report.install_diff.complete, false);
  assert.match(outcome.report.notes.join('\n'), /evidence is incomplete/);
});

test('bounds runtime diagnostics so error reports remain schema-valid', () => {
  const { outcome } = runDirect([
    result(0, 'sha256:mock-image\n'),
    result(1, '', 'failure '.repeat(2_000)),
    result(1, '', 'no such container'),
  ]);
  assert.strictEqual(validateReport(outcome.report), outcome.report);
  assert.ok(outcome.report.notes.every(note => note.length <= 4_096));
});

test('missing snapshot returns a schema-valid actionable error report', () => {
  const { outcome, calls } = runDirect([result(1, '', 'image not known')]);
  assert.strictEqual(outcome.report.result, 'error');
  assert.strictEqual(outcome.cleanup.attempted, false);
  assert.strictEqual(calls.length, 2);
  assert.match(outcome.report.notes.join('\n'), /podman build --file/);
});

test('refuses execution when Podman is not confirmed rootless', () => {
  const calls = [];
  const outcome = executeContainer(manifest(), {
    arch: 'x86_64',
    containerName: 'ecc-sandbox-rootful-test',
    cwd: repoRoot,
    manifestPath: path.join(repoRoot, 'sandbox.yaml'),
    mock: true,
    run: sequenceRunner([result(0, '{"host":{"security":{"rootless":false}}}')], calls),
    runtime: 'podman',
  });
  assert.strictEqual(outcome.report.result, 'error');
  assert.deepStrictEqual(calls.map(call => call.argv[0]), ['info']);
  assert.match(outcome.report.notes.join('\n'), /not confirmed rootless/);
});

test('CLI mock mode routes to Podman and emits only normalized JSON', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-podman-cli-'));
  try {
    const host = defaultHost();
    const manifestPath = path.join(tempRoot, 'sandbox.yaml');
    const capabilitiesPath = path.join(tempRoot, 'capabilities.json');
    const mockPath = path.join(tempRoot, 'mock.json');
    fs.writeFileSync(manifestPath, [
      'name: cli-podman-test',
      'needs:',
      '  os: [linux]',
      '  capabilities: [pkg-install]',
      '  trust: first-party',
      '  native: false',
      'resources:',
      '  cpu: 1',
      '  memory: 256MB',
      '  timeout: 30',
      'steps:',
      '  setup: ["printf setup"]',
      '  assert: ["printf assert"]',
      'report: install-diff',
      '',
    ].join('\n'));
    fs.writeFileSync(capabilitiesPath, JSON.stringify({
      schema_version: 1,
      host,
      backends: { podman: { available: true, targets: [{ os: 'linux', arch: host.arch }] } },
    }));
    fs.writeFileSync(mockPath, JSON.stringify({ results: [
      { status: 0, stdout: '{"host":{"security":{"rootless":true}}}\n' },
      { status: 0, stdout: 'sha256:mock-image\n' }, { status: 0 }, { status: 0 },
      { status: 0, stdout: 'setup' }, { status: 0, stdout: 'assert' },
      { status: 0, stdout: 'A /home/ecc/.local/bin/demo\n' }, { status: 0 },
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
    assert.strictEqual(report.execution_mode, 'mock');
    assert.ok(report.install_diff.path_changes.includes('/home/ecc/.local/bin/demo'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
