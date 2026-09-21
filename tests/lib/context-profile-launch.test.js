'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { withFixture } = require('./helpers/context-fixture');
const { launchTaskContext } = require('../../scripts/lib/context-profile-launch');
const input = { sessionId: 'launch', taskId: 'task', revision: 1, phase: 'implement', query: 'Explain a Python list', explicitIds: ['skill:feature'] };

function nativeFixture(repoRoot) {
  const home = path.join(fs.realpathSync(repoRoot), 'isolated-home');
  const codexPath = path.join(fs.realpathSync(repoRoot), 'provider-bin');
  const bytes = Buffer.from('7f454c460102030405060708', 'hex');
  fs.writeFileSync(codexPath, bytes);
  return { home, codexHome: path.join(home, '.codex'), codexPath,
    executableDigest: crypto.createHash('sha256').update(bytes).digest('hex') };
}

test('Auto launcher resolves context and supplies it on stdin without permission overrides', () => withFixture(repoRoot => {
  let called = 0;
  const result = launchTaskContext({ repoRoot, task: input, target: 'codex', execute(command, args, options) {
    called++;
    assert.equal(command, 'codex');
    assert.deepEqual(args, ['exec', '-']);
    assert.ok(options.input.includes(input.query));
    assert.match(options.input, /# feature/);
    assert.equal(options.shell, false);
    assert.equal(options.killSignal, 'SIGKILL');
    return { status: 0, stdout: 'A list is a sequence.', stderr: '' };
  } });
  assert.equal(called, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.taskSuccess, 'unverified');
  assert.equal(result.selection.receipt.loadedIds.length, 1);
}));

test('dry-run neither loads bodies nor invokes a provider', () => withFixture(repoRoot => {
  const result = launchTaskContext({ repoRoot, task: input, dryRun: true, execute() { assert.fail('must not execute'); } });
  assert.equal(result.status, 'proposed');
  assert.deepEqual(result.selection.loadedIds, []);
}));

test('Claude uses documented print mode and receives context as ordinary input', () => withFixture(repoRoot => {
  launchTaskContext({ repoRoot, task: input, target: 'claude', execute(command, args) {
    assert.equal(command, 'claude');
    assert.deepEqual(args, ['--print']);
    return { status: 0, stdout: 'ok', stderr: '' };
  } });
}));

test('unsupported providers and failed selection cannot invoke a process', () => withFixture(repoRoot => {
  assert.throws(() => launchTaskContext({ repoRoot, task: input, target: 'pi' }), /unsupported/i);
  assert.throws(() => launchTaskContext({ repoRoot, task: input, exclude: ['skill:feature'], execute() { assert.fail('must not execute'); } }), /excluded/);
}));

test('provider failure is distinct from successful task completion', () => withFixture(repoRoot => {
  const result = launchTaskContext({ repoRoot, task: input, execute: () => ({ status: 2, stdout: '', stderr: 'authentication required' }) });
  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 2);
  assert.equal(result.taskSuccess, 'unverified');
}));

test('isolated native launches replace every provider home without mutating the parent environment', () => withFixture(repoRoot => {
  const nativeEnvironment = nativeFixture(repoRoot);
  const before = { ...process.env };
  let called = false;
  const result = launchTaskContext({ repoRoot, task: input, nativeEnvironment, execute(command, args, options) {
    called = true;
    assert.equal(command, nativeEnvironment.codexPath);
    assert.deepEqual(args, ['exec', '-']);
    assert.notEqual(options.env, process.env);
    assert.equal(options.env.HOME, nativeEnvironment.home);
    assert.equal(options.env.USERPROFILE, nativeEnvironment.home);
    assert.equal(options.env.CODEX_HOME, nativeEnvironment.codexHome);
    assert.equal(options.env.PATH, before.PATH);
    for (const key of ['AWS_ACCESS_KEY_ID', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'HTTP_PROXY', 'NODE_OPTIONS']) {
      assert.equal(options.env[key], undefined);
    }
    assert.equal(options.shell, false);
    assert.equal(options.timeout, 120000);
    assert.equal(options.killSignal, 'SIGKILL');
    assert.equal(options.maxBuffer, 1024 * 1024);
    return { status: 0, stdout: 'ok' };
  } });
  assert.equal(called, true);
  assert.equal(result.providerConfiguration, 'isolated-native-generation');
  assert.deepEqual({ ...process.env }, before);
}));

