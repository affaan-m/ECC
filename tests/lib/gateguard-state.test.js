'use strict';
/**
 * Tests for scripts/lib/gateguard-state.js.
 *
 * Run with: node tests/lib/gateguard-state.test.js
 */

const assert = require('assert');
const path = require('path');

const {
  getDenialCount,
  getCapAllowCount,
  getTrivialAllowCount,
  getRoutineReadonlyPassCount,
  getClassCounts,
  mergeClassCounts,
  incrementClassCount,
  dirGateKey,
  getDirGates,
  mergeDirGates,
  capDirGates
} = require(path.join(__dirname, '..', '..', 'scripts', 'lib', 'gateguard-state.js'));

console.log('=== Testing gateguard-state.js ===\n');

let passed = 0;
let failed = 0;

function test(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${desc}: ${e.message}`);
    failed++;
  }
}

test('trivial_allows reads as a non-negative integer', () => {
  assert.strictEqual(getTrivialAllowCount({ trivial_allows: 3 }), 3);
  for (const bad of [undefined, null, -1, 'x', NaN, Infinity, {}]) {
    assert.strictEqual(getTrivialAllowCount({ trivial_allows: bad }), 0, String(bad));
  }
  assert.strictEqual(getTrivialAllowCount(null), 0);
});

test('routine_readonly_passes reads as a non-negative integer', () => {
  assert.strictEqual(getRoutineReadonlyPassCount({ routine_readonly_passes: 4 }), 4);
  for (const bad of [undefined, null, -1, 'x', NaN, Infinity, {}]) {
    assert.strictEqual(getRoutineReadonlyPassCount({ routine_readonly_passes: bad }), 0, String(bad));
  }
  assert.strictEqual(getRoutineReadonlyPassCount(null), 0);
});

test('malformed or missing counters read as zero', () => {
  assert.strictEqual(getDenialCount(null), 0);
  assert.strictEqual(getDenialCount({ fact_force_denials: 'x' }), 0);
  assert.strictEqual(getDenialCount({ fact_force_denials: -3 }), 0);
  assert.strictEqual(getDenialCount({ fact_force_denials: 2.9 }), 2);
  assert.strictEqual(getCapAllowCount({ cap_allows: Infinity }), 0);
});

test('class counts reject prototype keys and non-numeric values', () => {
  const counts = getClassCounts(JSON.parse('{"denials_by_class":{"__proto__":5,"code":2,"test":"3","prose":0}}'), 'denials_by_class');
  assert.deepStrictEqual(Object.entries(counts), [['code', 2]]);
  assert.strictEqual(Object.getPrototypeOf(counts), null);
  assert.strictEqual(incrementClassCount(counts, 'constructor'), counts);
  assert.strictEqual(incrementClassCount(counts, 'code').code, 3);
  assert.strictEqual(mergeClassCounts(counts, { code: 1, test: 4 }).test, 4);
});

test('dir gates keep valid class-prefixed entries, newest wins on merge, capped at 50', () => {
  const key = dirGateKey('code', '/p/src');
  const gates = getDirGates({
    dir_gates: {
      [key]: { turn: 't1', at: 10, first: '/p/src/a.js', ordinal: 1 },
      '/p/old-shape': { turn: null, at: 10, first: '/p/old-shape/a.js', ordinal: 1 },
      [dirGateKey('config', '/p/cfg')]: { turn: null, at: 10, first: '/p/cfg/a.json', ordinal: 1 },
      [dirGateKey('test', '/p/bad')]: { at: 'soon', first: '/p/bad/a.js' }
    }
  });
  assert.deepStrictEqual(Object.keys(gates), [key]);
  const merged = mergeDirGates(gates, { [key]: { turn: 't2', at: 20, first: '/p/src/b.js', ordinal: 2 } });
  assert.strictEqual(merged[key].turn, 't2');
  const many = {};
  for (let i = 0; i < 60; i++) many[dirGateKey('code', `/p/d${i}`)] = { turn: null, at: i, first: `/p/d${i}/a.js`, ordinal: 1 };
  const capped = capDirGates(many);
  assert.strictEqual(Object.keys(capped).length, 50);
  assert.ok(!(dirGateKey('code', '/p/d0') in capped), 'oldest evicted');
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
