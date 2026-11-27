#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const reviewerPath = path.join(repoRoot, 'agents', 'code-reviewer.md');

const requiredHeadings = [
  '## Confidence-Based Filtering',
  '### Pre-Report Gate',
  '### HIGH / CRITICAL Require Proof',
  '### It Is Acceptable And Expected To Return Zero Findings',
  '## Common False Positives - Skip These',
];

const requiredPatterns = [
  /Can I cite the exact line/i,
  /concrete failure mode/i,
  /Have I read the surrounding context/i,
  /Severity inflation/i,
  /exact snippet and line number/i,
  /specific failure scenario/i,
  /demote to MEDIUM or drop/i,
  /clean review is a valid review/i,
  /Manufactured findings/i,
  /Common False Positives/i,
  /Consider adding error handling/i,
  /Missing input validation/i,
  /Magic number/i,
  /Would a senior engineer on this\s+team actually change this in review/i,
  /Do not withhold approval to appear rigorous/i,
];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function readReviewer() {
  return fs.readFileSync(reviewerPath, 'utf8');
}

console.log('\n=== Testing code-reviewer false-positive guardrails ===\n');

for (const heading of requiredHeadings) {
  test(`code-reviewer.md contains heading: ${heading}`, () => {
    const source = readReviewer();
    assert.ok(source.includes(heading), `code-reviewer.md missing required heading "${heading}"`);
  });
}

for (const pattern of requiredPatterns) {
  test(`code-reviewer.md matches ${pattern}`, () => {
    const source = readReviewer();
    assert.ok(pattern.test(source), `code-reviewer.md missing required pattern ${pattern}`);
  });
}

test('code-reviewer.md retains the >80% confidence threshold', () => {
  const source = readReviewer();
  assert.ok(/>\s*80%\s*confident/i.test(source), 'code-reviewer.md missing >80% confidence threshold');
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
