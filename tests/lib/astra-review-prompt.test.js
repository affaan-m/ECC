/**
 * Tests for scripts/lib/astra-review/prompt.js
 *
 * Run with: node tests/lib/astra-review-prompt.test.js
 */

'use strict';

const assert = require('assert');
const prompt = require('../../scripts/lib/astra-review/prompt');

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

const validReview = {
  verdict: 'FAIL',
  summary: 'One critical issue.',
  checks: prompt.RUBRIC.map(([criterion]) => ({
    criterion,
    result: criterion === 'Security' ? 'FAIL' : 'PASS',
    detail: criterion === 'Security' ? 'Secret in code' : 'ok',
  })),
  findings: [
    { severity: 'CRITICAL', file: 'a.js', line: 3, title: 'Hardcoded key', detail: 'd', suggestion: 's' },
    { severity: 'LOW', file: 'b.js', line: null, title: 'Nit', detail: 'd', suggestion: 's' },
  ],
};

console.log('=== Testing astra-review/prompt.js ===\n');

test('buildPrompt embeds the file list, diff, and rubric', () => {
  const text = prompt.buildPrompt({
    files: ['src/a.js'],
    diff: '+hello',
    truncated: false,
    scopeLabel: 'uncommitted changes',
  });

  assert.ok(text.includes('src/a.js'));
  assert.ok(text.includes('+hello'));
  assert.ok(text.includes('Correctness'));
  assert.ok(text.includes('Security'));
  assert.ok(text.includes('untrusted data'));
});

test('buildPrompt embeds the scope recovery hint when the diff was truncated', () => {
  const text = prompt.buildPrompt({
    files: ['x.js'], diff: '', truncated: true, scopeLabel: 's',
    recovery: 'git diff parent1 abc1234 -- <path>',
  });

  assert.ok(/truncated/i.test(text));
  assert.ok(text.includes('git diff parent1 abc1234 -- <path>'));
  assert.ok(/every omitted/i.test(text));
});

test('buildPrompt does not mention recovery commands when the diff is complete', () => {
  const text = prompt.buildPrompt({
    files: ['x.js'], diff: '+x', truncated: false, scopeLabel: 's', recovery: 'git show abc:<path>',
  });

  assert.ok(!text.includes('git show abc:<path>'));
});

test('buildPrompt appends extra instructions when provided', () => {
  const text = prompt.buildPrompt({
    files: [], diff: '', truncated: false, scopeLabel: 's', extraInstructions: 'Focus on SQL.',
  });

  assert.ok(text.includes('Focus on SQL.'));
});

test('parseReviewOutput accepts valid JSON', () => {
  const parsed = prompt.parseReviewOutput(JSON.stringify(validReview));

  assert.strictEqual(parsed.verdict, 'FAIL');
  assert.strictEqual(parsed.findings.length, 2);
});

test('parseReviewOutput strips markdown code fences', () => {
  const parsed = prompt.parseReviewOutput('```json\n' + JSON.stringify(validReview) + '\n```');

  assert.strictEqual(parsed.summary, 'One critical issue.');
});

test('parseReviewOutput rejects invalid verdicts', () => {
  assert.throws(
    () => prompt.parseReviewOutput(JSON.stringify({ ...validReview, verdict: 'MAYBE' })),
    /verdict/
  );
});

test('parseReviewOutput rejects unknown severities', () => {
  const bad = { ...validReview, findings: [{ ...validReview.findings[0], severity: 'HUGE' }] };

  assert.throws(() => prompt.parseReviewOutput(JSON.stringify(bad)), /severity/);
});

test('parseReviewOutput rejects missing or non-array findings and checks', () => {
  const noFindings = { ...validReview };
  delete noFindings.findings;
  assert.throws(() => prompt.parseReviewOutput(JSON.stringify(noFindings)), /findings/);
  assert.throws(
    () => prompt.parseReviewOutput(JSON.stringify({ ...validReview, findings: {} })),
    /findings/
  );
  assert.throws(
    () => prompt.parseReviewOutput(JSON.stringify({ ...validReview, checks: 'x' })),
    /checks/
  );
});

test('parseReviewOutput rejects a bare verdict with nothing else', () => {
  assert.throws(() => prompt.parseReviewOutput('{"verdict":"PASS"}'), /summary|checks|findings/);
});

test('parseReviewOutput requires every rubric criterion to be judged exactly once', () => {
  const missing = { ...validReview, checks: validReview.checks.slice(1) };
  assert.throws(() => prompt.parseReviewOutput(JSON.stringify(missing)), /Correctness/);

  const duplicated = { ...validReview, checks: [...validReview.checks, validReview.checks[0]] };
  assert.throws(() => prompt.parseReviewOutput(JSON.stringify(duplicated)), /duplicate/i);

  const unknown = { ...validReview, checks: [...validReview.checks.slice(1), { criterion: 'Vibes', result: 'PASS', detail: '' }] };
  assert.throws(() => prompt.parseReviewOutput(JSON.stringify(unknown)), /criterion/);
});

test('parseReviewOutput rejects non-JSON text', () => {
  assert.throws(() => prompt.parseReviewOutput('not json'), /JSON/);
});

test('effectiveVerdict fails when blocking findings exist even if verdict says PASS', () => {
  const review = { ...validReview, verdict: 'PASS' };

  assert.strictEqual(prompt.effectiveVerdict(review), 'FAIL');
});

test('effectiveVerdict passes when only LOW/MEDIUM findings exist', () => {
  const review = {
    ...validReview,
    verdict: 'PASS',
    findings: [validReview.findings[1]],
  };

  assert.strictEqual(prompt.effectiveVerdict(review), 'PASS');
});

test('formatReport renders verdict, severity counts, and findings', () => {
  const report = prompt.formatReport(validReview, {
    model: 'gpt-6-astra', scopeLabel: 'uncommitted changes', files: ['a.js', 'b.js'],
  });

  assert.ok(report.includes('gpt-6-astra'));
  assert.ok(report.includes('FAIL'));
  assert.ok(report.includes('CRITICAL: 1'));
  assert.ok(report.includes('Hardcoded key'));
  assert.ok(report.includes('a.js:3'));
});

test('REVIEW_SCHEMA is a strict object schema with rubric criteria as an enum', () => {
  assert.strictEqual(prompt.REVIEW_SCHEMA.type, 'object');
  assert.deepStrictEqual(
    prompt.REVIEW_SCHEMA.properties.checks.items.properties.criterion.enum,
    prompt.RUBRIC.map(([name]) => name)
  );
  assert.strictEqual(prompt.REVIEW_SCHEMA.additionalProperties, false);
  assert.deepStrictEqual(prompt.REVIEW_SCHEMA.required, ['verdict', 'summary', 'checks', 'findings']);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
