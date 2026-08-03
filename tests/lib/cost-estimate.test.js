/**
 * Tests for scripts/lib/cost-estimate.js
 *
 * Run with: node tests/lib/cost-estimate.test.js
 */

const assert = require('assert');

const { estimateCost, RATE_TABLE } = require('../../scripts/lib/cost-estimate');

// Test helper
function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing cost-estimate.js ===\n');

  let passed = 0;
  let failed = 0;

  // RATE_TABLE structure
  console.log('RATE_TABLE:');

  if (
    test('RATE_TABLE has haiku, sonnet, opus, fable keys', () => {
      assert.ok(RATE_TABLE.haiku, 'Missing haiku');
      assert.ok(RATE_TABLE.sonnet, 'Missing sonnet');
      assert.ok(RATE_TABLE.opus, 'Missing opus');
      assert.ok(RATE_TABLE.fable, 'Missing fable');
      assert.strictEqual(typeof RATE_TABLE.haiku.in, 'number');
      assert.strictEqual(typeof RATE_TABLE.haiku.out, 'number');
      assert.strictEqual(typeof RATE_TABLE.sonnet.in, 'number');
      assert.strictEqual(typeof RATE_TABLE.sonnet.out, 'number');
      assert.strictEqual(typeof RATE_TABLE.opus.in, 'number');
      assert.strictEqual(typeof RATE_TABLE.opus.out, 'number');
      assert.strictEqual(typeof RATE_TABLE.fable.in, 'number');
      assert.strictEqual(typeof RATE_TABLE.fable.out, 'number');
    })
  )
    passed++;
  else failed++;

  // estimateCost tests
  console.log('\nestimateCost:');

  if (
    test('opus 1M/1M tokens returns 30', () => {
      const cost = estimateCost('opus', 1_000_000, 1_000_000);
      assert.strictEqual(cost, 30);
    })
  )
    passed++;
  else failed++;

  if (
    test('fable 1M/1M tokens returns 60', () => {
      const cost = estimateCost('fable', 1_000_000, 1_000_000);
      assert.strictEqual(cost, 60);
    })
  )
    passed++;
  else failed++;

  if (
    test('sonnet 1M/1M tokens returns 18', () => {
      const cost = estimateCost('sonnet', 1_000_000, 1_000_000);
      assert.strictEqual(cost, 18);
    })
  )
    passed++;
  else failed++;

  if (
    test('haiku 1M/1M tokens returns 4.8', () => {
      const cost = estimateCost('haiku', 1_000_000, 1_000_000);
      assert.strictEqual(cost, 4.8);
    })
  )
    passed++;
  else failed++;

  if (
    test('null model returns null', () => {
      const cost = estimateCost(null, 0, 0);
      assert.strictEqual(cost, null);
    })
  )
    passed++;
  else failed++;

  if (
    test('full model name claude-opus-4-6 uses opus rates', () => {
      const cost = estimateCost('claude-opus-4-6', 500, 200);
      // (500 / 1_000_000) * 5 + (200 / 1_000_000) * 25 = 0.0025 + 0.005 = 0.0075
      const expected = Math.round(0.0075 * 1e6) / 1e6;
      assert.strictEqual(cost, expected);
    })
  )
    passed++;
  else failed++;

  if (
    test('unknown model returns null', () => {
      const cost = estimateCost('unknown-model', 1_000_000, 1_000_000);
      assert.strictEqual(cost, null);
    })
  )
    passed++;
  else failed++;

  // Summary
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

const { failed } = runTests();
process.exit(failed > 0 ? 1 : 0);
