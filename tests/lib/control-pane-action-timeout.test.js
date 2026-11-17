'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { runAction } = require('../../scripts/lib/control-pane/server');

function action(script) {
  return { id: 'timeout-regression', command: process.execPath, args: ['-e', script], cwd: process.cwd() };
}

test('an action that ignores SIGTERM is forcibly stopped after the grace period', {
  skip: process.platform === 'win32', timeout: 7000,
}, async () => {
  const result = await runAction(action(`
    process.on('SIGTERM', () => process.stderr.write('term received\\n'));
    process.stdout.write('ready\\n');
    setInterval(() => {}, 100);
    setTimeout(() => process.exit(23), 3500);
  `), { timeoutMs: 500 });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.signal, 'SIGKILL');
  assert.strictEqual(result.code, null);
  assert.strictEqual(result.timedOut, true);
  assert.match(result.error, /timed out.*500/);
  assert.strictEqual(result.stdout, 'ready\n');
  assert.strictEqual(result.stderr, 'term received\n');
});

test('a timed-out action exiting zero during graceful termination is still a failure', {
  skip: process.platform === 'win32', timeout: 7000,
}, async () => {
  const result = await runAction(action(`
    process.on('SIGTERM', () => {
      process.stderr.write('cleaning up\\n');
      setTimeout(() => process.exit(0), 20);
    });
    process.stdout.write('ready\\n');
    setInterval(() => {}, 100);
    setTimeout(() => process.exit(23), 3500);
  `), { timeoutMs: 500 });
  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.signal, null);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.timedOut, true);
  assert.match(result.error, /timed out.*500/);
  assert.strictEqual(result.stdout, 'ready\n');
  assert.strictEqual(result.stderr, 'cleaning up\n');
});

test('ordinary success and failure retain their exit codes and complete output', async () => {
  for (const code of [0, 7]) {
    const result = await runAction(action(`
      process.stdout.write('output\\n');
      process.stderr.write('diagnostic\\n');
      process.exitCode = ${code};
    `), { timeoutMs: 5000 });
    assert.strictEqual(result.ok, code === 0);
    assert.strictEqual(result.code, code);
    assert.strictEqual(result.signal, null);
    assert.notStrictEqual(result.timedOut, true);
    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.stdout, 'output\n');
    assert.strictEqual(result.stderr, 'diagnostic\n');
  }
});

test('a spawn failure resolves without acquiring a timeout outcome', async () => {
  const result = await runAction({
    id: 'missing-executable', command: 'ecc-nonexistent-action-timeout-fixture', args: [], cwd: process.cwd(),
  }, { timeoutMs: 5000 });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, null);
  assert.match(result.error, /ENOENT/);
  assert.notStrictEqual(result.timedOut, true);
});

test('successful action cleanup leaves no timeout keeping the runner alive', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const { runAction } = require(process.argv[1]);
    runAction({ id: 'short', command: process.execPath, args: ['-e', ''], cwd: process.cwd() },
      { timeoutMs: 60000 }).then(result => { if (!result.ok) process.exitCode = 1; });
  `, require.resolve('../../scripts/lib/control-pane/server')], { encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stderr);
});
