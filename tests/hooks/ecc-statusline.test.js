/**
 * Tests for scripts/hooks/ecc-statusline.js
 *
 * Run with: node tests/hooks/ecc-statusline.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  formatDuration,
  buildContextBar,
  readCurrentTask,
  buildMetricsSegment,
} = require('../../scripts/hooks/ecc-statusline');

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

function makeTempConfig() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-statusline-test-'));
}

function runTests() {
  console.log('\n=== Testing ecc-statusline.js ===\n');

  let passed = 0;
  let failed = 0;

  // formatDuration tests
  console.log('formatDuration:');

  if (
    test('null returns "?"', () => {
      assert.strictEqual(formatDuration(null), '?');
    })
  )
    passed++;
  else failed++;

  if (
    test('undefined returns "?"', () => {
      assert.strictEqual(formatDuration(undefined), '?');
    })
  )
    passed++;
  else failed++;

  if (
    test('timestamp 30 seconds ago ends with "s"', () => {
      const ts = new Date(Date.now() - 30 * 1000).toISOString();
      const result = formatDuration(ts);
      assert.ok(result.endsWith('s'), `Expected ending in "s", got: ${result}`);
    })
  )
    passed++;
  else failed++;

  if (
    test('timestamp 5 minutes ago ends with "m"', () => {
      const ts = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const result = formatDuration(ts);
      assert.ok(result.endsWith('m'), `Expected ending in "m", got: ${result}`);
    })
  )
    passed++;
  else failed++;

  if (
    test('timestamp 90 minutes ago contains "h"', () => {
      const ts = new Date(Date.now() - 90 * 60 * 1000).toISOString();
      const result = formatDuration(ts);
      assert.ok(result.includes('h'), `Expected "h" in result, got: ${result}`);
    })
  )
    passed++;
  else failed++;

  if (
    test('future timestamp returns "?"', () => {
      const ts = new Date(Date.now() + 60 * 1000).toISOString();
      const result = formatDuration(ts);
      assert.strictEqual(result, '?');
    })
  )
    passed++;
  else failed++;

  // buildContextBar tests
  console.log('\nbuildContextBar:');

  if (
    test('null returns empty string', () => {
      assert.strictEqual(buildContextBar(null), '');
    })
  )
    passed++;
  else failed++;

  if (
    test('undefined returns empty string', () => {
      assert.strictEqual(buildContextBar(undefined), '');
    })
  )
    passed++;
  else failed++;

  if (
    test('80% remaining contains green ANSI code', () => {
      const bar = buildContextBar(80);
      assert.ok(bar.includes('\x1b[32m'), `Expected green ANSI in: ${JSON.stringify(bar)}`);
    })
  )
    passed++;
  else failed++;

  if (
    test('50% remaining contains yellow ANSI code', () => {
      const bar = buildContextBar(50);
      assert.ok(bar.includes('\x1b[33m'), `Expected yellow ANSI in: ${JSON.stringify(bar)}`);
    })
  )
    passed++;
  else failed++;

  if (
    test('20% remaining contains bold red ANSI code', () => {
      const bar = buildContextBar(20);
      assert.ok(bar.includes('\x1b[1;31m'), `Expected bold red ANSI in: ${JSON.stringify(bar)}`);
    })
  )
    passed++;
  else failed++;

  if (
    test('context bar contains block characters', () => {
      const bar = buildContextBar(60);
      assert.ok(bar.includes('\u2588') || bar.includes('\u2591'), 'Expected block characters in bar');
    })
  )
    passed++;
  else failed++;

  if (
    test('context bar contains percentage', () => {
      const bar = buildContextBar(70);
      assert.ok(bar.includes('%'), 'Expected percentage in bar');
    })
  )
    passed++;
  else failed++;

  // readCurrentTask tests
  console.log('\nreadCurrentTask:');

  if (
    test('nonexistent session returns empty string', () => {
      const result = readCurrentTask('nonexistent-session-xyz-999');
      assert.strictEqual(result, '');
    })
  )
    passed++;
  else failed++;

  if (
    test('empty string session returns empty string', () => {
      const result = readCurrentTask('');
      assert.strictEqual(result, '');
    })
  )
    passed++;
  else failed++;

  if (
    test('reads in-progress task for sanitized session ID only', () => {
      const tmpConfig = makeTempConfig();
      const originalConfig = process.env.CLAUDE_CONFIG_DIR;
      try {
        process.env.CLAUDE_CONFIG_DIR = tmpConfig;
        const todosDir = path.join(tmpConfig, 'todos');
        fs.mkdirSync(todosDir, { recursive: true });
        fs.writeFileSync(
          path.join(todosDir, 'safe-session-agent-main.json'),
          JSON.stringify([{ status: 'in_progress', activeForm: 'Fix auth flow' }]),
          'utf8'
        );

        assert.strictEqual(readCurrentTask('safe-session'), 'Fix auth flow');
        assert.strictEqual(readCurrentTask('../safe-session'), '');
      } finally {
        if (originalConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
        else process.env.CLAUDE_CONFIG_DIR = originalConfig;
        fs.rmSync(tmpConfig, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // buildMetricsSegment
  console.log('\nbuildMetricsSegment()\n');

  const NOW_MS = 1738425600000;
  // eslint-disable-next-line no-control-regex -- ANSI escapes are what these tests assert on
  const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');
  const BRIDGE = { total_cost_usd: 368.03, tool_count: 52, files_modified_count: 7 };

  if (
    test('rate limit replaces the dollar figure when present', () => {
      const out = buildMetricsSegment(
        { rate_limits: { five_hour: { used_percentage: 24, resets_at: NOW_MS / 1000 + 4320 } } },
        BRIDGE,
        NOW_MS
      );
      assert.strictEqual(stripAnsi(out), '5h 24% ↻1h12m 52t 7f');
      assert.ok(!out.includes('$'), 'cost must not appear alongside the rate limit');
    })
  )
    passed++;
  else failed++;

  if (
    test('without rate limits it falls back to the native stdin cost', () => {
      const out = buildMetricsSegment({ cost: { total_cost_usd: 1.5 } }, BRIDGE, NOW_MS);
      assert.strictEqual(stripAnsi(out), '$1.50 52t 7f');
    })
  )
    passed++;
  else failed++;

  if (
    test('with neither, it falls back to the bridge cost', () => {
      const out = buildMetricsSegment({}, BRIDGE, NOW_MS);
      assert.strictEqual(stripAnsi(out), '$368.03 52t 7f');
    })
  )
    passed++;
  else failed++;

  if (
    test('a null five_hour window falls through to cost rather than blanking', () => {
      const out = buildMetricsSegment({ rate_limits: { five_hour: null } }, BRIDGE, NOW_MS);
      assert.strictEqual(stripAnsi(out), '$368.03 52t 7f');
    })
  )
    passed++;
  else failed++;

  if (
    test('rate limit renders with no bridge file at all', () => {
      const out = buildMetricsSegment(
        { rate_limits: { five_hour: { used_percentage: 5 } } },
        null,
        NOW_MS
      );
      assert.strictEqual(stripAnsi(out), '5h 5%');
    })
  )
    passed++;
  else failed++;

  if (
    test('no data at all yields an empty segment', () => {
      assert.strictEqual(buildMetricsSegment({}, null, NOW_MS), '');
      assert.strictEqual(buildMetricsSegment(undefined, undefined, NOW_MS), '');
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
