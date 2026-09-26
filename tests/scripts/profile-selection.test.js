'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { withFixture } = require('../lib/helpers/context-fixture');
const CLI = path.resolve(__dirname, '../../scripts/ecc.js');
const PROFILE_CLI = path.resolve(__dirname, '../../scripts/profile.js');

function cliFixture(run) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc-selection-cli-'));
  const stateRoot = path.join(root, 'managed');
  const input = path.join(root, 'task.json');
  const setTask = values => fs.writeFileSync(input, JSON.stringify({ sessionId: 'test', taskId: 'test',
    revision: 1, phase: 'implement', query: 'Explain Python lists', ...values }));
  setTask({ proposedIds: ['skill:python-patterns'] });
  const invoke = (args, { preload, env = {} } = {}) => {
    const entry = preload ? ['--require', preload, PROFILE_CLI] : [CLI, 'profile'];
    const child = spawnSync(process.execPath, [...entry, ...args, '--json'], {
      cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE, ...env },
    });
    assert.ok(child.stdout, child.stderr || child.error?.message);
    return { code: child.status, response: JSON.parse(child.stdout) };
  };
  try { return run({ root, stateRoot, input, setTask, invoke }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function providerFixture(root) {
  const preload = path.join(root, 'provider-preload.cjs');
  const sentinel = path.join(root, 'provider-executed');
  fs.writeFileSync(preload, `
    const cp = require('node:child_process');
    const fs = require('node:fs');
    const original = cp.spawnSync;
    cp.spawnSync = (command, ...args) => {
      if (command !== 'codex' && command !== 'claude') return original(command, ...args);
      fs.writeFileSync(process.env.ECC_TEST_PROVIDER_SENTINEL, 'executed');
      return { status: Number(process.env.ECC_TEST_PROVIDER_STATUS || 0),
        stdout: 'fixture output', stderr: 'fixture provider failure' };
    };
  `);
  return { preload, sentinel, env: { ECC_TEST_PROVIDER_SENTINEL: sentinel } };
}

test('CLI resolves and loads explicit task context with JSON output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-selection-cli-'));
  try {
    const input = path.join(root, 'task.json');
    fs.writeFileSync(input, JSON.stringify({ sessionId: 'test', taskId: 'test', revision: 1, phase: 'implement',
      explicitIds: ['skill:python-patterns'] }));
    const args = ['profile', 'resolve', '--task-input', input, '--load', '--json'];
    const run = extra => spawnSync(process.execPath, [CLI, ...extra, ...args], {
      cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE },
    });
    const result = run([]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout).selection.loadedIds, ['skill:python-patterns']);
    const preview = run(['--dry-run']);
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    assert.deepEqual(JSON.parse(preview.stdout).selection.loadedIds, []);
    assert.deepEqual(fs.readdirSync(root), ['task.json']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('resolver rejects unknown flags before reading task input', () => {
  const result = spawnSync(process.execPath, [CLI, 'profile', 'resolve', '--task-input', 'missing', '--hooks', 'full', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).summary, /Unknown argument/);
});

test('saved mode and exclusions govern resolution and survive mode changes', () => cliFixture(({ stateRoot, input, setTask, invoke }) => {
  const setup = invoke(['set', 'lean', '--state-root', stateRoot, '--selection', 'suggest',
    '--include', 'skill:python-patterns', '--exclude', 'skill:python-testing']);
  assert.equal(setup.code, 0, setup.response.summary);
  const resolveArgs = ['resolve', '--state-root', stateRoot, '--task-input', input, '--load'];
  const suggestion = invoke(resolveArgs);
  assert.equal(suggestion.code, 0, suggestion.response.summary);
  assert.equal(suggestion.response.selection.selectionMode, 'suggest');
  assert.deepEqual(suggestion.response.selection.selectedIds, ['skill:python-patterns']);
  assert.deepEqual(suggestion.response.selection.loadedIds, []);

  const preview = invoke(['mode', 'manual', '--state-root', stateRoot, '--dry-run']);
  assert.equal(preview.code, 0, preview.response.summary);
  assert.equal(preview.response.store.status, 'proposed');
  assert.equal(invoke(['status', '--state-root', stateRoot]).response.store.selectionMode, 'suggest');
  const changed = invoke(['mode', 'manual', '--state-root', stateRoot, '--expected-revision', '1']);
  assert.equal(changed.code, 0, changed.response.summary);
  assert.deepEqual(changed.response.store.include, ['skill:python-patterns']);
  assert.deepEqual(changed.response.store.exclude, ['skill:python-testing']);
  const manual = invoke(resolveArgs);
  assert.equal(manual.code, 0, manual.response.summary);
  assert.deepEqual(manual.response.selection.selectedIds, []);
  assert.equal(manual.response.selection.selectionMode, 'manual');

  setTask({ explicitIds: ['skill:python-testing'] });
  const excluded = invoke(resolveArgs);
  assert.equal(excluded.code, 1);
  assert.match(excluded.response.summary, /excluded/);
  setTask({ proposedIds: ['skill:python-patterns'] });
  assert.equal(invoke(['mode', 'auto', '--state-root', stateRoot]).code, 0);
  const automatic = invoke(resolveArgs);
  assert.equal(automatic.code, 0, automatic.response.summary);
  assert.deepEqual(automatic.response.selection.loadedIds, ['skill:python-patterns']);
}));

test('stored resolution and launch reject every configuration override before reading input', () => cliFixture(({ stateRoot, invoke }) => {
  for (const command of ['resolve', 'run']) {
    for (const override of [['full'], ['--target', 'claude'], ['--selection', 'manual'],
      ['--include', 'skill:python-patterns'], ['--exclude', 'skill:python-testing']]) {
      const result = invoke([command, '--state-root', stateRoot, '--task-input', 'missing', ...override]);
      assert.equal(result.code, 1);
      assert.match(result.response.summary, /cannot override/);
    }
  }
}));

test('launch dry runs never load bodies or execute a provider', () => cliFixture(({ root, input, invoke }) => {
  const provider = providerFixture(root);
  for (const dry of [{ args: ['--dry-run'], env: {} }, { args: [], env: { ECC_DRY_RUN: '1' } }]) {
    const result = invoke(['run', '--task-input', input, ...dry.args],
      { preload: provider.preload, env: { ...provider.env, ...dry.env } });
    assert.equal(result.code, 0, result.response.summary);
    assert.equal(result.response.launch.status, 'proposed');
    assert.deepEqual(result.response.launch.selection.loadedIds, []);
    assert.equal(fs.existsSync(provider.sentinel), false);
  }
}));

test('provider exit failures produce a failed CLI result and preserve the native exit code', () => cliFixture(({ root, input, invoke }) => {
  const provider = providerFixture(root);
  const result = invoke(['run', '--task-input', input], { preload: provider.preload,
    env: { ...provider.env, ECC_TEST_PROVIDER_STATUS: '23' } });
  assert.equal(fs.readFileSync(provider.sentinel, 'utf8'), 'executed');
  assert.equal(result.code, 1);
  assert.equal(result.response.status, 'error');
  assert.equal(result.response.launch.status, 'failed');
  assert.equal(result.response.launch.exitCode, 23);
  assert.equal(result.response.launch.taskSuccess, 'unverified');
  assert.match(result.response.launch.error, /fixture provider failure/);
}));

test('unsupported targets and stale selection digests fail before provider execution', () => cliFixture(({ root, input, invoke }) => {
  const provider = providerFixture(root);
  for (const args of [['--target', 'pi'], ['--expected-digest', '0'.repeat(64)]]) {
    const result = invoke(['run', '--task-input', input, ...args], provider);
    assert.equal(result.code, 1);
    assert.match(result.response.summary, /Unsupported|stale/);
    assert.equal(fs.existsSync(provider.sentinel), false);
  }
}));

test('unconfigured and source-stale stores cannot resolve task context', () => cliFixture(({ stateRoot, input, invoke }) => {
  const args = ['resolve', '--state-root', stateRoot, '--task-input', input, '--load'];
  const absent = invoke(args);
  assert.equal(absent.code, 1);
  assert.match(absent.response.summary, /Configure or recover/);
  withFixture(repoRoot => require('../../scripts/lib/context-profile-store').applyStore({ repoRoot, stateRoot }));
  const stale = invoke(args);
  assert.equal(stale.code, 1);
  assert.match(stale.response.summary, /source is stale/);
}));

test('malformed operation flags and stale write preconditions fail without creating a store', () => cliFixture(({ stateRoot, invoke }) => {
  for (const [args, message] of [
    [['mode', 'unknown', '--state-root', stateRoot], /Choose mode/],
    [['set', 'lean', '--state-root'], /Missing value/],
    [['set', 'lean', '--state-root', stateRoot, '--state-root', stateRoot], /Duplicate argument/],
    [['set', 'lean', '--state-root', stateRoot, '--task-input', 'missing'], /unavailable/],
    [['set', 'lean', '--state-root', stateRoot, '--expected-revision', '01'], /nonnegative integer/],
    [['set', 'lean', '--state-root', stateRoot, '--expected-revision', '1'], /revision changed/],
    [['set', 'lean', '--state-root', stateRoot, '--expected-digest', 'bad'], /Invalid expected/],
    [['set', 'lean', '--state-root', stateRoot, '--expected-digest', '0'.repeat(64)], /digest changed/],
    [['run', '--task-input', 'missing', '--load'], /Unknown argument/],
  ]) {
    const result = invoke(args);
    assert.equal(result.code, 1);
    assert.match(result.response.summary, message);
    assert.equal(fs.existsSync(stateRoot), false);
  }
}));

test('native command routing rejects missing roots and unsupported flags before provider or filesystem work', () => cliFixture(({ root, stateRoot, invoke }) => {
  const nativeRoot = path.join(root, 'native');
  for (const command of ['prepare-native', 'native-status', 'native-rollback', 'native-recover']) {
    for (const [args, pattern] of [
      [[], /requires --state-root/],
      [['--state-root', stateRoot], /requires --native-root/],
      [['--state-root', stateRoot, '--native-root', nativeRoot, '--target', 'codex'], /unavailable/],
      [['--state-root', stateRoot, '--native-root', nativeRoot, '--expected-revision', '1e2'], /nonnegative integer/],
    ]) {
      const result = invoke([command, ...args]);
      assert.equal(result.code, 1);
      assert.match(result.response.summary, pattern);
    }
  }
  const orphan = invoke(['run', '--native-root', nativeRoot, '--task-input', 'missing']);
  assert.equal(orphan.code, 1);
  assert.match(orphan.response.summary, /--native-root requires --state-root/);
  const invalidResolve = invoke(['resolve', '--state-root', stateRoot, '--native-root', nativeRoot, '--task-input', 'missing']);
  assert.equal(invalidResolve.code, 1);
  assert.match(invalidResolve.response.summary, /--native-root is unavailable/);
  assert.equal(fs.existsSync(stateRoot), false);
  assert.equal(fs.existsSync(nativeRoot), false);
}));
