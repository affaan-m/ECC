/**
 * Regression tests for the standalone GAN harness helpers.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const harnessPath = path.join(repoRoot, 'scripts', 'gan-harness.sh');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function extractScore(feedback) {
  const functionMatch = harnessSource.match(/extract_score\(\) \{[\s\S]*?\n\}/);
  assert.ok(functionMatch, 'expected scripts/gan-harness.sh to define extract_score');

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-gan-harness-'));
  const feedbackPath = path.join(temporaryDirectory, 'feedback.md');
  fs.writeFileSync(feedbackPath, feedback, 'utf8');

  try {
    const result = spawnSync(
      '/bin/bash',
      ['-c', `${functionMatch[0]}\nextract_score "$1"`, 'gan-harness-score-test', feedbackPath],
      { encoding: 'utf8' }
    );
    assert.strictEqual(result.status, 0, result.stderr || 'extract_score failed');
    return result.stdout.trim();
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

console.log('\n=== GAN harness helpers ===\n');

test('extract_score reads the documented TOTAL table format', () => {
  assert.strictEqual(extractScore('| **TOTAL** | | | **7.5** |\n'), '7.5');
});

test('extract_score reads the compact TOTAL format', () => {
  assert.strictEqual(extractScore('**TOTAL** | **8.3**\n'), '8.3');
});

test('extract_score reads a Verdict score', () => {
  assert.strictEqual(extractScore('Verdict: PASS with score 9.1\n'), '9.1');
});

test('final score lookup is compatible with the macOS Bash 3.2 runtime', () => {
  assert.ok(!harnessSource.includes('SCORES[-1]'), 'negative array subscripts require Bash 4.3+');
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
