/**
 * Tests for scripts/hooks/suggest-compact.js
 *
 * Tests the tool-call counter, threshold logic, interval suggestions,
 * and environment variable handling.
 *
 * Run with: node tests/hooks/suggest-compact.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const compactScript = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'suggest-compact.js');

// Test helpers
function test(name, fn) {
  try {
    fn();
    console.log(` \u2713 ${name}`);
    return true;
  } catch (_err) {
    console.log(` \u2717 ${name}`);
    console.log(` Error: ${_err.message}`);
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

let counterContextSeq = 0;

function createCounterContext(prefix = 'test-compact') {
  counterContextSeq += 1;
  const sessionId = `${prefix}-${Date.now()}-${counterContextSeq}`;
  const counterFile = getCounterFilePath(sessionId);

  return {
    sessionId,
    counterFile,
    cleanup() {
      try {
        fs.unlinkSync(counterFile);
      } catch (_err) {
        // Ignore missing temp files between runs
      }
    }
  };
}

function runTests() {
  console.log('\n=== Testing suggest-compact.js ===\n');

  let passed = 0;
  let failed = 0;

  // Basic functionality
  console.log('Basic counter functionality:');

  if (test('creates counter file on first run', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId });
    assert.strictEqual(result.code, 0, 'Should exit 0');
    assert.ok(fs.existsSync(counterFile), 'Counter file should be created');
    const count = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
    assert.strictEqual(count, 1, 'Counter should be 1 after first run');
    cleanup();
  })) passed++;
  else failed++;

  if (test('increments counter on subsequent runs', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    runCompact({ CLAUDE_SESSION_ID: sessionId });
    runCompact({ CLAUDE_SESSION_ID: sessionId });
    runCompact({ CLAUDE_SESSION_ID: sessionId });
    const count = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
    assert.strictEqual(count, 3, 'Counter should be 3 after three runs');
    cleanup();
  })) passed++;
  else failed++;

  // Threshold suggestion
  console.log('\nThreshold suggestion:');

  if (test('suggests compact at threshold (COMPACT_THRESHOLD=3)', () => {
    const { sessionId, cleanup } = createCounterContext();
    cleanup();
    // Run 3 times with threshold=3
    runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_THRESHOLD: '3' });
    runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_THRESHOLD: '3' });
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_THRESHOLD: '3' });
    assert.ok(
      result.stderr.includes('3 tool calls reached') || result.stderr.includes('consider /compact'),
      `Should suggest compact at threshold. Got stderr: ${result.stderr}`
    );
    cleanup();
  })) passed++;
  else failed++;

  if (test('does NOT suggest compact before threshold', () => {
    const { sessionId, cleanup } = createCounterContext();
    cleanup();
    runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_THRESHOLD: '5' });
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_THRESHOLD: '5' });
    assert.ok(
      !result.stderr.includes('StrategicCompact'),
      'Should NOT suggest compact before threshold'
    );
    cleanup();
  })) passed++;
  else failed++;

  // Interval suggestion (every 25 calls after threshold)
  console.log('\nInterval suggestion:');

  if (test('suggests at threshold + 25 interval', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    // Set counter to threshold+24 (so next run = threshold+25)
    // threshold=3, so we need count=28 → 25 calls past threshold
    // Write 27 to the counter file, next run will be 28 = 3 + 25
    fs.writeFileSync(counterFile, '27');
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_THRESHOLD: '3' });
    // count=28, threshold=3, 28-3=25, 25 % 25 === 0 → should suggest
    assert.ok(
      result.stderr.includes('28 tool calls') || result.stderr.includes('checkpoint'),
      `Should suggest at threshold+25 interval. Got stderr: ${result.stderr}`
    );
    cleanup();
  })) passed++;
  else failed++;

  // Environment variable handling
  console.log('\nEnvironment variable handling:');

  if (test('uses default threshold (50) when COMPACT_THRESHOLD is not set', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    // Write counter to 49, next run will be 50 = default threshold
    fs.writeFileSync(counterFile, '49');
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId });
    // Remove COMPACT_THRESHOLD from env
    assert.ok(
      result.stderr.includes('50 tool calls reached'),
      `Should use default threshold of 50. Got stderr: ${result.stderr}`
    );
    cleanup();
  })) passed++;
  else failed++;

  if (test('ignores invalid COMPACT_THRESHOLD (negative)', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    fs.writeFileSync(counterFile, '49');
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_THRESHOLD: '-5' });
    // Invalid threshold falls back to 50
    assert.ok(
      result.stderr.includes('50 tool calls reached'),
      `Should fallback to 50 for negative threshold. Got stderr: ${result.stderr}`
    );
    cleanup();
  })) passed++;
  else failed++;

  if (test('ignores non-numeric COMPACT_THRESHOLD', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    fs.writeFileSync(counterFile, '49');
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_THRESHOLD: 'abc' });
    // NaN falls back to 50
    assert.ok(
      result.stderr.includes('50 tool calls reached'),
      `Should fallback to 50 for non-numeric threshold. Got stderr: ${result.stderr}`
    );
    cleanup();
  })) passed++;
  else failed++;

  // Corrupted counter file
  console.log('\nCorrupted counter file:');

  if (test('resets counter on corrupted file content', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    fs.writeFileSync(counterFile, 'not-a-number');
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId });
    assert.strictEqual(result.code, 0);
    // Corrupted file → parsed is NaN → falls back to count=1
    const count = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
    assert.strictEqual(count, 1, 'Should reset to 1 on corrupted file');
    cleanup();
  })) passed++;
  else failed++;

  if (test('resets counter on extremely large value', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    // Value > 1000000 should be clamped
    fs.writeFileSync(counterFile, '9999999');
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId });
    assert.strictEqual(result.code, 0);
    const count = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
    assert.strictEqual(count, 1, 'Should reset to 1 for value > 1000000');
    cleanup();
  })) passed++;
  else failed++;

  if (test('handles empty counter file', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    fs.writeFileSync(counterFile, '');
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId });
    assert.strictEqual(result.code, 0);
    // Empty file → bytesRead=0 → count starts at 1
    const count = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
    assert.strictEqual(count, 1, 'Should start at 1 for empty file');
    cleanup();
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
    const { sessionId, cleanup } = createCounterContext();
    cleanup();
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId });
    assert.strictEqual(result.code, 0, 'Should always exit 0');
    cleanup();
  })) passed++;
  else failed++;

  // ── Round 29: threshold boundary values ──
  console.log('\nThreshold boundary values:');

  if (test('rejects COMPACT_THRESHOLD=0 (falls back to 50)', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    fs.writeFileSync(counterFile, '49');
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_THRESHOLD: '0' });
    // 0 is invalid (must be > 0), falls back to 50, count becomes 50 → should suggest
    assert.ok(
      result.stderr.includes('50 tool calls reached'),
      `Should fallback to 50 for threshold=0. Got stderr: ${result.stderr}`
    );
    cleanup();
  })) passed++;
  else failed++;

  if (test('accepts COMPACT_THRESHOLD=10000 (boundary max)', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    fs.writeFileSync(counterFile, '9999');
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_THRESHOLD: '10000' });
    // count becomes 10000, threshold=10000 → should suggest
    assert.ok(
      result.stderr.includes('10000 tool calls reached'),
      `Should accept threshold=10000. Got stderr: ${result.stderr}`
    );
    cleanup();
  })) passed++;
  else failed++;

  if (test('rejects COMPACT_THRESHOLD=10001 (falls back to 50)', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    fs.writeFileSync(counterFile, '49');
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_THRESHOLD: '10001' });
    // 10001 > 10000, invalid, falls back to 50, count becomes 50 → should suggest
    assert.ok(
      result.stderr.includes('50 tool calls reached'),
      `Should fallback to 50 for threshold=10001. Got stderr: ${result.stderr}`
    );
    cleanup();
  })) passed++;
  else failed++;

  if (test('rejects float COMPACT_THRESHOLD (e.g. 3.5)', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    fs.writeFileSync(counterFile, '49');
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_THRESHOLD: '3.5' });
    // parseInt('3.5') = 3, which is valid (> 0 && <= 10000)
    // count becomes 50, threshold=3, 50-3=47, 47%25≠0 and 50≠3 → no suggestion
    assert.strictEqual(result.code, 0);
    // No suggestion expected (50 !== 3, and (50-3) % 25 !== 0)
    assert.ok(
      !result.stderr.includes('StrategicCompact'),
      'Float threshold should be parseInt-ed to 3, no suggestion at count=50'
    );
    cleanup();
  })) passed++;
  else failed++;

  if (test('counter value at exact boundary 1000000 is valid', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    fs.writeFileSync(counterFile, '999999');
    runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_THRESHOLD: '3' });
    // 999999 is valid (> 0, <= 1000000), count becomes 1000000
    const count = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
    assert.strictEqual(count, 1000000, 'Counter at 1000000 boundary should be valid');
    cleanup();
  })) passed++;
  else failed++;

  if (test('counter value at 1000001 is clamped (reset to 1)', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    fs.writeFileSync(counterFile, '1000001');
    runCompact({ CLAUDE_SESSION_ID: sessionId });
    const count = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
    assert.strictEqual(count, 1, 'Counter > 1000000 should be reset to 1');
    cleanup();
  })) passed++;
  else failed++;

  // ── hookSpecificOutput JSON on stdout ──
  // Claude Code 2.1+ drops non-blocking PreToolUse stderr; the suggestion has
  // to ride on stdout as { hookSpecificOutput: { additionalContext } } to reach
  // the model. These tests pin that contract.
  console.log('\nhookSpecificOutput stdout JSON:');

  if (test('emits hookSpecificOutput.additionalContext on stdout at threshold', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    fs.writeFileSync(counterFile, '49');
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId });
    assert.strictEqual(result.code, 0, 'Should exit 0');
    assert.ok(result.stdout.trim().length > 0, `Expected stdout payload at threshold. Got: "${result.stdout}"`);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'PreToolUse',
      `hookEventName should be PreToolUse. Got: ${JSON.stringify(parsed)}`);
    assert.ok(parsed.hookSpecificOutput.additionalContext.includes('50 tool calls reached'),
      `additionalContext should include threshold text. Got: ${parsed.hookSpecificOutput.additionalContext}`);
    cleanup();
  })) passed++;
  else failed++;

  if (test('emits hookSpecificOutput.additionalContext on stdout at +25 interval', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    // threshold=3, set counter to 27 → next run = 28 → 28-3=25 → interval hit
    fs.writeFileSync(counterFile, '27');
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_THRESHOLD: '3' });
    assert.strictEqual(result.code, 0, 'Should exit 0');
    assert.ok(result.stdout.trim().length > 0, `Expected stdout payload at interval. Got: "${result.stdout}"`);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.ok(parsed.hookSpecificOutput.additionalContext.includes('28 tool calls'),
      `additionalContext should include count. Got: ${parsed.hookSpecificOutput.additionalContext}`);
    cleanup();
  })) passed++;
  else failed++;

  if (test('emits no stdout below threshold (silent)', () => {
    const { sessionId, cleanup } = createCounterContext();
    cleanup();
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_THRESHOLD: '5' });
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout.trim(), '',
      `Expected empty stdout below threshold. Got: "${result.stdout}"`);
    cleanup();
  })) passed++;
  else failed++;

  if (test('still writes [StrategicCompact] to stderr (debug log retained)', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    fs.writeFileSync(counterFile, '49');
    const result = runCompact({ CLAUDE_SESSION_ID: sessionId });
    assert.ok(result.stderr.includes('[StrategicCompact]'),
      `stderr should retain [StrategicCompact] for debug log capture. Got: "${result.stderr}"`);
    cleanup();
  })) passed++;
  else failed++;

  // ── Round 64: default session ID fallback ──
  console.log('\nDefault session ID fallback (Round 64):');

  if (test('uses "default" session ID when CLAUDE_SESSION_ID is empty', () => {
    const defaultCounterFile = getCounterFilePath('default');
    try { fs.unlinkSync(defaultCounterFile); } catch (_err) { /* ignore */ }
    try {
      // Pass empty CLAUDE_SESSION_ID — falsy, so script uses 'default'
      const env = { ...process.env, CLAUDE_SESSION_ID: '' };
      const result = spawnSync('node', [compactScript], {
        encoding: 'utf8',
        input: '{}',
        timeout: 10000,
        env,
      });
      assert.strictEqual(result.status || 0, 0, 'Should exit 0');
      assert.ok(fs.existsSync(defaultCounterFile), 'Counter file should use "default" session ID');
      const count = parseInt(fs.readFileSync(defaultCounterFile, 'utf8').trim(), 10);
      assert.strictEqual(count, 1, 'Counter should be 1 for first run with default session');
    } finally {
      try { fs.unlinkSync(defaultCounterFile); } catch (_err) { /* ignore */ }
    }
  })) passed++;
  else failed++;

  // ── Stale counter temp-file cleanup (#2156) ──
  console.log('\nStale counter cleanup (#2156):');

  // Backdate a file's mtime by N days so the sweep treats it as stale.
  function backdateFile(filePath, days) {
    const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    fs.utimesSync(filePath, when, when);
  }

  if (test('deletes stale counter files older than retention window', () => {
    const stale = getCounterFilePath(`stale-${Date.now()}`);
    fs.writeFileSync(stale, '5');
    backdateFile(stale, 30); // older than the 14-day default
    const { sessionId, cleanup } = createCounterContext();
    cleanup();
    try {
      const result = runCompact({ CLAUDE_SESSION_ID: sessionId });
      assert.strictEqual(result.code, 0, 'Should exit 0');
      assert.ok(!fs.existsSync(stale), 'Stale counter file should be swept');
    } finally {
      try { fs.unlinkSync(stale); } catch (_err) { /* ignore */ }
      cleanup();
    }
  })) passed++;
  else failed++;

  if (test('keeps fresh counter files within the retention window', () => {
    const fresh = getCounterFilePath(`fresh-${Date.now()}`);
    fs.writeFileSync(fresh, '5');
    backdateFile(fresh, 3); // well within the 14-day default
    const { sessionId, cleanup } = createCounterContext();
    cleanup();
    try {
      runCompact({ CLAUDE_SESSION_ID: sessionId });
      assert.ok(fs.existsSync(fresh), 'Fresh counter file should be kept');
    } finally {
      try { fs.unlinkSync(fresh); } catch (_err) { /* ignore */ }
      cleanup();
    }
  })) passed++;
  else failed++;

  if (test('never deletes the current session counter file', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    // Pre-create the current session's counter and backdate it far past the TTL.
    fs.writeFileSync(counterFile, '5');
    backdateFile(counterFile, 100);
    try {
      runCompact({ CLAUDE_SESSION_ID: sessionId });
      assert.ok(fs.existsSync(counterFile), 'Current session counter must survive sweep');
      const count = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
      assert.strictEqual(count, 6, 'Current counter should increment, not be reset');
    } finally {
      cleanup();
    }
  })) passed++;
  else failed++;

  if (test('COMPACT_STATE_TTL_DAYS=0 disables the sweep', () => {
    const stale = getCounterFilePath(`stale-disabled-${Date.now()}`);
    fs.writeFileSync(stale, '5');
    backdateFile(stale, 100);
    const { sessionId, cleanup } = createCounterContext();
    cleanup();
    try {
      runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_STATE_TTL_DAYS: '0' });
      assert.ok(fs.existsSync(stale), 'Sweep disabled → stale file must remain');
    } finally {
      try { fs.unlinkSync(stale); } catch (_err) { /* ignore */ }
      cleanup();
    }
  })) passed++;
  else failed++;

  if (test('custom COMPACT_STATE_TTL_DAYS shortens the window', () => {
    const stale = getCounterFilePath(`stale-custom-${Date.now()}`);
    fs.writeFileSync(stale, '5');
    backdateFile(stale, 5); // would survive default 14, but not TTL=2
    const { sessionId, cleanup } = createCounterContext();
    cleanup();
    try {
      runCompact({ CLAUDE_SESSION_ID: sessionId, COMPACT_STATE_TTL_DAYS: '2' });
      assert.ok(!fs.existsSync(stale), '5-day-old file should be swept with TTL=2');
    } finally {
      try { fs.unlinkSync(stale); } catch (_err) { /* ignore */ }
      cleanup();
    }
  })) passed++;
  else failed++;

  if (test('does not touch unrelated temp files', () => {
    const unrelated = path.join(os.tmpdir(), `unrelated-${Date.now()}.tmp`);
    fs.writeFileSync(unrelated, 'keep me');
    backdateFile(unrelated, 100);
    const { sessionId, cleanup } = createCounterContext();
    cleanup();
    try {
      runCompact({ CLAUDE_SESSION_ID: sessionId });
      assert.ok(fs.existsSync(unrelated), 'Non-counter temp files must be untouched');
    } finally {
      try { fs.unlinkSync(unrelated); } catch (_err) { /* ignore */ }
      cleanup();
    }
  })) passed++;
  else failed++;

  // Summary
  console.log(`
Results: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