test('isolated native dry-run avoids provider calls and leaves context unloaded', () => withFixture(repoRoot => {
  const result = launchTaskContext({ repoRoot, task: input, dryRun: true,
    nativeEnvironment: nativeFixture(repoRoot),
    execute() { assert.fail('Dry-run must not invoke a provider'); } });
  assert.equal(result.status, 'proposed');
  assert.equal(result.providerConfiguration, 'isolated-native-generation');
  assert.deepEqual(result.selection.resources, []);
}));

test('invalid native environment and empty query fail before provider calls', () => withFixture(repoRoot => {
  const execute = () => assert.fail('Invalid launch must not invoke a provider');
  for (const nativeEnvironment of [{}, { home: 'relative', codexHome: repoRoot },
    { home: repoRoot, codexHome: 'relative' }, { home: repoRoot, codexHome: repoRoot },
    { ...nativeFixture(repoRoot), codexPath: 'relative' },
    { ...nativeFixture(repoRoot), executableDigest: 'not-a-digest' }]) {
    assert.throws(() => launchTaskContext({ repoRoot, task: input, nativeEnvironment, execute }), /Invalid isolated/);
  }
  assert.throws(() => launchTaskContext({ repoRoot, task: input, target: 'claude', execute,
    nativeEnvironment: { home: repoRoot, codexHome: repoRoot } }), /Invalid isolated/);
  assert.throws(() => launchTaskContext({ repoRoot, task: { ...input, query: '  ' }, execute }), /non-empty query/);
}));

test('pinned native executable digest mismatch stops before any provider call', () => withFixture(repoRoot => {
  const nativeEnvironment = { ...nativeFixture(repoRoot), executableDigest: '0'.repeat(64) };
  assert.throws(() => launchTaskContext({ repoRoot, task: input, nativeEnvironment,
    execute() { assert.fail('Mismatched executable must never run'); } }), /executable.*changed|digest.*mismatch/i);
}));

test('native executable drift during Auto proposal prevents the task process', () => withFixture(repoRoot => {
  const nativeEnvironment = nativeFixture(repoRoot);
  fs.writeFileSync(path.join(repoRoot, 'skills/feature/SKILL.md'),
    '---\nname: feature\ndescription: Handle database changes\n---\nUse an explicit transaction.');
  const task = { ...input, explicitIds: [], query: 'Handle database changes' };
  let calls = 0;
  assert.throws(() => launchTaskContext({ repoRoot, task, nativeEnvironment, execute(command, args, options) {
    calls++;
    assert.equal(command, nativeEnvironment.codexPath);
    assert.ok(args.includes('read-only'));
    assert.equal(options.env.CODEX_HOME, nativeEnvironment.codexHome);
    fs.appendFileSync(nativeEnvironment.codexPath, Buffer.from([9]));
    return { status: 0, stdout: '{"selectedIds":["skill:feature"]}' };
  } }), /executable.*changed|digest.*mismatch/i);
  assert.equal(calls, 1);
}));

test('configured-state refusal precedes the Auto proposal process', () => withFixture(repoRoot => {
  fs.writeFileSync(path.join(repoRoot, 'skills/feature/SKILL.md'),
    '---\nname: feature\ndescription: Handle database changes\n---\nUse an explicit transaction.');
  assert.throws(() => launchTaskContext({ repoRoot,
    task: { ...input, explicitIds: [], query: 'Handle database changes' },
    assertCurrent() { throw new Error('Stored profile changed'); },
    execute() { assert.fail('Stale state must not start proposal'); } }), /Stored profile changed/);
}));

test('spawn failures and timeout signals remain unsuccessful without a native exit status', () => withFixture(repoRoot => {
  for (const error of [new Error('spawn codex ENOENT'), new Error('spawn codex ETIMEDOUT')]) {
    const result = launchTaskContext({ repoRoot, task: input,
      execute: () => ({ status: null, signal: 'SIGTERM', error }) });
    assert.equal(result.status, 'failed');
    assert.equal(result.exitCode, 1);
    assert.equal(result.output, '');
    assert.equal(result.error, error.message);
    assert.equal(result.taskSuccess, 'unverified');
  }
}));
