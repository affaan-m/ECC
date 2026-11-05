'use strict';
/**
 * Tests for scripts/lib/llm-summary.js
 *
 * Run with: node tests/lib/llm-summary.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { extractConversationText, getContextRemainingPct, getContextThreshold, getLLMModel, generateSessionSummary } = require('../../scripts/lib/llm-summary');

console.log('=== Testing llm-summary.js ===\n');

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

let seq = 0;
const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-summary-test-'));
function writeTranscript(lines) {
  seq++;
  const p = path.join(transcriptDir, `transcript-${seq}.jsonl`);
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

function userEntry(text) {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
}

function assistantEntry(text) {
  return JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    }
  });
}

// --- getLLMModel ---
console.log('getLLMModel:');

test('returns haiku by default', () => {
  const orig = process.env.ECC_LLM_SUMMARY_MODEL;
  delete process.env.ECC_LLM_SUMMARY_MODEL;
  assert.strictEqual(getLLMModel(), 'haiku');
  if (orig !== undefined) process.env.ECC_LLM_SUMMARY_MODEL = orig;
});

test('reads ECC_LLM_SUMMARY_MODEL env var', () => {
  const orig = process.env.ECC_LLM_SUMMARY_MODEL;
  process.env.ECC_LLM_SUMMARY_MODEL = 'sonnet';
  assert.strictEqual(getLLMModel(), 'sonnet');
  if (orig !== undefined) process.env.ECC_LLM_SUMMARY_MODEL = orig;
  else delete process.env.ECC_LLM_SUMMARY_MODEL;
});

// --- getContextThreshold ---
console.log('\ngetContextThreshold:');

test('returns 20 by default', () => {
  const orig = process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD;
  delete process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD;
  assert.strictEqual(getContextThreshold(), 20);
  if (orig !== undefined) process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD = orig;
});

test('reads ECC_LLM_SUMMARY_CONTEXT_THRESHOLD env var', () => {
  const orig = process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD;
  process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD = '70';
  assert.strictEqual(getContextThreshold(), 70);
  if (orig !== undefined) process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD = orig;
  else delete process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD;
});

test('falls back to 20 on invalid value', () => {
  const orig = process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD;
  process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD = 'notanumber';
  assert.strictEqual(getContextThreshold(), 20);
  if (orig !== undefined) process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD = orig;
  else delete process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD;
});

test('falls back to 20 when value exceeds 100', () => {
  const orig = process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD;
  process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD = '150';
  assert.strictEqual(getContextThreshold(), 20);
  if (orig !== undefined) process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD = orig;
  else delete process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD;
});

// --- extractConversationText ---
console.log('\nextractConversationText:');

test('returns null for missing file', () => {
  assert.strictEqual(extractConversationText('/nonexistent/path.jsonl'), null);
});

test('returns null for empty transcript', () => {
  const p = writeTranscript([]);
  assert.strictEqual(extractConversationText(p), null);
});

test('extracts user and assistant turns', () => {
  const p = writeTranscript([userEntry('Hello, can you help?'), assistantEntry('Sure, what do you need?')]);
  const result = extractConversationText(p);
  assert.ok(result.includes('User:'));
  assert.ok(result.includes('Claude:'));
  assert.ok(result.includes('Hello, can you help?'));
});

test('truncates user text to 400 chars', () => {
  const p = writeTranscript([userEntry('x'.repeat(500))]);
  const result = extractConversationText(p);
  assert.ok(result !== null);
  assert.ok(!result.includes('x'.repeat(401)));
});

test('skips unparseable lines gracefully', () => {
  const p = writeTranscript(['not valid json', userEntry('valid message')]);
  const result = extractConversationText(p);
  assert.ok(result !== null);
  assert.ok(result.includes('valid message'));
});

test('limits to last 25 turns', () => {
  const lines = [];
  for (let i = 0; i < 30; i++) lines.push(userEntry(`message ${i}`));
  const p = writeTranscript(lines);
  const result = extractConversationText(p);
  assert.ok(result.includes('message 29'));
  assert.ok(!result.includes('message 4'));
});

test('collapses newlines to spaces', () => {
  const p = writeTranscript([userEntry('line one\nline two')]);
  const result = extractConversationText(p);
  assert.ok(!result.includes('\nline two'));
  assert.ok(result.includes('line one line two'));
});

// --- getContextRemainingPct ---
console.log('\ngetContextRemainingPct:');

test('returns null for missing file', () => {
  assert.strictEqual(getContextRemainingPct('/nonexistent.jsonl'), null);
});

test('returns null for transcript with no usage data', () => {
  const p = writeTranscript([userEntry('hi')]);
  assert.strictEqual(getContextRemainingPct(p), null);
});

test('returns numeric percentage for transcript with usage data', () => {
  const parsed = JSON.parse(assistantEntry('ok'));
  const entry = { ...parsed, message: { ...parsed.message, model: 'claude-opus-4-5[1m]' } };
  const p = writeTranscript([JSON.stringify(entry)]);
  const pct = getContextRemainingPct(p);
  assert.ok(typeof pct === 'number');
  assert.ok(pct >= 0 && pct <= 100);
});

for (const [label, model, nativeBudget, explicitWindow, expected, tokens = 330000] of [
  ['inferred window uses native compaction budget conservatively', 'unknown-model', '400000', '', 18],
  ['unknown capacity without a budget stays unknown', 'unknown-model', '', '', null],
  ['summary precedes native compaction even with confirmed model capacity', 'claude-opus-4-5[1m]', '400000', '', 18],
  ['explicit ECC window remains authoritative', 'claude-opus-4-5[1m]', '786432', '400000', 18],
  ['invalid compaction budget does not certify an inferred window', 'unknown-model', 'invalid', '', null],
  ['native budget cannot exceed confirmed model capacity', 'claude-opus-4-5[1m]', '2000000', '', 67],
  ['explicit capacity does not defer a smaller native compaction budget', 'claude-opus-4-5[1m]', '400000', '1000000', 18],
  ['native 786k compaction receives a timely summary on a 1M model', 'claude-opus-4-5[1m]', '786432', '', 10, 710000],
  ['confirmed capacity remains usable without a native budget', 'claude-opus-4-5[1m]', '', '', 67],
  ['known model family also respects the earlier native budget', 'claude-fable-5', '400000', '', 18],
  ['unknown capacity rejects a numeric native prefix', 'unknown-model', '200000tokens', '', null, 180000],
  ['unknown capacity rejects a fractional native budget', 'unknown-model', '200000.5', '', null, 180000],
  ['unknown capacity rejects an unsafe native integer', 'unknown-model', '9007199254740992', '', null, 180000],
  ['invalid explicit prefix does not override a valid native budget', 'unknown-model', '400000', '200000tokens', 55, 180000],
]) {
  test(label, () => {
    const keys = ['ECC_CONTEXT_WINDOW_TOKENS', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'];
    const previous = keys.map(key => process.env[key]);
    try {
      process.env.ECC_CONTEXT_WINDOW_TOKENS = explicitWindow;
      process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = nativeBudget;
      const parsed = JSON.parse(assistantEntry('preserve context'));
      const entry = {
        ...parsed,
        message: { ...parsed.message, model, usage: { ...parsed.message.usage, input_tokens: tokens } },
      };
      assert.strictEqual(getContextRemainingPct(writeTranscript([JSON.stringify(entry)])), expected);
      if (model.includes('[1m]') || model === 'claude-fable-5') {
        const { resolveContextWindowTokens } = require('../../scripts/lib/transcript-context');
        assert.strictEqual(resolveContextWindowTokens(tokens, model), explicitWindow ? Number(explicitWindow) : 1000000,
          'summary scheduling must not change model capacity resolution');
      }
    } finally {
      keys.forEach((key, index) => {
        if (previous[index] === undefined) delete process.env[key];
        else process.env[key] = previous[index];
      });
    }
  });
}

// --- generateSessionSummary ---
console.log('\ngenerateSessionSummary:');

test('returns null when ECC_SKIP_LLM_SUMMARY is set', () => {
  const orig = process.env.ECC_SKIP_LLM_SUMMARY;
  process.env.ECC_SKIP_LLM_SUMMARY = '1';
  const p = writeTranscript([userEntry('test')]);
  assert.strictEqual(generateSessionSummary(p), null);
  if (orig !== undefined) process.env.ECC_SKIP_LLM_SUMMARY = orig;
  else delete process.env.ECC_SKIP_LLM_SUMMARY;
});

test('reports the explicit recursion guard as a deliberate skip', () => {
  const orig = process.env.ECC_SKIP_LLM_SUMMARY;
  process.env.ECC_SKIP_LLM_SUMMARY = '1';
  try {
    const skipped = [];
    assert.strictEqual(generateSessionSummary('/nonexistent.jsonl', {
      onSkip: reason => skipped.push(reason)
    }), null);
    assert.deepStrictEqual(skipped, ['ECC_SKIP_LLM_SUMMARY']);
  } finally {
    if (orig !== undefined) process.env.ECC_SKIP_LLM_SUMMARY = orig;
    else delete process.env.ECC_SKIP_LLM_SUMMARY;
  }
});

test('returns null for missing transcript (no conversation to summarize)', () => {
  const orig = process.env.ECC_SKIP_LLM_SUMMARY;
  delete process.env.ECC_SKIP_LLM_SUMMARY;
  assert.strictEqual(generateSessionSummary('/nonexistent.jsonl'), null);
  if (orig !== undefined) process.env.ECC_SKIP_LLM_SUMMARY = orig;
});

test('marks the spawned summarizer so its Stop hook cannot create resume state', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'lib', 'llm-summary.js'),
    'utf8'
  );
  assert.match(source, /ECC_LLM_SUMMARY_SUBPROCESS:\s*'1'/);
});

// --- Results ---
// Execute the real helper with a controlled clock and child-process boundary.
// These cases never invoke Claude or use the developer's authentication.
function summaryProbe(deadline, now = 100000, spawnResult = { status: 0, stdout: 'summary' }) {
  const vm = require('vm');
  const source = fs.readFileSync(path.join(__dirname, '../../scripts/lib/llm-summary.js'), 'utf8');
  const calls = [];
  const env = deadline === undefined ? {} : { ECC_HOOK_DEADLINE_MS: String(deadline) };
  const sandbox = {
    module: { exports: {} },
    process: { env, platform: process.platform },
    Date: { now: () => now },
    require: name => name === 'child_process'
      ? { spawnSync: (...args) => { calls.push(args); return spawnResult; } }
      : require(name)
  };
  vm.runInNewContext(source, sandbox, { filename: path.join(__dirname, '../../scripts/lib/llm-summary.js') });
  const skipped = [];
  const result = sandbox.module.exports.generateSessionSummary(
    writeTranscript([userEntry('Preserve mechanical resume state')]),
    { onSkip: reason => skipped.push(reason) }
  );
  return { calls, skipped, result };
}

test('limits summarizer to remaining hook budget minus persistence reserve', () => {
  const probe = summaryProbe(105000);
  assert.strictEqual(probe.result, 'summary');
  assert.strictEqual(probe.calls[0][2].timeout, 4000);
  assert.strictEqual(probe.skipped.length, 0);
});

test('retains the standalone timeout and caps longer inherited budgets', () => {
  assert.strictEqual(summaryProbe(undefined).calls[0][2].timeout, 90000);
  assert.strictEqual(summaryProbe(300000).calls[0][2].timeout, 90000);
});

for (const deadline of [99999, 100000, 100999, 101000, '', -1, 'invalid', 'Infinity', '1.5', Number.MAX_SAFE_INTEGER + 1]) {
  test(`skips summarizer with exhausted or invalid deadline ${deadline}`, () => {
    const probe = summaryProbe(deadline);
    assert.strictEqual(probe.result, null);
    assert.strictEqual(probe.calls.length, 0, 'No child should start without a safe budget');
    assert.strictEqual(probe.skipped.length, 1, 'Skip must be distinguishable from Claude failure');
  });
}

test('keeps process failures distinct from deliberate budget skips', () => {
  const probe = summaryProbe(105000, 100000, { status: 1, stdout: '' });
  assert.strictEqual(probe.result, null);
  assert.strictEqual(probe.calls.length, 1);
  assert.strictEqual(probe.skipped.length, 0);
});

console.log('\n=== Test Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
