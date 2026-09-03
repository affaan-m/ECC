'use strict';

const assert = require('assert');

const {
  validateInteractiveJsonOptions,
} = require('../../scripts/setup');

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

console.log('\n=== ECC setup option contract tests ===\n');

test('rejects interactive JSON when wizard choices are missing', () => {
  assert.throws(
    () => validateInteractiveJsonOptions({
      hooks: undefined,
      json: true,
      mode: 'claude-plugin',
      scope: undefined,
    }, true),
    /json.*scope.*hooks/i
  );
});

test('allows fully specified JSON and ordinary interactive wizard use', () => {
  assert.doesNotThrow(() => validateInteractiveJsonOptions({
    dryRun: true,
    hooks: 'strict',
    json: true,
    mode: 'claude-plugin',
    scope: 'project',
  }, true));
  assert.doesNotThrow(() => validateInteractiveJsonOptions({
    hooks: undefined,
    json: false,
    mode: undefined,
    scope: undefined,
  }, true));
  assert.throws(() => validateInteractiveJsonOptions({
    dryRun: false,
    hooks: 'strict',
    json: true,
    mode: 'claude-plugin',
    scope: 'project',
    yes: false,
  }, true), /json.*yes/i);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
