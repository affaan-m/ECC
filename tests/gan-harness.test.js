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

if (process.platform === 'win32') {
  console.log('\n=== GAN harness helpers ===\n');
  console.log('  - skipped on Windows; GAN harness shell helpers are Unix-only');
  console.log('\nPassed: 0');
  console.log('Failed: 0');
  process.exit(0);
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runHarnessScript(script, args = []) {
  const bashExecutable = process.platform === 'win32' ? 'bash' : '/bin/bash';
  const result = spawnSync(bashExecutable, ['-c', script, 'gan-harness-test', ...args], {
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr || 'GAN harness script failed');
  return result.stdout.trim();
}

function extractScore(feedback) {
  const functionMatch = harnessSource.match(/extract_score\(\) \{[\s\S]*?\n\}/);
  assert.ok(functionMatch, 'expected scripts/gan-harness.sh to define extract_score');

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-gan-harness-'));
  const feedbackPath = path.join(temporaryDirectory, 'feedback.md');
  fs.writeFileSync(feedbackPath, feedback, 'utf8');

  try {
    return runHarnessScript(`${functionMatch[0]}\nextract_score "$1"`, [feedbackPath]);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

console.log('\n=== GAN harness helpers ===\n');

const results = Object.freeze([
  test('extract_score reads the documented TOTAL table format', () => {
    const feedback = '| **TOTAL** | | | **7.5** |\n';
    const result = extractScore(feedback);

    assert.strictEqual(result, '7.5');
  }),

  test('extract_score reads the compact TOTAL format', () => {
    const feedback = '**TOTAL** | **8.3**\n';
    const result = extractScore(feedback);

    assert.strictEqual(result, '8.3');
  }),

  test('extract_score reads a Verdict score', () => {
    const feedback = 'Verdict: PASS with score 9.1\n';
    const result = extractScore(feedback);

    assert.strictEqual(result, '9.1');
  }),

  test('extract_score returns the fallback when no supported score exists', () => {
    const feedback = 'Other score: 9.9\n';
    const result = extractScore(feedback);

    assert.strictEqual(result, '0.0');
  }),

  test('final score lookup is compatible with the macOS Bash 3.2 runtime', () => {
    const finalScoreBlock = harnessSource.match(
      /NUM_ITERATIONS=\$\{#SCORES\[@\]\}\nif \[ "\$NUM_ITERATIONS"[\s\S]*?\nfi/
    );
    const scoreOutput = harnessSource.match(/echo -e "\s{2}Score:[^\n]+/);

    assert.ok(finalScoreBlock, 'expected scripts/gan-harness.sh to select a final score');
    assert.ok(scoreOutput, 'expected scripts/gan-harness.sh to print the final score');
    assert.doesNotMatch(
      harnessSource,
      /\bSCORES\[\s*-\s*\d+\s*\]/,
      'negative array subscripts require Bash 4.3+'
    );

    const output = runHarnessScript(
      [`SCORES=("$@")`, 'CYAN=""', 'NC=""', finalScoreBlock[0], scoreOutput[0]].join('\n'),
      ['6.2', '8.7']
    );

    assert.match(output, /Score:\s+8\.7\s+\/\s+10\.0/);
  }),
]);

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
