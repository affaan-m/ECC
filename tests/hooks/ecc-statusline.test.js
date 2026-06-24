/**
 * Tests for scripts/hooks/ecc-statusline.js
 *
 * Run with: node tests/hooks/ecc-statusline.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { formatDuration, buildContextBar, readCurrentTask } = require('../../scripts/hooks/ecc-statusline');

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

  // Summary
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

const { failed } = runTests();
process.exit(failed > 0 ? 1 : 0);
