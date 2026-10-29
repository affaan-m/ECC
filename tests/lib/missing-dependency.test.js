/**
 * Tests for scripts/lib/missing-dependency.js
 */

const assert = require('assert');

const { describeMissingDependencyError } = require('../../scripts/lib/missing-dependency');

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

function moduleNotFoundError(moduleName, requireStack) {
  const error = new Error(
    `Cannot find module '${moduleName}'\nRequire stack:\n${requireStack.map(entry => `- ${entry}`).join('\n')}`
  );
  error.code = 'MODULE_NOT_FOUND';
  return error;
}

function runTests() {
  console.log('\n=== Testing missing-dependency.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('describes a missing production dependency with an install command', () => {
    const error = moduleNotFoundError('ajv', [
      'scripts/lib/install/config.js',
      'scripts/install-plan.js',
    ]);
    const message = describeMissingDependencyError(error);
    assert.ok(message.includes("'ajv'"));
    assert.ok(message.includes('npm install'));
    assert.ok(message.includes('ajv@8.20.0'));
  })) passed++; else failed++;

  if (test('recognizes every declared production dependency', () => {
    for (const moduleName of ['ajv', 'sql.js', 'js-yaml', '@iarna/toml']) {
      const error = moduleNotFoundError(moduleName, ['some/file.js']);
      assert.ok(describeMissingDependencyError(error), `expected a message for ${moduleName}`);
    }
  })) passed++; else failed++;

  if (test('returns null for an unrelated MODULE_NOT_FOUND error', () => {
    const error = moduleNotFoundError('./lib/some-local-file', ['scripts/foo.js']);
    assert.strictEqual(describeMissingDependencyError(error), null);
  })) passed++; else failed++;

  if (test('returns null for a non-MODULE_NOT_FOUND error', () => {
    assert.strictEqual(describeMissingDependencyError(new Error('boom')), null);
  })) passed++; else failed++;

  if (test('returns null for a falsy error', () => {
    assert.strictEqual(describeMissingDependencyError(null), null);
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
