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
function writeTranscript(lines) {
  seq++;
  const p = path.join(os.tmpdir(), `llm-summary-test-${process.pid}-${seq}.jsonl`);
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
  const p = writeTranscript([assistantEntry('ok')]);
  const pct = getContextRemainingPct(p);
  assert.ok(typeof pct === 'number');
  assert.ok(pct >= 0 && pct <= 100);
});

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

test('returns null for missing transcript (no conversation to summarize)', () => {
  const orig = process.env.ECC_SKIP_LLM_SUMMARY;
  delete process.env.ECC_SKIP_LLM_SUMMARY;
  assert.strictEqual(generateSessionSummary('/nonexistent.jsonl'), null);
  if (orig !== undefined) process.env.ECC_SKIP_LLM_SUMMARY = orig;
});

// --- Results ---
console.log('\n=== Test Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
