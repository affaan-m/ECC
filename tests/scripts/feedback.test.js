/**
 * Tests for scripts/feedback.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'feedback.js');

function run(args = []) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
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

function main() {
  console.log('\n=== Testing feedback.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('prints low-friction feedback routes without collecting diagnostics', () => {
    const result = run();
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /Quick feedback/);
    assert.match(result.stdout, /install-problem\.yml/);
    assert.match(result.stdout, /quick-feedback\.yml/);
    assert.match(result.stdout, /feature-request\.yml/);
    assert.match(result.stdout, /public GitHub issue/);
    assert.match(result.stdout, /does not upload diagnostics/i);
  })) passed++; else failed++;

  if (test('emits machine-readable feedback routes', () => {
    const result = run(['--json']);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.schemaVersion, 'ecc.feedback.v1');
    assert.strictEqual(payload.privacy, 'public-github');
    assert.match(payload.routes.problem, /install-problem\.yml/);
    assert.match(payload.routes.feedback, /quick-feedback\.yml/);
    assert.match(payload.routes.feature, /feature-request\.yml/);
    assert.strictEqual(payload.diagnosticsUploaded, false);
  })) passed++; else failed++;

  if (test('documents both help flags and returns after printing help', () => {
    for (const flag of ['--help', '-h']) {
      const result = run([flag]);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /\[--json\] \[--help\|-h\]/);
      assert.doesNotMatch(result.stdout, /^ECC feedback$/m);
    }
  })) passed++; else failed++;

  if (test('lets stdout and stderr flush through natural process exit', () => {
    const source = fs.readFileSync(SCRIPT, 'utf8');
    assert.doesNotMatch(source, /process\.exit\(/);
    assert.match(source, /process\.exitCode = 1/);
  })) passed++; else failed++;

  if (test('rejects unknown arguments', () => {
    const result = run(['--send-diagnostics']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Unknown argument/);
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
