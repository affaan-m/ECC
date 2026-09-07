/**
 * Tests for scripts/lib/success-feedback.js
 */

const assert = require('assert');

const { MILESTONES, OPT_OUT_ENV, emptyState, isOptedOut, normalizeState, recordMilestone, selectMilestone, successFeedbackLines } = require('../../scripts/lib/success-feedback');

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
  }
}

console.log('\nsuccess-feedback');

test('stays quiet before the first milestone', () => {
  assert.strictEqual(selectMilestone(1, emptyState()), null);
  assert.strictEqual(selectMilestone(2, emptyState()), null);
});

test('fires on the first milestone', () => {
  assert.strictEqual(selectMilestone(MILESTONES[0], emptyState()), MILESTONES[0]);
});

test('asks each milestone only once', () => {
  const afterFirst = recordMilestone(emptyState(), MILESTONES[0]);
  assert.strictEqual(selectMilestone(MILESTONES[0], afterFirst), null);
  assert.strictEqual(selectMilestone(MILESTONES[0] + 5, afterFirst), null);
});

test('a late-counting install does not fire every milestone at once', () => {
  const highest = MILESTONES[MILESTONES.length - 1];
  const selected = selectMilestone(highest + 100, emptyState());
  assert.strictEqual(selected, highest);

  const afterHighest = recordMilestone(emptyState(), highest);
  assert.strictEqual(selectMilestone(highest + 100, afterHighest), null);
});

test('recording is immutable', () => {
  const before = emptyState();
  const after = recordMilestone(before, MILESTONES[0]);
  assert.deepStrictEqual([...before.prompted], []);
  assert.deepStrictEqual([...after.prompted], [MILESTONES[0]]);
});

test('recording the same milestone twice is a no-op', () => {
  const once = recordMilestone(emptyState(), MILESTONES[0]);
  const twice = recordMilestone(once, MILESTONES[0]);
  assert.deepStrictEqual([...twice.prompted], [MILESTONES[0]]);
});

test('corrupt or foreign state resets instead of throwing', () => {
  assert.deepStrictEqual([...normalizeState(null).prompted], []);
  assert.deepStrictEqual([...normalizeState('nope').prompted], []);
  assert.deepStrictEqual([...normalizeState({ version: 'other', prompted: [3] }).prompted], []);
  assert.deepStrictEqual([...normalizeState({ version: emptyState().version, prompted: ['x', 3] }).prompted], [3]);
});

test('invalid session counts never prompt', () => {
  assert.strictEqual(selectMilestone(0, emptyState()), null);
  assert.strictEqual(selectMilestone(-4, emptyState()), null);
  assert.strictEqual(selectMilestone(2.5, emptyState()), null);
  assert.strictEqual(selectMilestone('9', emptyState()), null);
});

test('opt-out is respected and defaults to off', () => {
  assert.strictEqual(isOptedOut({}), false);
  assert.strictEqual(isOptedOut({ [OPT_OUT_ENV]: '' }), false);
  assert.strictEqual(isOptedOut({ [OPT_OUT_ENV]: '0' }), false);
  assert.strictEqual(isOptedOut({ [OPT_OUT_ENV]: '1' }), true);
  assert.strictEqual(isOptedOut({ [OPT_OUT_ENV]: 'yes' }), true);
});

test('prompt names the form, the privacy stance, and the opt-out', () => {
  const lines = successFeedbackLines(MILESTONES[0]);
  assert.strictEqual(lines.length, 3);
  assert.ok(lines.join('\n').includes('quick-feedback.yml'), 'missing feedback form link');
  assert.ok(lines.join('\n').includes('Nothing is uploaded'), 'missing privacy line');
  assert.ok(lines.join('\n').includes(OPT_OUT_ENV), 'missing opt-out hint');
});

if (failures > 0) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}

console.log('\nAll success-feedback tests passed');
