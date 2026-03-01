/**
 * Tests for scripts/node/hooks/suggest-compact.js
 *
 * Tests the tool-call counter, threshold logic, interval suggestions,
 * and environment variable handling.
 *
 * Adapted for local codebase where:
 * - Script path is scripts/node/hooks/suggest-compact.js
 * - No threshold validation (negative, NaN, max boundary not checked)
 * - No counter value validation (no max, no NaN reset)
 * - Session ID fallback includes process.ppid
 *
 * Run with: node tests/hooks/suggest-compact.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const compactScript = path.join(__dirname, '..', '..', 'scripts', 'node', 'hooks', 'suggest-compact.js');

// Test helpers
function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (_err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${_err.message}`);
    return false;
  }
}

/**
 * Run suggest-compact.js with optional env overrides.
 * Returns { code, stdout, stderr }.
 */
function runCompact(envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  const result = spawnSync('node', [compactScript], {
    encoding: 'utf8',
    input: '{}',
    timeout: 10000,
    env,
  });
  return {
    code: result.status || 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

/**
 * Get the counter file path for a given session ID.
 */
function getCounterFilePath(sessionId) {
  return path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);
}

function runTests() {
  console.log('\n=== Testing suggest-compact.js ===\n');

  let passed = 0;
  let failed = 0;

  // Use a unique session ID per test run to avoid collisions
  const testSession = `test-compact-${Date.now()}`;
  const counterFile = getCounterFilePath(testSession);

  // Cleanup helper
  function cleanupCounter() {
    try {
      fs.unlinkSync(counterFile);
    } catch (_err) {
      // Ignore error
    }
  }

  // Basic functionality
  console.log('Basic counter functionality:');

  if (test('creates counter file on first run', () => {
    cleanupCounter();
    const result = runCompact({ CLAUDE_SESSION_ID: testSession });
    assert.strictEqual(result.code, 0, 'Should exit 0');
    assert.ok(fs.existsSync(counterFile), 'Counter file should be created');
    const count = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
    assert.strictEqual(count, 1, 'Counter should be 1 after first run');
    cleanupCounter();
  })) passed++;
  else failed++;

  if (test('increments counter on subsequent runs', () => {
    cleanupCounter();
    runCompact({ CLAUDE_SESSION_ID: testSession });
    runCompact({ CLAUDE_SESSION_ID: testSession });
    runCompact({ CLAUDE_SESSION_ID: testSession });
    const count = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
    assert.strictEqual(count, 3, 'Counter should be 3 after three runs');
    cleanupCounter();
  })) passed++;
  else failed++;

  // Threshold suggestion
  console.log('\nThreshold suggestion:');

  if (test('suggests compact at threshold (COMPACT_THRESHOLD=3)', () => {
    cleanupCounter();
    // Run 3 times with threshold=3
    runCompact({ CLAUDE_SESSION_ID: testSession, COMPACT_THRESHOLD: '3' });
    runCompact({ CLAUDE_SESSION_ID: testSession, COMPACT_THRESHOLD: '3' });
    const result = runCompact({ CLAUDE_SESSION_ID: testSession, COMPACT_THRESHOLD: '3' });
    assert.ok(
      result.stderr.includes('3 tool calls reached') || result.stderr.includes('consider /compact'),
      `Should suggest compact at threshold. Got stderr: ${result.stderr}`
    );
    cleanupCounter();
  })) passed++;
  else failed++;

  if (test('does NOT suggest compact before threshold', () => {
    cleanupCounter();
    runCompact({ CLAUDE_SESSION_ID: testSession, COMPACT_THRESHOLD: '5' });
    const result = runCompact({ CLAUDE_SESSION_ID: testSession, COMPACT_THRESHOLD: '5' });
    assert.ok(
      !result.stderr.includes('StrategicCompact'),
      'Should NOT suggest compact before threshold'
    );
    cleanupCounter();
  })) passed++;
  else failed++;

  // Interval suggestion (every 25 calls after threshold)
  console.log('\nInterval suggestion:');

  if (test('suggests at count divisible by 25 after threshold', () => {
    cleanupCounter();
    // Set counter to 24 (so next run = 25). With threshold=3:
    // count=25, 25 > 3 → true, 25 % 25 === 0 → true → should suggest
    fs.writeFileSync(counterFile, '24');
    const result = runCompact({ CLAUDE_SESSION_ID: testSession, COMPACT_THRESHOLD: '3' });
    assert.ok(
      result.stderr.includes('25 tool calls') || result.stderr.includes('checkpoint'),
      `Should suggest at count=25 (divisible by 25, above threshold). Got stderr: ${result.stderr}`
    );
    cleanupCounter();
  })) passed++;
  else failed++;

  if (test('does NOT suggest at non-multiple of 25 after threshold', () => {
    cleanupCounter();
    // Set counter to 27 (so next run = 28). 28 % 25 = 3 ≠ 0
    fs.writeFileSync(counterFile, '27');
    const result = runCompact({ CLAUDE_SESSION_ID: testSession, COMPACT_THRESHOLD: '3' });
    assert.ok(
      !result.stderr.includes('StrategicCompact'),
      'Should NOT suggest at count=28 (not divisible by 25)'
    );
    cleanupCounter();
  })) passed++;
  else failed++;

  // Environment variable handling
  console.log('\nEnvironment variable handling:');

  if (test('uses default threshold (50) when COMPACT_THRESHOLD is not set', () => {
    cleanupCounter();
    // Write counter to 49, next run will be 50 = default threshold
    fs.writeFileSync(counterFile, '49');
    const result = runCompact({ CLAUDE_SESSION_ID: testSession });
    assert.ok(
      result.stderr.includes('50 tool calls reached'),
      `Should use default threshold of 50. Got stderr: ${result.stderr}`
    );
    cleanupCounter();
  })) passed++;
  else failed++;

  // Corrupted counter file
  console.log('\nCorrupted counter file:');

  if (test('handles corrupted counter file (NaN becomes NaN+1=NaN)', () => {
    cleanupCounter();
    fs.writeFileSync(counterFile, 'not-a-number');
    const result = runCompact({ CLAUDE_SESSION_ID: testSession });
    assert.strictEqual(result.code, 0, 'Should exit 0 even with corrupted file');
    // parseInt('not-a-number') = NaN, NaN+1 = NaN, String(NaN) = 'NaN'
    const content = fs.readFileSync(counterFile, 'utf8').trim();
    assert.strictEqual(content, 'NaN', 'Corrupted file results in NaN (no validation)');
    cleanupCounter();
  })) passed++;
  else failed++;

  if (test('handles empty counter file (starts at 1)', () => {
    cleanupCounter();
    fs.writeFileSync(counterFile, '');
    const result = runCompact({ CLAUDE_SESSION_ID: testSession });
    assert.strictEqual(result.code, 0);
    // Empty string is falsy in readFile check → count starts at 1
    const count = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
    assert.strictEqual(count, 1, 'Should start at 1 for empty file');
    cleanupCounter();
  })) passed++;
  else failed++;

  // Session isolation
  console.log('\nSession isolation:');

  if (test('uses separate counter files per session ID', () => {
    const sessionA = `compact-a-${Date.now()}`;
    const sessionB = `compact-b-${Date.now()}`;
    const fileA = getCounterFilePath(sessionA);
    const fileB = getCounterFilePath(sessionB);
    try {
      runCompact({ CLAUDE_SESSION_ID: sessionA });
      runCompact({ CLAUDE_SESSION_ID: sessionA });
      runCompact({ CLAUDE_SESSION_ID: sessionB });
      const countA = parseInt(fs.readFileSync(fileA, 'utf8').trim(), 10);
      const countB = parseInt(fs.readFileSync(fileB, 'utf8').trim(), 10);
      assert.strictEqual(countA, 2, 'Session A should have count 2');
      assert.strictEqual(countB, 1, 'Session B should have count 1');
    } finally {
      try { fs.unlinkSync(fileA); } catch (_err) { /* ignore */ }
      try { fs.unlinkSync(fileB); } catch (_err) { /* ignore */ }
    }
  })) passed++;
  else failed++;

  // Always exits 0
  console.log('\nExit code:');

  if (test('always exits 0 (never blocks Claude)', () => {
    cleanupCounter();
    const result = runCompact({ CLAUDE_SESSION_ID: testSession });
    assert.strictEqual(result.code, 0, 'Should always exit 0');
    cleanupCounter();
  })) passed++;
  else failed++;

  // Threshold boundary values (local behavior - no validation)
  console.log('\nThreshold boundary values (local behavior):');

  if (test('COMPACT_THRESHOLD=1 triggers on first call', () => {
    cleanupCounter();
    const result = runCompact({ CLAUDE_SESSION_ID: testSession, COMPACT_THRESHOLD: '1' });
    assert.strictEqual(result.code, 0);
    assert.ok(
      result.stderr.includes('1 tool calls reached'),
      `Should trigger at threshold=1. Got stderr: ${result.stderr}`
    );
    cleanupCounter();
  })) passed++;
  else failed++;

  if (test('COMPACT_THRESHOLD=0 with parseInt results in no trigger at count=1', () => {
    cleanupCounter();
    // parseInt('0') = 0, count=1, 1 === 0 → false, 1 > 0 && 1 % 25 === 0 → false
    const result = runCompact({ CLAUDE_SESSION_ID: testSession, COMPACT_THRESHOLD: '0' });
    assert.strictEqual(result.code, 0);
    assert.ok(
      !result.stderr.includes('StrategicCompact'),
      'threshold=0, count=1: no trigger'
    );
    cleanupCounter();
  })) passed++;
  else failed++;

  // Summary
  console.log(`\n=== Test Results ===`);
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
