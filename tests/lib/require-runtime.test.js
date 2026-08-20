/**
 * Tests for scripts/lib/require-runtime.js
 */

const assert = require('assert');
const Module = require('module');
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
  const original = Module._load;
  Module._load = function fakeLoad(request, parent, isMain) {
    if (request === 'ecc-test-broken-module') {
      throw new Error('boom');
    }
    return original.call(this, request, parent, isMain);
  };

  try {
    assert.throws(() => requireRuntime('ecc-test-broken-module'), /boom/);
  } finally {
    Module._load = original;
  }
  })) passed++; else failed++;

  if (test('requireRuntime wraps MODULE_NOT_FOUND with actionable text', () => {
    const original = Module._load;
    Module._load = function fakeLoad(request, parent, isMain) {
      if (request === 'ecc-test-missing-module') {
        const err = new Error("Cannot find module 'ecc-test-missing-module'");
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }
      return original.call(this, request, parent, isMain);
    };

    try {
      assert.throws(() => requireRuntime('ecc-test-missing-module'), error => {
        assert.strictEqual(error.code, 'ECC_RUNTIME_DEPENDENCY_MISSING');
        assert.ok(error.message.includes('ecc-test-missing-module'));
        assert.ok(error.message.includes('npm install'));
        return true;
      });
    } finally {
      Module._load = original;
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
