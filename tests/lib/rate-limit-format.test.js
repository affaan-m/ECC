/**
 * Tests for scripts/lib/rate-limit-format.js
 *
 * Run with: node tests/lib/rate-limit-format.test.js
 */

const assert = require('assert');

const { formatCountdown, buildRateLimitSegment } = require('../../scripts/lib/rate-limit-format');

// Test helper
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    return false;
  }
}

const NOW_MS = 1738425600000; // fixed clock so every expectation is exact
const NOW_SEC = NOW_MS / 1000;
// eslint-disable-next-line no-control-regex -- ANSI escapes are what these tests assert on
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');

function runTests() {
  let passed = 0;
  let failed = 0;

  console.log('\nformatCountdown()\n');

  // resets_at is documented as Unix epoch SECONDS. Passing it to a Date
  // constructor unscaled lands in 1970, so the seconds handling is the
  // single most important thing to pin down here.
  if (
    test('epoch seconds are scaled to milliseconds, not read as ms', () => {
      assert.strictEqual(formatCountdown(NOW_SEC + 4320, NOW_MS), '1h12m');
    })
  )
    passed++;
  else failed++;

  if (
    test('under an hour reports minutes', () => {
      assert.strictEqual(formatCountdown(NOW_SEC + 1500, NOW_MS), '25m');
    })
  )
    passed++;
  else failed++;

  if (
    test('under a minute reports seconds', () => {
      assert.strictEqual(formatCountdown(NOW_SEC + 42, NOW_MS), '42s');
    })
  )
    passed++;
  else failed++;

  if (
    test('a whole number of hours omits the minutes', () => {
      assert.strictEqual(formatCountdown(NOW_SEC + 7200, NOW_MS), '2h');
    })
  )
    passed++;
  else failed++;

  if (
    test('a reset already in the past clamps to 0s instead of going negative', () => {
      assert.strictEqual(formatCountdown(NOW_SEC - 900, NOW_MS), '0s');
    })
  )
    passed++;
  else failed++;

  if (
    test('null, undefined and NaN return empty string', () => {
      assert.strictEqual(formatCountdown(null, NOW_MS), '');
      assert.strictEqual(formatCountdown(undefined, NOW_MS), '');
      assert.strictEqual(formatCountdown(NaN, NOW_MS), '');
      assert.strictEqual(formatCountdown('soon', NOW_MS), '');
    })
  )
    passed++;
  else failed++;

  console.log('\nbuildRateLimitSegment()\n');

  if (
    test('renders percentage and countdown', () => {
      const out = buildRateLimitSegment({ five_hour: { used_percentage: 23.5, resets_at: NOW_SEC + 4320 } }, NOW_MS);
      assert.strictEqual(strip(out), '5h 24% ↻1h12m');
    })
  )
    passed++;
  else failed++;

  if (
    test('absent rate_limits returns empty string so the caller can fall back', () => {
      assert.strictEqual(buildRateLimitSegment(undefined, NOW_MS), '');
      assert.strictEqual(buildRateLimitSegment(null, NOW_MS), '');
      assert.strictEqual(buildRateLimitSegment({}, NOW_MS), '');
      assert.strictEqual(buildRateLimitSegment({ five_hour: null }, NOW_MS), '');
    })
  )
    passed++;
  else failed++;

  if (
    test('null used_percentage returns empty string rather than NaN%', () => {
      assert.strictEqual(buildRateLimitSegment({ five_hour: { used_percentage: null, resets_at: NOW_SEC + 60 } }, NOW_MS), '');
    })
  )
    passed++;
  else failed++;

  if (
    test('missing resets_at still renders the percentage, without a countdown', () => {
      const out = buildRateLimitSegment({ five_hour: { used_percentage: 7 } }, NOW_MS);
      assert.strictEqual(strip(out), '5h 7%');
    })
  )
    passed++;
  else failed++;

  if (
    test('zero percent is rendered, not treated as absent', () => {
      const out = buildRateLimitSegment({ five_hour: { used_percentage: 0 } }, NOW_MS);
      assert.strictEqual(strip(out), '5h 0%');
    })
  )
    passed++;
  else failed++;

  if (
    test('severity colour matches the context bar tiers', () => {
      const at = pct => buildRateLimitSegment({ five_hour: { used_percentage: pct } }, NOW_MS);
      assert.ok(at(20).includes('\x1b[32m'), 'under 50% should be green');
      assert.ok(at(55).includes('\x1b[33m'), 'under 65% should be yellow');
      assert.ok(at(70).includes('\x1b[38;5;208m'), 'under 80% should be orange');
      assert.ok(at(85).includes('\x1b[1;31m'), '80%+ should be bold red');
    })
  )
    passed++;
  else failed++;

  if (
    test('countdown is dim, so the reset time does not read as urgent', () => {
      const out = buildRateLimitSegment({ five_hour: { used_percentage: 90, resets_at: NOW_SEC + 60 } }, NOW_MS);
      assert.ok(out.includes('\x1b[2m↻'), 'countdown should open with the dim code');
    })
  )
    passed++;
  else failed++;

  if (
    test('every escape sequence it emits is closed', () => {
      const out = buildRateLimitSegment({ five_hour: { used_percentage: 85, resets_at: NOW_SEC + 4320 } }, NOW_MS);
      // eslint-disable-next-line no-control-regex -- counting ANSI escapes is the point
      const opens = (out.match(/\x1b\[(?!0m)[0-9;]*m/g) || []).length;
      // eslint-disable-next-line no-control-regex -- counting ANSI escapes is the point
      const resets = (out.match(/\x1b\[0m/g) || []).length;
      assert.strictEqual(opens, resets, `${opens} colour opens vs ${resets} resets`);
    })
  )
    passed++;
  else failed++;

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

const { failed } = runTests();
process.exit(failed > 0 ? 1 : 0);
