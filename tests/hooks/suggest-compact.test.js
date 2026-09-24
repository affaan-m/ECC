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
  return runCompactWithInput('{}', envOverrides);
}

/**
 * Run suggest-compact.js with a custom stdin payload (hook input JSON).
 * Returns { code, stdout, stderr }.
 */
function runCompactWithInput(input, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  const result = spawnSync('node', [compactScript], {
    encoding: 'utf8',
    input: typeof input === 'string' ? input : JSON.stringify(input),
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

  // ── Counter file cleanup (#2156) ──
  // claude-tool-count-<sessionId> files were never removed. The hook now
  // sweeps stale counters older than COMPACT_STATE_TTL_DAYS (default 14)
  // before opening the active counter. These tests pin the contract.
  console.log('\nCounter file cleanup (#2156):');

  /**
   * Set a file's mtime/atime to N days ago.
   */
  function setMtimeDaysAgo(filePath, daysAgo) {
    const seconds = Math.floor(Date.now() / 1000) - daysAgo * 24 * 60 * 60;
    fs.utimesSync(filePath, seconds, seconds);
  }

  if (test('removes counter files older than retention window', () => {
    const { sessionId, cleanup } = createCounterContext();
    const stale = getCounterFilePath(`stale-${Date.now()}`);
    fs.writeFileSync(stale, '1');
    setMtimeDaysAgo(stale, 30);
    try {
      const result = runCompact({ CLAUDE_SESSION_ID: sessionId });
      assert.strictEqual(result.code, 0, 'Should exit 0');
      assert.ok(!fs.existsSync(stale),
        `Stale counter file should have been swept. Path: ${stale}`);
    } finally {
      try { fs.unlinkSync(stale); } catch (_err) { /* ignore */ }
      cleanup();
    }
  })) passed++;
  else failed++;

  if (test('preserves counter files within retention window', () => {
    const { sessionId, cleanup } = createCounterContext();
    const fresh = getCounterFilePath(`fresh-${Date.now()}`);
    fs.writeFileSync(fresh, '1');
    setMtimeDaysAgo(fresh, 5);
    try {
      runCompact({ CLAUDE_SESSION_ID: sessionId });
      assert.ok(fs.existsSync(fresh),
        `Fresh counter file should be preserved. Path: ${fresh}`);
    } finally {
      try { fs.unlinkSync(fresh); } catch (_err) { /* ignore */ }
      cleanup();
    }
  })) passed++;
  else failed++;

  if (test('preserves the active session\'s counter file even if old', () => {
    const { sessionId, counterFile, cleanup } = createCounterContext();
    cleanup();
    fs.writeFileSync(counterFile, '7');
    setMtimeDaysAgo(counterFile, 30);
    try {
      const result = runCompact({ CLAUDE_SESSION_ID: sessionId });
      assert.strictEqual(result.code, 0, 'Should exit 0');
      // Active counter survives the sweep AND is incremented by the hook (7 -> 8).
      assert.ok(fs.existsSync(counterFile),
        'Active session counter must survive the sweep');
      const count = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
      assert.strictEqual(count, 8,
        `Active counter should be incremented by the hook. Got ${count}`);
    } finally {
      cleanup();
    }
  })) passed++;
  else failed++;

  if (test('honours COMPACT_STATE_TTL_DAYS env var', () => {
    const { sessionId, cleanup } = createCounterContext();
    const target = getCounterFilePath(`ttl-${Date.now()}`);
    fs.writeFileSync(target, '1');
    setMtimeDaysAgo(target, 5); // Within default 14d window, but outside TTL=3
    try {
      const result = runCompact({
        CLAUDE_SESSION_ID: sessionId,
        COMPACT_STATE_TTL_DAYS: '3'
      });
      assert.strictEqual(result.code, 0);
      assert.ok(!fs.existsSync(target),
        `TTL=3 should sweep a 5-day-old file. Path: ${target}`);
    } finally {
      try { fs.unlinkSync(target); } catch (_err) { /* ignore */ }
      cleanup();
    }
  })) passed++;
  else failed++;

  if (test('falls back to default for invalid COMPACT_STATE_TTL_DAYS', () => {
    const { sessionId, cleanup } = createCounterContext();
    const target = getCounterFilePath(`fallback-${Date.now()}`);
    fs.writeFileSync(target, '1');
    setMtimeDaysAgo(target, 5); // Within default 14d window, would survive a fallback
    try {
      // Each invalid form: zero, negative, non-numeric — should fall back to 14d default.
      for (const bad of ['0', '-5', 'abc']) {
        // Reset mtime each iteration so the file remains 5 days old.
        setMtimeDaysAgo(target, 5);
        const result = runCompact({
          CLAUDE_SESSION_ID: sessionId,
          COMPACT_STATE_TTL_DAYS: bad
        });
        assert.strictEqual(result.code, 0);
        assert.ok(fs.existsSync(target),
          `Invalid TTL '${bad}' should fall back to default (14d) and preserve a 5-day-old file`);
      }
    } finally {
      try { fs.unlinkSync(target); } catch (_err) { /* ignore */ }
      cleanup();
    }
  })) passed++;
  else failed++;

  if (test('does not touch unrelated temp files', () => {
    const { sessionId, cleanup } = createCounterContext();
    const unrelated = path.join(os.tmpdir(), `unrelated-${Date.now()}.tmp`);
    fs.writeFileSync(unrelated, 'do not touch');
    setMtimeDaysAgo(unrelated, 60);
    try {
      runCompact({ CLAUDE_SESSION_ID: sessionId });
      assert.ok(fs.existsSync(unrelated),
        `Unrelated temp file should not be swept. Path: ${unrelated}`);
    } finally {
      try { fs.unlinkSync(unrelated); } catch (_err) { /* ignore */ }
      cleanup();
    }
  })) passed++;
  else failed++;

  if (test('preserves files whose mtime sits at or after the TTL cutoff', () => {
    // Contract: docstring says files "older than" retentionDays are removed.
    // A file at the exact boundary (age == retentionDays) is NOT older than
    // retentionDays, so it must survive the sweep. Pins the >= comparison
    // in cleanupOldCounters: anything with mtimeMs >= cutoffMs is skipped.
    //
    // We can't pin the boundary by clock — the sweep computes its own
    // Date.now() after this test runs, so `setMtimeDaysAgo(file, 14)` is
    // effectively "14d + handful of ms", placing the file just past the
    // cutoff. To exercise the boundary deterministically, set the file's
    // mtime two seconds *newer* than the projected cutoff: with `>` the
    // file would be deleted (mtimeMs > cutoffMs is false at the cutoff
    // edge); with `>=` it survives.
    const { sessionId, cleanup } = createCounterContext();
    const boundary = getCounterFilePath(`boundary-${Date.now()}`);
    fs.writeFileSync(boundary, '1');
    const retentionDays = 14;
    const boundaryMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000 + 2000;
    const sec = Math.floor(boundaryMs / 1000);
    fs.utimesSync(boundary, sec, sec);
    try {
      const result = runCompact({ CLAUDE_SESSION_ID: sessionId });
      assert.strictEqual(result.code, 0);
      assert.ok(fs.existsSync(boundary),
        `Boundary-aged counter file should be preserved. Path: ${boundary}`);
    } finally {
      try { fs.unlinkSync(boundary); } catch (_err) { /* ignore */ }
      cleanup();
    }
  })) passed++;
  else failed++;

  if (test('exit 0 holds when sweep encounters a populated temp dir', () => {
    // Functional smoke: with a mix of stale, fresh, and unrelated files
    // present, the hook must still exit 0 — the always-exit-0 contract
    // takes precedence over sweep failures.
    const { sessionId, cleanup } = createCounterContext();
    const stale = getCounterFilePath(`mix-stale-${Date.now()}`);
    const fresh = getCounterFilePath(`mix-fresh-${Date.now()}`);
    const unrelated = path.join(os.tmpdir(), `mix-unrelated-${Date.now()}.tmp`);
    fs.writeFileSync(stale, '1');
    fs.writeFileSync(fresh, '1');
    fs.writeFileSync(unrelated, '1');
    setMtimeDaysAgo(stale, 30);
    setMtimeDaysAgo(fresh, 1);
    setMtimeDaysAgo(unrelated, 30);
    try {
      const result = runCompact({ CLAUDE_SESSION_ID: sessionId });
      assert.strictEqual(result.code, 0, 'Hook must exit 0 even with files in temp dir');
    } finally {
      for (const p of [stale, fresh, unrelated]) {
        try { fs.unlinkSync(p); } catch (_err) { /* ignore */ }
      }
      cleanup();
    }
  })) passed++;
  else failed++;

  // ── Context-size trigger (#2155) ──
  // Tool count is a weak proxy for window pressure. The hook now also reads
  // the latest `usage` record from the session transcript (transcript_path in
  // the hook stdin payload) and suggests /compact at a window-scaled token
  // threshold, re-firing only after another interval of context growth.
  console.log('\nContext-size trigger (#2155):');

  function getBucketFilePath(sessionId) {
    return path.join(os.tmpdir(), `claude-context-bucket-${sessionId}`);
  }

  let transcriptSeq = 0;

  function writeTranscriptFixture(tokens, model = 'claude-sonnet-4-6') {
    transcriptSeq += 1;
    const filePath = path.join(os.tmpdir(), `compact-transcript-${process.pid}-${transcriptSeq}.jsonl`);
    writeTranscriptTokens(filePath, tokens, model);
    return filePath;
  }

  function writeTranscriptTokens(filePath, tokens, model = 'claude-sonnet-4-6') {
    const record = JSON.stringify({
      type: 'assistant',
      message: {
        model,
        usage: {
          input_tokens: tokens,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens: 50
        }
      }
    });
    fs.writeFileSync(filePath, record + '\n');
  }

  function createContextContext() {
    const base = createCounterContext('test-context');
    const bucketFile = getBucketFilePath(base.sessionId);
    return {
      ...base,
      bucketFile,
      cleanup() {
        base.cleanup();
        try { fs.unlinkSync(bucketFile); } catch (_err) { /* ignore */ }
      }
    };
  }

  if (test('suggests compact when context exceeds the 200k-window threshold', () => {
    const ctx = createContextContext();
    const transcript = writeTranscriptFixture(170000);
    try {
      const result = runCompactWithInput({ session_id: ctx.sessionId, transcript_path: transcript });
      assert.strictEqual(result.code, 0, 'Should exit 0');
      assert.ok(result.stdout.trim().length > 0, `Expected stdout payload. Got: "${result.stdout}"`);
      const parsed = JSON.parse(result.stdout);
      const context = parsed.hookSpecificOutput.additionalContext;
      assert.ok(context.includes('Context ~170k tokens'), `Expected token estimate. Got: ${context}`);
      assert.ok(context.includes('85% of 200k window'), `Expected window percentage. Got: ${context}`);
    } finally {
      try { fs.unlinkSync(transcript); } catch (_err) { /* ignore */ }
      ctx.cleanup();
    }
  })) passed++;
  else failed++;

  if (test('stays silent below the context threshold', () => {
    const ctx = createContextContext();
    const transcript = writeTranscriptFixture(100000);
    try {
      const result = runCompactWithInput({ session_id: ctx.sessionId, transcript_path: transcript });
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout.trim(), '', `Expected silent run below threshold. Got: "${result.stdout}"`);
    } finally {
      try { fs.unlinkSync(transcript); } catch (_err) { /* ignore */ }
      ctx.cleanup();
    }
  })) passed++;
  else failed++;

  if (test('honours COMPACT_CONTEXT_THRESHOLD override', () => {
    const ctx = createContextContext();
    const transcript = writeTranscriptFixture(1500);
    try {
      const result = runCompactWithInput(
        { session_id: ctx.sessionId, transcript_path: transcript },
        { COMPACT_CONTEXT_THRESHOLD: '1000' }
      );
      assert.ok(result.stdout.includes('Context ~2k tokens'), `Expected context suggestion with overridden threshold. Got: "${result.stdout}"`);
    } finally {
      try { fs.unlinkSync(transcript); } catch (_err) { /* ignore */ }
      ctx.cleanup();
    }
  })) passed++;
  else failed++;

  if (test('does not re-fire within the same context bucket', () => {
    const ctx = createContextContext();
    const transcript = writeTranscriptFixture(170000);
    try {
      const first = runCompactWithInput({ session_id: ctx.sessionId, transcript_path: transcript });
      assert.ok(first.stdout.includes('Context ~170k tokens'), 'First run should fire');
      const second = runCompactWithInput({ session_id: ctx.sessionId, transcript_path: transcript });
      assert.strictEqual(second.stdout.trim(), '', `Second run in the same bucket must be silent. Got: "${second.stdout}"`);
    } finally {
      try { fs.unlinkSync(transcript); } catch (_err) { /* ignore */ }
      ctx.cleanup();
    }
  })) passed++;
  else failed++;

  if (test('re-fires after the context grows by another interval', () => {
    const ctx = createContextContext();
    const transcript = writeTranscriptFixture(170000);
    try {
      runCompactWithInput({ session_id: ctx.sessionId, transcript_path: transcript });
      // Default interval is 60k: 160k threshold + 60k => next bucket at 220k.
      writeTranscriptTokens(transcript, 230000, 'claude-sonnet-4-6[1m]');
      const result = runCompactWithInput(
        { session_id: ctx.sessionId, transcript_path: transcript },
        // Pin the threshold so window detection (230k > 200k => 1M window,
        // 250k default threshold) does not silence the growth re-fire.
        { COMPACT_CONTEXT_THRESHOLD: '160000' }
      );
      assert.ok(result.stdout.includes('Context ~230k tokens'), `Expected re-fire after interval growth. Got: "${result.stdout}"`);
    } finally {
      try { fs.unlinkSync(transcript); } catch (_err) { /* ignore */ }
      ctx.cleanup();
    }
  })) passed++;
  else failed++;

  if (test('uses the 250k default threshold for [1m] models', () => {
    const ctx = createContextContext();
    const transcript = writeTranscriptFixture(230000, 'claude-opus-4-5[1m]');
    try {
      const silent = runCompactWithInput({ session_id: ctx.sessionId, transcript_path: transcript });
      assert.strictEqual(silent.stdout.trim(), '', `230k on a 1M window must stay silent. Got: "${silent.stdout}"`);
      writeTranscriptTokens(transcript, 260000, 'claude-opus-4-5[1m]');
      const fired = runCompactWithInput({ session_id: ctx.sessionId, transcript_path: transcript });
      assert.ok(fired.stdout.includes('26% of 1M window'), `260k on a 1M window should fire. Got: "${fired.stdout}"`);
    } finally {
      try { fs.unlinkSync(transcript); } catch (_err) { /* ignore */ }
      ctx.cleanup();
    }
  })) passed++;
  else failed++;

  if (test('treats >200k observed tokens as a 1M window even without the [1m] marker', () => {
    const ctx = createContextContext();
    const transcript = writeTranscriptFixture(230000, 'claude-opus-4-5');
    try {
      const result = runCompactWithInput({ session_id: ctx.sessionId, transcript_path: transcript });
      // 230k would exceed the 160k standard threshold, but the observed size
      // implies a 1M window whose 250k default threshold is not reached yet.
      assert.strictEqual(result.stdout.trim(), '', `Expected 1M-window inference to keep run silent. Got: "${result.stdout}"`);
    } finally {
      try { fs.unlinkSync(transcript); } catch (_err) { /* ignore */ }
      ctx.cleanup();
    }
  })) passed++;
  else failed++;

  if (test('COMPACT_CONTEXT_THRESHOLD=0 disables the context signal', () => {
    const ctx = createContextContext();
    const transcript = writeTranscriptFixture(170000);
    try {
      const result = runCompactWithInput(
        { session_id: ctx.sessionId, transcript_path: transcript },
        { COMPACT_CONTEXT_THRESHOLD: '0' }
      );
      assert.strictEqual(result.stdout.trim(), '', `Disabled signal must stay silent. Got: "${result.stdout}"`);
    } finally {
      try { fs.unlinkSync(transcript); } catch (_err) { /* ignore */ }
      ctx.cleanup();
    }
  })) passed++;
  else failed++;

  if (test('survives a malformed transcript (exit 0, silent)', () => {
    const ctx = createContextContext();
    const transcript = path.join(os.tmpdir(), `compact-transcript-broken-${Date.now()}.jsonl`);
    fs.writeFileSync(transcript, 'this is not json\n{broken');
    try {
      const result = runCompactWithInput({ session_id: ctx.sessionId, transcript_path: transcript });
      assert.strictEqual(result.code, 0, 'Must exit 0 on malformed transcript');
      assert.strictEqual(result.stdout.trim(), '');
    } finally {
      try { fs.unlinkSync(transcript); } catch (_err) { /* ignore */ }
      ctx.cleanup();
    }
  })) passed++;
  else failed++;

  if (test('survives a missing transcript path (exit 0, count signal intact)', () => {
    const ctx = createContextContext();
    try {
      fs.writeFileSync(ctx.counterFile, '49');
      const result = runCompactWithInput({
        session_id: ctx.sessionId,
        transcript_path: path.join(os.tmpdir(), `missing-${Date.now()}.jsonl`)
      });
      assert.strictEqual(result.code, 0);
      assert.ok(result.stdout.includes('50 tool calls reached'), `Count signal must still work. Got: "${result.stdout}"`);
    } finally {
      ctx.cleanup();
    }
  })) passed++;
  else failed++;

  if (test('emits a single stdout JSON payload when both signals fire', () => {
    const ctx = createContextContext();
    const transcript = writeTranscriptFixture(170000);
    try {
      fs.writeFileSync(ctx.counterFile, '49');
      const result = runCompactWithInput({ session_id: ctx.sessionId, transcript_path: transcript });
      const lines = result.stdout.trim().split('\n');
      assert.strictEqual(lines.length, 1, `Hook must emit exactly one stdout JSON line. Got: "${result.stdout}"`);
      const parsed = JSON.parse(lines[0]);
      const context = parsed.hookSpecificOutput.additionalContext;
      assert.ok(context.includes('Context ~170k tokens'), `Expected context signal. Got: ${context}`);
      assert.ok(context.includes('50 tool calls reached'), `Expected count signal. Got: ${context}`);
    } finally {
      try { fs.unlinkSync(transcript); } catch (_err) { /* ignore */ }
      ctx.cleanup();
    }
  })) passed++;
  else failed++;

  if (test('sweeps stale context bucket state files', () => {
    const ctx = createContextContext();
    const stale = getBucketFilePath(`stale-bucket-${Date.now()}`);
    fs.writeFileSync(stale, '2');
    setMtimeDaysAgo(stale, 30);
    try {
      const result = runCompact({ CLAUDE_SESSION_ID: ctx.sessionId });
      assert.strictEqual(result.code, 0);
      assert.ok(!fs.existsSync(stale), `Stale bucket state file should have been swept. Path: ${stale}`);
    } finally {
      try { fs.unlinkSync(stale); } catch (_err) { /* ignore */ }
      ctx.cleanup();
    }
  })) passed++;
  else failed++;

  // Summary
  console.log(`
Results: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
