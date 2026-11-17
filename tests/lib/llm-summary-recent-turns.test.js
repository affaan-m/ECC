'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractConversationText } = require('../../scripts/lib/llm-summary');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-summary-recent-'));
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}: ${error.message}`);
    failed++;
  }
}

function user(text) {
  return JSON.stringify({ type: 'user', message: { content: text } });
}

function transcript(lines) {
  const file = path.join(directory, 'transcript.jsonl');
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

function countParses(fn) {
  const original = JSON.parse;
  let calls = 0;
  JSON.parse = (...args) => {
    calls++;
    return original(...args);
  };
  try {
    return { result: fn(), calls };
  } finally {
    JSON.parse = original;
  }
}

try {
  test('does not parse old records after collecting the last 25 turns', () => {
    const lines = Array.from({ length: 10000 }, (_, index) => user(`turn ${index}`));
    const file = transcript(lines);
    const { result, calls } = countParses(() => extractConversationText(file));
    assert.strictEqual(result, Array.from({ length: 25 }, (_, index) =>
      `**User:** turn ${9975 + index}`).join('\n\n'));
    assert.ok(calls <= 30, `parsed ${calls} records for a 25-turn summary`);
  });

  test('skips tool results, empty turns, notices and malformed tail records', () => {
    const lines = Array.from({ length: 1000 }, (_, index) => user(`turn ${index}`));
    lines.push('', '{broken', JSON.stringify({ type: 'tool', content: 'tool result' }),
      user(''), user('Your response above was stopped by a safety classifier — this is not a tool or API error.'));
    const file = transcript(lines);
    const { result, calls } = countParses(() => extractConversationText(file));
    assert.strictEqual(result, Array.from({ length: 25 }, (_, index) =>
      `**User:** turn ${975 + index}`).join('\n\n'));
    assert.ok(calls <= 35, `parsed ${calls} records for a 25-turn summary`);
  });

  test('preserves chronological role order and the limit across a dual-role record', () => {
    const lines = Array.from({ length: 1000 }, (_, index) => user(`old ${index}`));
    lines.push(JSON.stringify({ type: 'assistant', message: {
      role: 'user', content: [{ type: 'text', text: 'shared' }]
    } }));
    lines.push(...Array.from({ length: 24 }, (_, index) => user(`new ${index}`)));
    const file = transcript(lines);
    const { result, calls } = countParses(() => extractConversationText(file));
    assert.strictEqual(result, ['**Claude:** shared', ...Array.from({ length: 24 }, (_, index) =>
      `**User:** new ${index}`)].join('\n\n'));
    assert.ok(calls <= 30, `parsed ${calls} records for a 25-turn summary`);
  });
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
