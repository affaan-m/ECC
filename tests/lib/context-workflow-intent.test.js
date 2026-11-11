'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { withFixture } = require('./helpers/context-fixture');
const { resolveTaskContext } = require('../../scripts/lib/context-selection');
const { launchTaskContext } = require('../../scripts/lib/context-profile-launch');
const { digestObject } = require('../../scripts/lib/context-profile-support');

const task = { sessionId: 'workflow-session', taskId: 'workflow-task', revision: 1,
  phase: 'implement', query: 'Use the feature skill.' };

for (const intent of [{ noWorkflow: false }, {}]) {
  test(`clearing noWorkflow reroutes a pinned empty selection (${JSON.stringify(intent)})`, () => withFixture(repoRoot => {
    const skipped = resolveTaskContext({ repoRoot, task: { ...task, noWorkflow: true }, load: true });
    assert.equal(skipped.reason, 'no-workflow-needed');
    assert.deepEqual(skipped.loadedIds, []);

    const resumed = resolveTaskContext({ repoRoot, task: { ...task, ...intent }, previous: skipped.receipt, load: true });
    assert.equal(resumed.reused, false);
    assert.equal(resumed.reason, 'auto-selection');
    assert.deepEqual(resumed.selectedIds, ['skill:feature']);
    assert.deepEqual(resumed.loadedIds, ['skill:feature']);
    assert.match(resumed.resources[0].content, /# feature/);
    assert.notEqual(resumed.receipt.selectionDigest, skipped.receipt.selectionDigest);
    assert.throws(() => resolveTaskContext({ repoRoot, task: { ...task, ...intent }, previous: skipped.receipt,
      expectedDigest: skipped.receipt.selectionDigest, load: true }), /stale/);
  }));
}

test('omitted and false workflow opt-outs preserve the same reusable selection', () => withFixture(repoRoot => {
  const initial = resolveTaskContext({ repoRoot, task, load: true });
  const unchanged = resolveTaskContext({ repoRoot, task: { ...task, noWorkflow: false }, previous: initial.receipt, load: true });
  assert.equal(unchanged.reused, true);
  assert.equal(unchanged.receipt.bindingDigest, initial.receipt.bindingDigest);
  assert.deepEqual(unchanged.loadedIds, ['skill:feature']);

  const skipped = resolveTaskContext({ repoRoot, task: { ...task, noWorkflow: true }, previous: unchanged.receipt, load: true });
  assert.equal(skipped.reused, false);
  assert.equal(skipped.reason, 'no-workflow-needed');
  assert.deepEqual(skipped.selectedIds, []);
  assert.deepEqual(skipped.resources, []);
}));

test('receipts without recorded workflow intent are resolved again', () => withFixture(repoRoot => {
  const skipped = resolveTaskContext({ repoRoot, task: { ...task, noWorkflow: true } });
  const { noWorkflow: _intent, receiptDigest: _digest, ...legacy } = skipped.receipt;
  const resumed = resolveTaskContext({ repoRoot, task, load: true,
    previous: { ...legacy, receiptDigest: digestObject(legacy) } });
  assert.equal(resumed.reused, false);
  assert.deepEqual(resumed.loadedIds, ['skill:feature']);
}));

test('an agent proposal can decline workflow context without invalidating the task source', () => withFixture(repoRoot => {
  const calls = [];
  const result = launchTaskContext({ repoRoot, task: { ...task, query: 'feature' },
    execute(_command, _args, options) {
      calls.push(options.phase);
      if (options.phase === 'selection') return { status: 0, stdout: '{"selectedIds":[]}' };
      assert.match(options.input, /"selectedIds":\[\]/);
      return { status: 0, stdout: 'done' };
    } });
  assert.deepEqual(calls, ['selection', 'task']);
  assert.equal(result.status, 'completed');
  assert.equal(result.selection.reason, 'agent-declined-selection');
  assert.deepEqual(result.selection.loadedIds, []);
}));
