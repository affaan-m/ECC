/**
 * Tests for scripts/lib/require-runtime.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  format,
  isMissing,
  missing,
  requireRuntime,
} = require('../../scripts/lib/require-runtime');

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing require-runtime.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('detects MODULE_NOT_FOUND errors', () => {
    assert.strictEqual(isMissing({ code: 'MODULE_NOT_FOUND' }), true);
    assert.strictEqual(isMissing({ code: 'ENOENT' }), false);
  })) passed++; else failed++;

  if (test('formats actionable missing dependency messages', () => {
    const message = format('ajv');
    assert.ok(message.includes("Missing runtime dependency 'ajv'"));
    assert.ok(message.includes('npm install'));
    assert.ok(message.includes('plugin/marketplace'));
  })) passed++; else failed++;

  if (test('creates tagged missing dependency errors', () => {
    const err = missing('sql.js');
    assert.strictEqual(err.code, 'ECC_RUNTIME_DEPENDENCY_MISSING');
    assert.strictEqual(err.packageName, 'sql.js');
    assert.ok(err.message.includes('sql.js'));
  })) passed++; else failed++;

  if (test('requireRuntime rethrows non-module errors', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'require-runtime-throws-'));
    const modulePath = path.join(temp, 'throws.js');
    fs.writeFileSync(modulePath, "throw new Error('boom');");
    try {
      assert.throws(() => requireRuntime(modulePath), /boom/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('requireRuntime wraps MODULE_NOT_FOUND with actionable text', () => {
    assert.throws(() => requireRuntime('ecc-test-missing-module-xyz'), error => {
      assert.strictEqual(error.code, 'ECC_RUNTIME_DEPENDENCY_MISSING');
      assert.ok(error.message.includes('ecc-test-missing-module-xyz'));
      assert.ok(error.message.includes('npm install'));
      return true;
    });
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
