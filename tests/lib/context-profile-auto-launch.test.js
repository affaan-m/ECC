'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { withFixture, write } = require('./helpers/context-fixture');
const { launchTaskContext } = require('../../scripts/lib/context-profile-launch');

function fixture(callback) {
  return withFixture(repoRoot => {
    write(repoRoot, 'skills/feature/SKILL.md', '---\nname: feature\ndescription: Handle database changes\n---\nUse an explicit transaction.');
    return callback(repoRoot, { sessionId: 'auto', taskId: 'task', revision: 1, phase: 'implement', query: 'Handle database changes' });
  });
}

test('ambiguous Auto asks for one proposal, validates it, then loads context for the task', () => fixture((repoRoot, task) => {
  let calls = 0;
  const result = launchTaskContext({ repoRoot, task, execute(_command, args, options) {
    calls++;
    if (calls === 1) {
      assert.ok(args.includes('read-only'));
      assert.match(options.input, /Handle database changes/);
      return { status: 0, stdout: '{"selectedIds":["skill:feature"]}' };
    }
    assert.deepEqual(args, ['exec', '-']);
    assert.match(options.input, /explicit transaction/);
    assert.equal(options.timeout, 90000);
    return { status: 0, stdout: 'Task output.' };
  } });
  assert.equal(calls, 2);
  assert.equal(result.routingCalls, 1);
  assert.deepEqual(result.selection.loadedIds, ['skill:feature']);
}));

test('empty proposal is valid and task proceeds without a forced workflow', () => fixture((repoRoot, task) => {
  let calls = 0;
  const result = launchTaskContext({ repoRoot, task, execute() {
    return { status: 0, stdout: ++calls === 1 ? '{"selectedIds":[]}' : 'Task output.' };
  } });
  assert.equal(calls, 2);
  assert.deepEqual(result.selection.loadedIds, []);
}));

test('invalid proposal and source drift stop before task execution', () => fixture((repoRoot, task) => {
  for (const drift of [false, true]) {
    let calls = 0;
    assert.throws(() => launchTaskContext({ repoRoot, task, execute() {
      calls++;
      if (drift) write(repoRoot, 'skills/feature/references/details.md', 'changed after proposal');
      return { status: 0, stdout: drift ? '{"selectedIds":["skill:feature"]}' : '{"selectedIds":["skill:shared"]}' };
    } }), /proposal|source.*changed/i);
    assert.equal(calls, 1);
  }
}));

test('dry-run reports a pending proposal without any provider call', () => fixture((repoRoot, task) => {
  const result = launchTaskContext({ repoRoot, task, dryRun: true, execute() { assert.fail('provider called'); } });
  assert.equal(result.routingCalls, 0);
  assert.equal(result.proposalRequired, true);
  assert.deepEqual(result.selection.loadedIds, []);
}));

test('configured-state drift after a proposal prevents the task call', () => fixture((repoRoot, task) => {
  let calls = 0;
  assert.throws(() => launchTaskContext({ repoRoot, task,
    assertCurrent() { if (calls) throw new Error('Stored profile changed'); }, execute() {
      calls++;
      return { status: 0, stdout: '{"selectedIds":["skill:feature"]}' };
    } }), /Stored profile changed/);
  assert.equal(calls, 1);
}));
