'use strict';
/**
 * Tests for scripts/lib/transcript-context.js (#2155)
 *
 * Covers transcript usage extraction, context-window detection, threshold and
 * interval resolution, and the bucket math the strategic-compact hook uses.
 *
 * Run with: node tests/lib/transcript-context.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  STANDARD_CONTEXT_WINDOW_TOKENS,
  LARGE_CONTEXT_WINDOW_TOKENS,
  DEFAULT_CONTEXT_THRESHOLD_STANDARD,
  DEFAULT_CONTEXT_THRESHOLD_LARGE,
  DEFAULT_CONTEXT_INTERVAL_TOKENS,
  DEFAULT_TRANSCRIPT_TAIL_BYTES,
  readFileTail,
  readLatestContextTokens,
  resolveContextWindow,
  resolveContextWindowTokens,
  resolveContextThreshold,
  resolveContextInterval,
  computeContextBucket,
  formatWindowLabel,
  isContextWindowInferred
} = require('../../scripts/lib/transcript-context');

console.log('=== Testing transcript-context.js ===\n');

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

const transcriptRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-transcript-context-'));
process.on('exit', () => fs.rmSync(transcriptRoot, { recursive: true, force: true }));
let fixtureSeq = 0;

function writeTranscript(lines) {
  fixtureSeq += 1;
  const filePath = path.join(transcriptRoot, `transcript-context-test-${process.pid}-${fixtureSeq}.jsonl`);
  fs.writeFileSync(filePath, lines.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  return filePath;
}

function usageRecord(tokens, model = 'claude-sonnet-4-6', extra = {}) {
  return JSON.stringify({
    type: 'assistant',
    message: {
      model,
      usage: {
        input_tokens: tokens.input || 0,
        cache_read_input_tokens: tokens.cacheRead || 0,
        cache_creation_input_tokens: tokens.cacheCreation || 0,
        output_tokens: tokens.output || 0
      }
    },
    ...extra
  });
}

const cleanupPaths = [];

function tracked(filePath) {
  cleanupPaths.push(filePath);
  return filePath;
}

// ── readLatestContextTokens ──
console.log('readLatestContextTokens:');

test('sums input + cache_read + cache_creation from the latest usage record', () => {
  const file = tracked(writeTranscript([usageRecord({ input: 10, cacheRead: 20, cacheCreation: 5 }), usageRecord({ input: 100, cacheRead: 150000, cacheCreation: 7000 })]));
  const result = readLatestContextTokens(file);
  assert.ok(result, 'Expected a usage result');
  assert.strictEqual(result.tokens, 157100);
});

test('returns the model id alongside the token count', () => {
  const file = tracked(writeTranscript([usageRecord({ input: 1000 }, 'claude-opus-4-5[1m]')]));
  const result = readLatestContextTokens(file);
  assert.strictEqual(result.model, 'claude-opus-4-5[1m]');
});

test('skips trailing records without usage (e.g. tool results)', () => {
  const file = tracked(writeTranscript([usageRecord({ input: 5000 }), JSON.stringify({ type: 'user', message: { content: 'tool result' } }), JSON.stringify({ type: 'system', subtype: 'info' })]));
  const result = readLatestContextTokens(file);
  assert.strictEqual(result.tokens, 5000);
});

test('skips malformed JSONL lines without throwing', () => {
  const file = tracked(writeTranscript([usageRecord({ input: 4200 }), '{not json at all', '']));
  const result = readLatestContextTokens(file);
  assert.strictEqual(result.tokens, 4200);
});

test('returns null for a transcript with no usage records', () => {
  const file = tracked(writeTranscript([JSON.stringify({ type: 'user', message: { content: 'hello' } })]));
  assert.strictEqual(readLatestContextTokens(file), null);
});

test('returns null for a missing transcript file', () => {
  assert.strictEqual(readLatestContextTokens(path.join(transcriptRoot, 'definitely-missing.jsonl')), null);
});

test('returns null for empty or non-string paths', () => {
  assert.strictEqual(readLatestContextTokens(''), null);
  assert.strictEqual(readLatestContextTokens(undefined), null);
});

test('ignores zero-token usage records', () => {
  const file = tracked(writeTranscript([usageRecord({ input: 999 }), usageRecord({ input: 0 })]));
  const result = readLatestContextTokens(file);
  assert.strictEqual(result.tokens, 999);
});

test('only scans the transcript tail (latest records win on large files)', () => {
  const filler = JSON.stringify({ type: 'system', note: 'x'.repeat(512) });
  const lines = [usageRecord({ input: 11 })];
  for (let i = 0; i < 50; i++) lines.push(filler);
  lines.push(usageRecord({ input: 170000 }));
  const file = tracked(writeTranscript(lines));
  // Tail window smaller than the file forces the truncated-tail path.
  const result = readLatestContextTokens(file, { tailBytes: 4096 });
  assert.strictEqual(result.tokens, 170000);
});

test('keeps a complete usage record at the truncated tail boundary', () => {
  const record = usageRecord({ input: 100, cacheRead: 160000, cacheCreation: 2000 });
  const file = tracked(writeTranscript([usageRecord({ input: 11 }), record]));
  const result = readLatestContextTokens(file, { tailBytes: Buffer.byteLength(record + '\n') });
  assert.deepStrictEqual(result, { tokens: 162100, model: 'claude-sonnet-4-6' });
});

test('keeps boundary-aligned usage before trailing tool results with UTF-8 content', () => {
  const record = usageRecord({ input: 170000 });
  const toolResult = JSON.stringify({ type: 'user', message: { content: '完成检查' } });
  const file = tracked(writeTranscript([usageRecord({ input: 11 }), record, toolResult]));
  const tailBytes = Buffer.byteLength([record, toolResult, ''].join('\n'));
  assert.deepStrictEqual(readLatestContextTokens(file, { tailBytes }), {
    tokens: 170000,
    model: 'claude-sonnet-4-6'
  });
});

test('skips a partial usage record at the truncated tail boundary', () => {
  const record = usageRecord({ input: 170000 });
  const toolResult = JSON.stringify({ type: 'user', message: { content: 'tool result' } });
  const file = tracked(writeTranscript([usageRecord({ input: 11 }), record, toolResult]));
  const tailBytes = Buffer.byteLength([record, toolResult, ''].join('\n')) - 1;
  assert.strictEqual(readLatestContextTokens(file, { tailBytes }), null);
});

test('keeps boundary-aligned usage with the default 256 KiB tail', () => {
  const record = usageRecord({ input: 170000 });
  const toolResult = JSON.stringify({ type: 'user', message: { content: '' } });
  const padding = DEFAULT_TRANSCRIPT_TAIL_BYTES - Buffer.byteLength(record + '\n' + toolResult + '\n');
  const paddedResult = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(padding) } });
  const file = tracked(writeTranscript(['{}', record, paddedResult]));
  assert.deepStrictEqual(readLatestContextTokens(file), {
    tokens: 170000,
    model: 'claude-sonnet-4-6'
  });
});

test('does not parse an out-of-window record when lookbehind reaches the file start', () => {
  const record = usageRecord({ input: 170000 });
  const file = tracked(writeTranscript([record]));
  assert.strictEqual(readLatestContextTokens(file, { tailBytes: Buffer.byteLength(record + '\n') - 1 }), null);
});

test('keeps an in-window usage record when the transcript ends in incomplete UTF-8', () => {
  const record = usageRecord({ input: 170000 }) + '\n';
  const padding = DEFAULT_TRANSCRIPT_TAIL_BYTES - Buffer.byteLength(record) - 2;
  const file = tracked(writeTranscript([]));
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from(record + 'x'.repeat(padding)),
    Buffer.from([0xe4, 0xb8])
  ]));
  assert.deepStrictEqual(readLatestContextTokens(file), {
    tokens: 170000,
    model: 'claude-sonnet-4-6'
  });
});

// ── resolveContextWindowTokens ──
console.log('\nresolveContextWindowTokens:');

// Isolation: an env-set window override (either knob) otherwise leaks into the
// default-window assertions below and fails them (#2290).
const originalContextWindowEnv = {
  ECC_CONTEXT_WINDOW_TOKENS: process.env.ECC_CONTEXT_WINDOW_TOKENS,
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW,
};
delete process.env.ECC_CONTEXT_WINDOW_TOKENS;
delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;

test('defaults to the standard 200k window', () => {
  assert.strictEqual(resolveContextWindowTokens(50000, 'claude-sonnet-4-6'), STANDARD_CONTEXT_WINDOW_TOKENS);
});

test('honors an explicit ECC_CONTEXT_WINDOW_TOKENS override (e.g. 400k models, #2290)', () => {
  process.env.ECC_CONTEXT_WINDOW_TOKENS = '400000';
  try {
    assert.strictEqual(resolveContextWindowTokens(50000, 'claude-opus-4-x'), 400000);
  } finally {
    delete process.env.ECC_CONTEXT_WINDOW_TOKENS;
  }
});

test('honors Claude Code native CLAUDE_CODE_AUTO_COMPACT_WINDOW override', () => {
  process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '400000';
  try {
    assert.strictEqual(resolveContextWindowTokens(50000, 'claude-opus-4-x'), 400000);
  } finally {
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  }
});

test('ignores a non-positive / invalid window override', () => {
  process.env.ECC_CONTEXT_WINDOW_TOKENS = 'not-a-number';
  try {
    assert.strictEqual(resolveContextWindowTokens(50000, 'claude-sonnet-4-6'), STANDARD_CONTEXT_WINDOW_TOKENS);
  } finally {
    delete process.env.ECC_CONTEXT_WINDOW_TOKENS;
  }
});

test('detects a 1M window from the [1m] model marker', () => {
  assert.strictEqual(resolveContextWindowTokens(50000, 'claude-opus-4-5[1m]'), LARGE_CONTEXT_WINDOW_TOKENS);
});

test('detects a 1M window when observed tokens exceed 200k (marker dropped)', () => {
  assert.strictEqual(resolveContextWindowTokens(220000, 'claude-opus-4-5'), LARGE_CONTEXT_WINDOW_TOKENS);
});

test('recognizes claude-fable-5 as a 1M window without a [1m] marker or 200k+ tokens (#2461)', () => {
  assert.strictEqual(resolveContextWindowTokens(187000, 'claude-fable-5'), LARGE_CONTEXT_WINDOW_TOKENS);
});

test('recognizes claude-mythos-5 as a 1M window from the known-model table (#2461)', () => {
  assert.strictEqual(resolveContextWindowTokens(50000, 'claude-mythos-5'), LARGE_CONTEXT_WINDOW_TOKENS);
});

test('recognizes claude-opus-5 as a 1M window from the known-model table', () => {
  assert.strictEqual(resolveContextWindowTokens(50000, 'claude-opus-5'), LARGE_CONTEXT_WINDOW_TOKENS);
});

test('recognizes dated/prefixed variants of known large-window model ids (#2461)', () => {
  assert.strictEqual(resolveContextWindowTokens(50000, 'us.anthropic.claude-fable-5-20260115-v1:0'), LARGE_CONTEXT_WINDOW_TOKENS);
});

test('env window override still wins over the known-model table (#2461)', () => {
  process.env.ECC_CONTEXT_WINDOW_TOKENS = '400000';
  try {
    assert.strictEqual(resolveContextWindowTokens(50000, 'claude-fable-5'), 400000);
  } finally {
    delete process.env.ECC_CONTEXT_WINDOW_TOKENS;
  }
});

test('does not match hypothetical smaller tiers sharing a known-family prefix (#2461)', () => {
  assert.strictEqual(resolveContextWindowTokens(50000, 'claude-fable-5-mini'), STANDARD_CONTEXT_WINDOW_TOKENS);
  assert.strictEqual(resolveContextWindowTokens(50000, 'claude-mythos-5-haiku-20260201'), STANDARD_CONTEXT_WINDOW_TOKENS);
});

test('keeps the 200k default for unknown model ids at low token counts (no false positives, #2461)', () => {
  assert.strictEqual(resolveContextWindowTokens(187000, 'claude-haiku-4-5-20251001'), STANDARD_CONTEXT_WINDOW_TOKENS);
});

test('treats an empty model id as standard window', () => {
  assert.strictEqual(resolveContextWindowTokens(100000, ''), STANDARD_CONTEXT_WINDOW_TOKENS);
});

// Pin both inputs so the precedence regression cannot depend on the harness
// running this test. Restore every variable even when an assertion fails.
for (const [label, tokens, model, explicitWindow, expectedWindow, inferred] of [
  ['[1m] marker', 180000, 'claude-opus-4-5[1m]', undefined, 1000000, false],
  ['known large-window family', 180000, 'claude-fable-5', undefined, 1000000, false],
  ['observed tokens above 200k', 220000, 'unknown-model', undefined, 1000000, true],
  ['explicit ECC override', 220000, 'claude-opus-4-5[1m]', '400000', 400000, false],
  ['auto-compact fallback', 180000, 'unknown-model', undefined, 786432, false],
  ['invalid ECC override with marker', 180000, 'claude-opus-4-5[1m]', 'invalid', 1000000, false],
]) {
  test(`${label} resolves correctly with an explicit auto-compact trigger`, () => {
    const previousExplicit = process.env.ECC_CONTEXT_WINDOW_TOKENS;
    const previousAutoCompact = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
    try {
      if (explicitWindow === undefined) delete process.env.ECC_CONTEXT_WINDOW_TOKENS;
      else process.env.ECC_CONTEXT_WINDOW_TOKENS = explicitWindow;
      process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '786432';
      assert.deepStrictEqual(resolveContextWindow(tokens, model), {
        windowTokens: expectedWindow,
        inferred,
      });
    } finally {
      if (previousExplicit === undefined) delete process.env.ECC_CONTEXT_WINDOW_TOKENS;
      else process.env.ECC_CONTEXT_WINDOW_TOKENS = previousExplicit;
      if (previousAutoCompact === undefined) delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
      else process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = previousAutoCompact;
    }
  });
}

// Window settings must use the same whole-number validation as the summary
// scheduler; a numeric prefix is not evidence of confirmed model capacity.
for (const invalid of ['200000tokens', '200000.5', '9007199254740992', 'Infinity', '1e309', '0', '-1']) {
  test(`rejects malformed or unsafe window setting ${invalid} without changing precedence`, () => {
    const previousExplicit = process.env.ECC_CONTEXT_WINDOW_TOKENS;
    const previousNative = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
    try {
      process.env.ECC_CONTEXT_WINDOW_TOKENS = '';
      process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = invalid;
      assert.deepStrictEqual(resolveContextWindow(180000, 'unknown-model'), {
        windowTokens: STANDARD_CONTEXT_WINDOW_TOKENS, inferred: true,
      });
      process.env.ECC_CONTEXT_WINDOW_TOKENS = invalid;
      process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '400000';
      assert.deepStrictEqual(resolveContextWindow(180000, 'unknown-model'), {
        windowTokens: 400000, inferred: false,
      });
      assert.deepStrictEqual(resolveContextWindow(180000, 'claude-opus-4-5[1m]'), {
        windowTokens: LARGE_CONTEXT_WINDOW_TOKENS, inferred: false,
      });
      process.env.ECC_CONTEXT_WINDOW_TOKENS = '400000';
      process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = invalid;
      assert.deepStrictEqual(resolveContextWindow(180000, 'claude-opus-4-5[1m]'), {
        windowTokens: 400000, inferred: false,
      });
    } finally {
      if (previousExplicit === undefined) delete process.env.ECC_CONTEXT_WINDOW_TOKENS;
      else process.env.ECC_CONTEXT_WINDOW_TOKENS = previousExplicit;
      if (previousNative === undefined) delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
      else process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = previousNative;
    }
  });
}

// ── isContextWindowInferred ──
console.log('\nisContextWindowInferred:');

test('flags the assumed 200k default as inferred', () => {
  assert.strictEqual(isContextWindowInferred(187000, 'claude-opus-9'), true);
});

test('an env override is a detected window, not inferred', () => {
  process.env.ECC_CONTEXT_WINDOW_TOKENS = '1000000';
  try {
    assert.strictEqual(isContextWindowInferred(187000, 'claude-opus-9'), false);
  } finally {
    delete process.env.ECC_CONTEXT_WINDOW_TOKENS;
  }
});

test('a [1m] marker is a detected window, not inferred', () => {
  assert.strictEqual(isContextWindowInferred(187000, 'claude-opus-4-5[1m]'), false);
});

test('a known large-window family is a detected window, not inferred', () => {
  assert.strictEqual(isContextWindowInferred(187000, 'claude-fable-5'), false);
});

test('tokens above the standard window still leave the exact size inferred', () => {
  assert.strictEqual(isContextWindowInferred(220000, 'claude-opus-9'), true);
});

for (const [name, value] of Object.entries(originalContextWindowEnv)) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

// ── resolveContextThreshold ──
console.log('\nresolveContextThreshold:');

test('defaults to 160k for the 200k window', () => {
  assert.strictEqual(resolveContextThreshold({}, STANDARD_CONTEXT_WINDOW_TOKENS), DEFAULT_CONTEXT_THRESHOLD_STANDARD);
});

test('defaults to 250k for the 1M window', () => {
  assert.strictEqual(resolveContextThreshold({}, LARGE_CONTEXT_WINDOW_TOKENS), DEFAULT_CONTEXT_THRESHOLD_LARGE);
});

test('honours COMPACT_CONTEXT_THRESHOLD override', () => {
  assert.strictEqual(resolveContextThreshold({ COMPACT_CONTEXT_THRESHOLD: '1234' }, STANDARD_CONTEXT_WINDOW_TOKENS), 1234);
});

test('COMPACT_CONTEXT_THRESHOLD=0 disables the signal', () => {
  assert.strictEqual(resolveContextThreshold({ COMPACT_CONTEXT_THRESHOLD: '0' }, STANDARD_CONTEXT_WINDOW_TOKENS), 0);
});

test('invalid COMPACT_CONTEXT_THRESHOLD falls back to the default', () => {
  for (const bad of ['-5', 'abc', '99999999999']) {
    assert.strictEqual(resolveContextThreshold({ COMPACT_CONTEXT_THRESHOLD: bad }, STANDARD_CONTEXT_WINDOW_TOKENS), DEFAULT_CONTEXT_THRESHOLD_STANDARD, `Expected fallback for ${bad}`);
  }
});

test('caps only the default reminder at 80 percent of a valid native budget', () => {
  assert.strictEqual(resolveContextThreshold({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '200000' }, LARGE_CONTEXT_WINDOW_TOKENS), 160000);
  assert.strictEqual(resolveContextThreshold({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000' }, STANDARD_CONTEXT_WINDOW_TOKENS), 80000);
  assert.strictEqual(resolveContextThreshold({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '2000000' }, LARGE_CONTEXT_WINDOW_TOKENS), DEFAULT_CONTEXT_THRESHOLD_LARGE);
  assert.strictEqual(resolveContextThreshold({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1' }, LARGE_CONTEXT_WINDOW_TOKENS), 1);
});

test('native reminder budget never overrides explicit threshold policy or disable', () => {
  for (const threshold of ['0', '100000', '250000']) {
    assert.strictEqual(resolveContextThreshold({
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '200000', COMPACT_CONTEXT_THRESHOLD: threshold,
    }, LARGE_CONTEXT_WINDOW_TOKENS), Number(threshold));
  }
});

test('malformed or unsafe native budgets do not cap the default reminder', () => {
  for (const invalid of ['200000tokens', '200000.5', '9007199254740992', 'Infinity', '0', '-1']) {
    assert.strictEqual(resolveContextThreshold({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: invalid }, LARGE_CONTEXT_WINDOW_TOKENS), DEFAULT_CONTEXT_THRESHOLD_LARGE);
  }
});

// ── resolveContextInterval ──
console.log('\nresolveContextInterval:');

test('defaults to 60k tokens', () => {
  assert.strictEqual(resolveContextInterval({}), DEFAULT_CONTEXT_INTERVAL_TOKENS);
});

test('honours COMPACT_CONTEXT_INTERVAL override', () => {
  assert.strictEqual(resolveContextInterval({ COMPACT_CONTEXT_INTERVAL: '5000' }), 5000);
});

test('invalid COMPACT_CONTEXT_INTERVAL falls back to the default', () => {
  for (const bad of ['0', '-1', 'abc']) {
    assert.strictEqual(resolveContextInterval({ COMPACT_CONTEXT_INTERVAL: bad }), DEFAULT_CONTEXT_INTERVAL_TOKENS, `Expected fallback for ${bad}`);
  }
});

// ── computeContextBucket ──
console.log('\ncomputeContextBucket:');

test('returns -1 below the threshold', () => {
  assert.strictEqual(computeContextBucket(159999, 160000, 60000), -1);
});

test('returns bucket 0 at the threshold', () => {
  assert.strictEqual(computeContextBucket(160000, 160000, 60000), 0);
});

test('increments the bucket after each interval of growth', () => {
  assert.strictEqual(computeContextBucket(219999, 160000, 60000), 0);
  assert.strictEqual(computeContextBucket(220000, 160000, 60000), 1);
  assert.strictEqual(computeContextBucket(280000, 160000, 60000), 2);
});

test('returns -1 when the threshold is disabled (0)', () => {
  assert.strictEqual(computeContextBucket(500000, 0, 60000), -1);
});

test('returns -1 for non-finite token counts', () => {
  assert.strictEqual(computeContextBucket(NaN, 160000, 60000), -1);
});

// ── readFileTail ──
console.log('\nreadFileTail:');

test('is exported and returns the trailing bytes with a truncation flag', () => {
  assert.strictEqual(typeof readFileTail, 'function');
  assert.strictEqual(DEFAULT_TRANSCRIPT_TAIL_BYTES, 256 * 1024);
  const file = tracked(writeTranscript(['first-line', 'second', 'third']));
  const whole = readFileTail(file, 1024);
  assert.deepStrictEqual(whole, { text: 'first-line\nsecond\nthird\n', truncated: false });
  const tail = readFileTail(file, 6);
  assert.deepStrictEqual(tail, { text: 'third\n', truncated: true });
  assert.strictEqual(readFileTail(path.join(transcriptRoot, `missing-${process.pid}.jsonl`), 10), null);
});

// ── formatWindowLabel ──
console.log('\nformatWindowLabel:');

test('labels the standard and large windows', () => {
  assert.strictEqual(formatWindowLabel(STANDARD_CONTEXT_WINDOW_TOKENS), '200k');
  assert.strictEqual(formatWindowLabel(LARGE_CONTEXT_WINDOW_TOKENS), '1M');
});

// Cleanup
for (const filePath of cleanupPaths) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
