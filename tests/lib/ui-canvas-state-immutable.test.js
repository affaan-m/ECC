'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSessionStore } = require('../../scripts/lib/plan-canvas/sessions');

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
let passed = 0;
let failed = 0;
function test(name, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ui-immutable-'));
  try {
    const store = createSessionStore({ stateDir: directory });
    const original = store.open(path.join(directory, 'card.html'), { mode: 'ui' }).session;
    run({ store, original, directory }); passed++; console.log(`PASS ${name}`);
  } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack}`); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
const item = { kind: 'edits', edits: [{ id: 'e1', kind: 'nudge', selector: '#a', dx: 1, dy: 0 }], snapshotHash: 'a'.repeat(64) };
test('queue replaces state only after persistence and preserves retained snapshots', ({ store, original, directory }) => {
  const unrelated = store.open(path.join(directory, 'other.html')).session;
  const before = JSON.stringify(original); freeze(original);
  const result = store.queueFeedback(original.key, [item], { deliveryId: 'a'.repeat(32), fingerprint: 'proof' });
  const current = store.get(original.key);
  assert.notEqual(current, original); assert.equal(result.session, current);
  assert.equal(JSON.stringify(original), before); assert.equal(store.get(unrelated.key), unrelated);
  assert.equal(current.pendingFeedback.length, 1); assert.equal(current.uiBatches.length, 1);
  assert.equal(current.uiDeliveries['a'.repeat(32)].itemIds[0], 'fb-1');
  assert.deepEqual(createSessionStore({ stateDir: directory }).get(original.key), current);
});
test('acknowledgment and drain replace sessions without changing prior queue snapshots', ({ store, original }) => {
  store.queueFeedback(original.key, [item]); const queued = store.get(original.key); freeze(queued);
  const id = queued.uiBatches[0].id; store.acknowledgeUiBatches(original.key, [id], 'Applied');
  const acknowledged = store.get(original.key); freeze(acknowledged);
  assert.notEqual(acknowledged, queued); assert.equal(queued.uiBatches.length, 1);
  assert.equal(queued.chat.length, 1); assert.equal(acknowledged.uiBatches.length, 0);
  const result = store.takeFeedback(original.key); const drained = store.get(original.key);
  assert.notEqual(drained, acknowledged); assert.equal(result.items.length, 1);
  assert.equal(acknowledged.pendingFeedback.length, 1); assert.equal(drained.pendingFeedback.length, 0);
  assert.equal(drained.status, 'open'); assert.equal(store.takeFeedback(original.key).status, 'waiting');
});
test('failed candidate persistence never publishes queue, Finish, ack, drain or counter changes', ({ store, original, directory }) => {
  const obstacle = path.join(directory, 'sessions.json.tmp');
  fs.mkdirSync(obstacle); freeze(original);
  assert.throws(() => store.queueFeedback(original.key, [item], { endSession: true }));
  assert.equal(store.get(original.key), original); assert.equal(original.status, 'open');
  fs.rmdirSync(obstacle); store.queueFeedback(original.key, [item], { endSession: true });
  const queued = store.get(original.key); freeze(queued); assert.equal(queued.pendingFeedback[0].id, 'fb-1');
  const disk = fs.readFileSync(store.stateFile, 'utf8'); fs.mkdirSync(obstacle);
  assert.throws(() => store.acknowledgeUiBatches(original.key, ['fb-1'], 'Not saved'));
  assert.throws(() => store.takeFeedback(original.key));
  assert.equal(store.get(original.key), queued); assert.equal(fs.readFileSync(store.stateFile, 'utf8'), disk);
  fs.rmdirSync(obstacle); const result = store.takeFeedback(original.key);
  assert.equal(result.sessionEnded, true); assert.equal(result.endedBy, 'user');
  assert.equal(store.get(original.key).status, 'ended'); assert.equal(queued.pendingFeedback.length, 1);
});
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
