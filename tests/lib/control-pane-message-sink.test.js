'use strict';
/**
 * Tests for the proximity message sink (ecc-tui messages send) and the
 * deduping dispatcher.
 */

const assert = require('assert');

const { KIND_BY_TYPE, buildSendArgs, createEccMessageSink, resolveEccBin } = require('../../scripts/lib/control-pane/message-sink');
const { createProximityDispatcher } = require('../../scripts/lib/control-pane/proximity');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (e) {
    console.log(`  FAIL ${name}`);
    console.log(`    ${e.message}`);
    failed += 1;
  }
}

console.log('\n=== Testing proximity message sink ===\n');

test('buildSendArgs: maps trigger type to message kind and shapes the CLI argv', () => {
  const args = buildSendArgs({ fromSession: 'lead', toSession: 'worker', content: 'steer away', msgType: 'proximity_steer' });
  assert.deepStrictEqual(args, ['messages', 'send', '--from', 'lead', '--to', 'worker', '--kind', 'conflict', '--text', 'steer away']);
  assert.strictEqual(KIND_BY_TYPE.proximity_transmit, 'query');
});

test('createEccMessageSink: delivers via the injected runner with the resolved binary', () => {
  const calls = [];
  const send = createEccMessageSink({
    binPath: '/fake/ecc-tui',
    runCommand: (bin, args) => calls.push({ bin, args })
  });
  send({ fromSession: 'a', toSession: 'b', content: 'hello', msgType: 'proximity_transmit' });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].bin, '/fake/ecc-tui');
  assert.deepStrictEqual(calls[0].args.slice(0, 2), ['messages', 'send']);
  assert.ok(calls[0].args.includes('query'), 'transmit maps to query kind');
});

test('createEccMessageSink: a failing command propagates (dispatcher will count it skipped)', () => {
  const send = createEccMessageSink({
    binPath: 'ecc-tui',
    runCommand: () => {
      throw new Error('ENOENT');
    }
  });
  assert.throws(() => send({ fromSession: 'a', toSession: 'b', content: 'x', msgType: 'proximity_steer' }));
});

test('resolveEccBin: honors explicit override', () => {
  assert.strictEqual(resolveEccBin({ binPath: '/x/ecc-tui' }), '/x/ecc-tui');
});

test('dispatcher: fires once then suppresses the same trigger within cooldown', () => {
  let clock = 1000;
  const sent = [];
  const dispatcher = createProximityDispatcher({
    sendMessage: m => sent.push(m),
    cooldownMs: 1000,
    now: () => clock
  });
  const triggers = [{ to: 'worker', from: 'lead', type: 'proximity_steer', content: 'steer' }];

  const r1 = dispatcher.dispatch(triggers);
  assert.strictEqual(r1.dispatched, 1);

  clock = 1500; // within cooldown
  const r2 = dispatcher.dispatch(triggers);
  assert.strictEqual(r2.dispatched, 0);
  assert.strictEqual(r2.suppressed, 1);

  clock = 2600; // past cooldown
  const r3 = dispatcher.dispatch(triggers);
  assert.strictEqual(r3.dispatched, 1);

  assert.strictEqual(sent.length, 2, 'sent twice total, the middle one suppressed');
});

test('dispatcher: distinct triggers are not cross-suppressed', () => {
  const sent = [];
  const dispatcher = createProximityDispatcher({ sendMessage: m => sent.push(m), now: () => 0 });
  const r = dispatcher.dispatch([
    { to: 'worker', from: 'lead', type: 'proximity_steer', content: 'a' },
    { to: 'lead', from: 'worker', type: 'proximity_hold', content: 'b' }
  ]);
  assert.strictEqual(r.dispatched, 2);
});

test('dispatcher: no sink ⇒ skipped, never throws', () => {
  const dispatcher = createProximityDispatcher({});
  const r = dispatcher.dispatch([{ to: 'a', from: 'b', type: 'x', content: 'c' }]);
  assert.strictEqual(r.skipped, 1);
  assert.strictEqual(r.dispatched, 0);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
