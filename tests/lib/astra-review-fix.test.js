/**
 * Tests for scripts/lib/astra-review/fix.js
 *
 * Run with: node tests/lib/astra-review-fix.test.js
 */

'use strict';

const assert = require('assert');
const fix = require('../../scripts/lib/astra-review/fix');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

const finding = {
  severity: 'HIGH', file: 'src/a.js', line: 12, title: 'Off by one', detail: 'loop skips last item', suggestion: 'use <=',
};

console.log('=== Testing astra-review/fix.js ===\n');

test('loadFindings reads the findings of a saved verdict payload', () => {
  const text = JSON.stringify({ model: 'gpt-6-astra', verdict: 'FAIL', review: { findings: [finding] } });

  const findings = fix.loadFindings(text);

  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].title, 'Off by one');
  assert.ok(Object.isFrozen(findings[0]));
});

test('loadFindings accepts a bare array and a {findings} object', () => {
  assert.strictEqual(fix.loadFindings(JSON.stringify([finding])).length, 1);
  assert.strictEqual(fix.loadFindings(JSON.stringify({ findings: [finding, finding] })).length, 2);
});

test('loadFindings rejects invalid JSON, an empty list, and malformed findings', () => {
  assert.throws(() => fix.loadFindings('{nope'), /not valid JSON/);
  assert.throws(() => fix.loadFindings('[]'), /no findings to fix/);
  assert.throws(() => fix.loadFindings('{"other":1}'), /findings/);
  assert.throws(() => fix.loadFindings(JSON.stringify([{ ...finding, severity: 'URGENT' }])), /severity/);
});

test('buildFixPrompt lists every finding with its location and sets the write rules', () => {
  const prompt = fix.buildFixPrompt({ findings: [finding, { ...finding, line: null, file: 'b.js', title: 'Leak' }] });

  assert.ok(prompt.includes('[HIGH] src/a.js:12 — Off by one'));
  assert.ok(prompt.includes('[HIGH] b.js — Leak'));
  assert.ok(prompt.includes('Suggestion: use <='));
  assert.ok(/untrusted data/i.test(prompt));
  assert.ok(/do not commit/i.test(prompt));
  assert.ok(/only what each finding requires/i.test(prompt));
});

test('buildFixPrompt appends extra instructions only when given', () => {
  assert.ok(!fix.buildFixPrompt({ findings: [finding] }).includes('Additional instructions'));
  assert.ok(fix.buildFixPrompt({ findings: [finding], extraInstructions: 'keep API stable' }).includes('keep API stable'));
});

test('parseFixOutput validates and freezes the fixer response', () => {
  const result = fix.parseFixOutput(JSON.stringify({
    summary: 'fixed one',
    fixed: [{ title: 'Off by one', file: 'src/a.js', change: 'use <=' }],
    skipped: [],
  }));

  assert.strictEqual(result.fixed.length, 1);
  assert.ok(Object.isFrozen(result));
  assert.throws(() => fix.parseFixOutput('not json'), /not valid JSON/);
  assert.throws(() => fix.parseFixOutput(JSON.stringify({ summary: 'x', fixed: 'no', skipped: [] })), /fixed/);
  assert.throws(() => fix.parseFixOutput(JSON.stringify({ summary: 'x', fixed: [], skipped: [{ title: 1 }] })), /skipped/);
});

test('parseFixOutput accepts a fenced JSON response', () => {
  const result = fix.parseFixOutput('```json\n{"summary":"s","fixed":[],"skipped":[]}\n```');

  assert.strictEqual(result.summary, 's');
});

test('formatFixReport shows fixed and skipped items and tells the caller to verify', () => {
  const report = fix.formatFixReport(
    { summary: 'done', fixed: [{ title: 'Off by one', file: 'src/a.js', change: 'use <=' }], skipped: [{ title: 'Leak', reason: 'false positive' }] },
    { model: 'gpt-6-astra', findings: [finding, finding] }
  );

  assert.ok(report.includes('# Astra Fix (gpt-6-astra)'));
  assert.ok(report.includes('Findings sent: 2'));
  assert.ok(report.includes('- src/a.js — Off by one: use <='));
  assert.ok(report.includes('- Leak: false positive'));
  assert.ok(/git diff/.test(report));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
