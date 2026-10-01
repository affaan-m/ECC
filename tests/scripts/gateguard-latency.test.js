/**
 * Tests for scripts/dev/gateguard-latency.js.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { quantile, bootstrapDifference, verdict, summarize, measure, parseArgs } = require('../../scripts/dev/gateguard-latency');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

console.log('\n=== Testing gateguard-latency ===\n');

test('quantiles interpolate between ranks', () => {
  assert.strictEqual(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.strictEqual(quantile([4, 1, 3, 2], 0), 1);
  assert.strictEqual(quantile([4, 1, 3, 2], 1), 4);
  assert.ok(Math.abs(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9) - 9.1) < 1e-9);
  assert.ok(Number.isNaN(quantile([], 0.5)));
});

const slow = Array.from({ length: 40 }, (_, i) => 20 + (i % 5));
const fast = Array.from({ length: 40 }, (_, i) => 10 + (i % 5));
const same = Array.from({ length: 40 }, (_, i) => 20 + ((i * 7) % 5));

test('a clearly faster sample is reported faster at p50 and p90', () => {
  assert.strictEqual(verdict(bootstrapDifference(slow, fast, 0.5)), 'faster');
  assert.strictEqual(verdict(bootstrapDifference(slow, fast, 0.9)), 'faster');
});

test('a clearly slower sample is reported slower', () => {
  assert.strictEqual(verdict(bootstrapDifference(fast, slow, 0.5)), 'slower');
});

test('samples from the same distribution show no measurable change', () => {
  assert.strictEqual(verdict(bootstrapDifference(slow, same, 0.5)), 'no measurable change');
  assert.strictEqual(verdict(bootstrapDifference(slow, same, 0.9)), 'no measurable change');
});

test('the interval contains the observed difference and is reproducible', () => {
  const interval = bootstrapDifference(slow, fast, 0.5);
  const observed = quantile(fast, 0.5) - quantile(slow, 0.5);
  assert.ok(interval[0] <= observed && observed <= interval[1], `${observed} outside ${interval}`);
  assert.deepStrictEqual(bootstrapDifference(slow, fast, 0.5), interval);
});

test('summaries compare the working tree with every baseline', () => {
  const rows = summarize({ call: { 'working tree': fast, main: slow } }, ['working tree', 'main']);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].comparisons[0].baseline, 'main');
  assert.strictEqual(rows[0].comparisons[0].p50Verdict, 'faster');
  assert.strictEqual(rows[0].quantiles.main.p50, quantile(slow, 0.5));
});

test('arguments default to upstream/main and validate --runs', () => {
  assert.deepStrictEqual(parseArgs([]).baselines, ['upstream/main']);
  assert.strictEqual(parseArgs(['--runs', '5']).runs, 5);
  assert.throws(() => parseArgs(['--runs', '0']), /incomplete argument/);
  assert.throws(() => parseArgs(['--runs']), /incomplete argument/);
});

test('one round times every call type in fresh processes', () => {
  const hookFile = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'gateguard-fact-force.js');
  const samples = measure([{ label: 'working tree', file: hookFile }], { runs: 1 });
  const calls = Object.keys(samples);
  assert.strictEqual(calls.length, 7);
  for (const call of calls) {
    assert.strictEqual(samples[call]['working tree'].length, 1);
    assert.ok(samples[call]['working tree'][0] > 0, call);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
