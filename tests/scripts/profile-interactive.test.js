'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const CLI = path.resolve(__dirname, '../../scripts/ecc.js');
const task = { sessionId: 'stdin-session', taskId: 'stdin-task', revision: 1,
  phase: 'implement', explicitIds: ['skill:python-patterns'] };
function invoke(args, input) {
  return spawnSync(process.execPath, [CLI, 'profile', ...args, '--json'], {
    input, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
}

test('resolve accepts bounded task JSON on stdin without creating task files', () => {
  const result = invoke(['resolve', '--task-input', '-', '--load'], JSON.stringify(task));
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).selection.loadedIds, ['skill:python-patterns']);
});

test('stdin task JSON rejects overflow, malformed UTF-8, NUL, and invalid JSON', () => {
  for (const [input, message] of [[Buffer.alloc(65537, 32), /65536/], [Buffer.from([0xff]), /UTF-8/],
    ['\0', /UTF-8/], ['{', /JSON/]]) {
    const result = invoke(['resolve', '--task-input', '-'], input);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).summary, message);
  }
});

test('malformed task JSON never echoes private input through the CLI envelope', () => {
  const secret = 'PRIVATE_TASK_SENTINEL';
  const result = invoke(['resolve', '--task-input', '-'], `{"task":"${secret}"`);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).summary, /valid JSON/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
});

test('start requires both roots, rejects authority flags, and dry-run never prepares a native home', () => {
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc-start-cli-'));
  try {
    const stateRoot = path.join(parent, 'state');
    const nativeRoot = path.join(parent, 'native');
    for (const [args, message] of [[[], /requires --state-root/],
      [['--state-root', stateRoot], /requires --native-root/],
      [['--state-root', stateRoot, '--native-root', nativeRoot, '--dangerously-bypass-approvals-and-sandbox'], /Unknown argument/]]) {
      const result = invoke(['start', ...args]);
      assert.equal(result.status, 1);
      assert.match(JSON.parse(result.stdout).summary, message);
    }
    assert.equal(invoke(['set', 'lean', '--state-root', stateRoot]).status, 0);
    const jsonStart = invoke(['start', '--state-root', stateRoot, '--native-root', nativeRoot]);
    assert.equal(jsonStart.status, 1);
    assert.match(JSON.parse(jsonStart.stdout).summary, /--json requires --dry-run/);
    const result = invoke(['start', '--state-root', stateRoot, '--native-root', nativeRoot, '--dry-run']);
    assert.equal(result.status, 0, result.stdout);
    assert.equal(JSON.parse(result.stdout).interactive.status, 'proposed');
    assert.equal(fs.existsSync(nativeRoot), false);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});
