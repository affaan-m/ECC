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
  EXTENDED_CONTEXT_WINDOW_TOKENS,
  LARGE_CONTEXT_WINDOW_TOKENS,
  DEFAULT_CONTEXT_THRESHOLD_PCT,
  UNKNOWN_WINDOW_THRESHOLD_TOKENS,
  DEFAULT_CONTEXT_INTERVAL_TOKENS,
  readLatestContextTokens,
  resolveContextWindowTokens,
  resolveContextThreshold,
  resolveContextInterval,
  computeContextBucket,
  formatWindowLabel
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

let fixtureSeq = 0;

function writeTranscript(lines) {
  fixtureSeq += 1;
  const filePath = path.join(os.tmpdir(), `transcript-context-test-${process.pid}-${fixtureSeq}.jsonl`);
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
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
  assert.strictEqual(readLatestContextTokens(path.join(os.tmpdir(), 'definitely-missing.jsonl')), null);
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

// ── resolveContextWindowTokens ──
console.log('\nresolveContextWindowTokens:');

// Isolation: an env-set window override (either knob) otherwise leaks into the
// default-window assertions below and fails them (#2290).
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

test('recognizes opus-4 as a 400k window without an env override (#2290)', () => {
  assert.strictEqual(resolveContextWindowTokens(220000, 'claude-opus-4-5'), EXTENDED_CONTEXT_WINDOW_TOKENS);
  assert.strictEqual(resolveContextWindowTokens(50000, 'claude-opus-4-1-20250805'), EXTENDED_CONTEXT_WINDOW_TOKENS);
});

test('recognizes 200k families by pattern (sonnet-4 / haiku / claude-3 / opus-3)', () => {
  for (const model of ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-3-5-sonnet-20241022', 'claude-opus-3']) {
    assert.strictEqual(resolveContextWindowTokens(50000, model), STANDARD_CONTEXT_WINDOW_TOKENS, `Expected 200k for ${model}`);
  }
});

test('returns null for an unrecognized model id instead of guessing a window', () => {
  assert.strictEqual(resolveContextWindowTokens(220000, 'some-future-model-9'), null);
  assert.strictEqual(resolveContextWindowTokens(50000, 'gpt-nextgen'), null);
});

test('returns null without a model id once tokens exceed the standard window', () => {
  // Provably larger than 200k, but nothing says how much larger - so no guess.
  assert.strictEqual(resolveContextWindowTokens(220000, ''), null);
  assert.strictEqual(resolveContextWindowTokens(220000, undefined), null);
});

test('recognizes claude-fable-5 as a 1M window without a [1m] marker or 200k+ tokens (#2461)', () => {
  assert.strictEqual(resolveContextWindowTokens(187000, 'claude-fable-5'), LARGE_CONTEXT_WINDOW_TOKENS);
});

test('recognizes claude-mythos-5 as a 1M window from the known-model table (#2461)', () => {
  assert.strictEqual(resolveContextWindowTokens(50000, 'claude-mythos-5'), LARGE_CONTEXT_WINDOW_TOKENS);
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
  // Neither id may inherit the 1M window of its family. `-haiku` is a known
  // 200k pattern; `-mini` matches nothing at all, so its window is unknown.
  assert.strictEqual(resolveContextWindowTokens(50000, 'claude-mythos-5-haiku-20260201'), STANDARD_CONTEXT_WINDOW_TOKENS);
  assert.strictEqual(resolveContextWindowTokens(50000, 'claude-fable-5-mini'), null);
});

test('keeps the 200k default for unknown model ids at low token counts (no false positives, #2461)', () => {
  assert.strictEqual(resolveContextWindowTokens(187000, 'claude-haiku-4-5-20251001'), STANDARD_CONTEXT_WINDOW_TOKENS);
});

test('treats an empty model id as standard window', () => {
  assert.strictEqual(resolveContextWindowTokens(100000, ''), STANDARD_CONTEXT_WINDOW_TOKENS);
});

// ── resolveContextThreshold ──
console.log('\nresolveContextThreshold:');

test('defaults to 70% of the window at every size', () => {
  assert.strictEqual(resolveContextThreshold({}, STANDARD_CONTEXT_WINDOW_TOKENS), 140000);
  assert.strictEqual(resolveContextThreshold({}, EXTENDED_CONTEXT_WINDOW_TOKENS), 280000);
  assert.strictEqual(resolveContextThreshold({}, LARGE_CONTEXT_WINDOW_TOKENS), 700000);
});

test('derives the default from DEFAULT_CONTEXT_THRESHOLD_PCT for any window size', () => {
  for (const windowTokens of [200000, 400000, 1000000, 2000000]) {
    assert.strictEqual(
      resolveContextThreshold({}, windowTokens),
      Math.round(windowTokens * DEFAULT_CONTEXT_THRESHOLD_PCT),
      `Expected the percentage default for a ${windowTokens}-token window`
    );
  }
});

test('falls back to a fixed threshold when the window is unknown', () => {
  // No percentage exists without a window; 300k is past every standard window,
  // so the nudge is still truthful.
  assert.strictEqual(resolveContextThreshold({}, null), UNKNOWN_WINDOW_THRESHOLD_TOKENS);
  assert.strictEqual(resolveContextThreshold({}, undefined), UNKNOWN_WINDOW_THRESHOLD_TOKENS);
  assert.strictEqual(resolveContextThreshold({}, 0), UNKNOWN_WINDOW_THRESHOLD_TOKENS);
});

test('honours COMPACT_CONTEXT_THRESHOLD override', () => {
  assert.strictEqual(resolveContextThreshold({ COMPACT_CONTEXT_THRESHOLD: '1234' }, STANDARD_CONTEXT_WINDOW_TOKENS), 1234);
});

test('an absolute COMPACT_CONTEXT_THRESHOLD still wins over the percentage default', () => {
  assert.strictEqual(resolveContextThreshold({ COMPACT_CONTEXT_THRESHOLD: '250000' }, LARGE_CONTEXT_WINDOW_TOKENS), 250000);
  assert.strictEqual(resolveContextThreshold({ COMPACT_CONTEXT_THRESHOLD: '160000' }, null), 160000);
});

test('COMPACT_CONTEXT_THRESHOLD=0 disables the signal', () => {
  assert.strictEqual(resolveContextThreshold({ COMPACT_CONTEXT_THRESHOLD: '0' }, STANDARD_CONTEXT_WINDOW_TOKENS), 0);
  assert.strictEqual(resolveContextThreshold({ COMPACT_CONTEXT_THRESHOLD: '0' }, null), 0);
});

test('invalid COMPACT_CONTEXT_THRESHOLD falls back to the default', () => {
  for (const bad of ['-5', 'abc', '99999999999']) {
    assert.strictEqual(resolveContextThreshold({ COMPACT_CONTEXT_THRESHOLD: bad }, STANDARD_CONTEXT_WINDOW_TOKENS), 140000, `Expected fallback for ${bad}`);
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

test('keeps the 60k floor for known windows up to 1M', () => {
  assert.strictEqual(resolveContextInterval({}, STANDARD_CONTEXT_WINDOW_TOKENS), DEFAULT_CONTEXT_INTERVAL_TOKENS);
  assert.strictEqual(resolveContextInterval({}, EXTENDED_CONTEXT_WINDOW_TOKENS), DEFAULT_CONTEXT_INTERVAL_TOKENS);
  assert.strictEqual(resolveContextInterval({}, LARGE_CONTEXT_WINDOW_TOKENS), DEFAULT_CONTEXT_INTERVAL_TOKENS);
});

test('scales the interval with very large windows (5% of window)', () => {
  assert.strictEqual(resolveContextInterval({}, 2000000), 100000);
});

test('an explicit COMPACT_CONTEXT_INTERVAL still wins over window scaling', () => {
  assert.strictEqual(resolveContextInterval({ COMPACT_CONTEXT_INTERVAL: '5000' }, 2000000), 5000);
});

test('unknown window keeps the default interval', () => {
  assert.strictEqual(resolveContextInterval({}, null), DEFAULT_CONTEXT_INTERVAL_TOKENS);
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

// ── formatWindowLabel ──
console.log('\nformatWindowLabel:');

test('labels the standard and large windows', () => {
  assert.strictEqual(formatWindowLabel(STANDARD_CONTEXT_WINDOW_TOKENS), '200k');
  assert.strictEqual(formatWindowLabel(LARGE_CONTEXT_WINDOW_TOKENS), '1M');
});

test('labels the extended and multi-million windows', () => {
  assert.strictEqual(formatWindowLabel(EXTENDED_CONTEXT_WINDOW_TOKENS), '400k');
  assert.strictEqual(formatWindowLabel(1500000), '1.5M');
  assert.strictEqual(formatWindowLabel(2000000), '2M');
});

test('labels an undetermined window as unknown', () => {
  assert.strictEqual(formatWindowLabel(null), 'unknown');
  assert.strictEqual(formatWindowLabel(undefined), 'unknown');
  assert.strictEqual(formatWindowLabel(0), 'unknown');
  assert.strictEqual(formatWindowLabel(NaN), 'unknown');
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
