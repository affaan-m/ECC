'use strict';

const assert = require('assert');
const { showRecoveryHints } = require('../../../scripts/lib/hooks/recovery-hints');

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

let passed = 0;
let failed = 0;

if (
  test('truthy values enable hints, trimming case-insensitive whitespace', () => {
    for (const value of ['1', 'true', 'on', 'enabled', 'enable', 'yes', ' TRUE ', ' enable ']) {
      assert.strictEqual(showRecoveryHints(value), true, `expected truthy: ${JSON.stringify(value)}`);
    }
  })
)
  passed++;
else failed++;

if (
  test('unset, empty and non-listed values keep hints hidden', () => {
    for (const value of ['', '0', 'false', 'off', 'disabled', 'disable', 'no', 'random']) {
      assert.strictEqual(showRecoveryHints(value), false, `expected falsy: ${JSON.stringify(value)}`);
    }
  })
)
  passed++;
else failed++;

if (
  test('the default argument reads ECC_SHOW_RECOVERY_HINTS', () => {
    const saved = process.env.ECC_SHOW_RECOVERY_HINTS;
    try {
      process.env.ECC_SHOW_RECOVERY_HINTS = ' enable ';
      assert.strictEqual(showRecoveryHints(), true);
      process.env.ECC_SHOW_RECOVERY_HINTS = '';
      assert.strictEqual(showRecoveryHints(), false);
      delete process.env.ECC_SHOW_RECOVERY_HINTS;
      assert.strictEqual(showRecoveryHints(), false);
    } finally {
      if (saved === undefined) delete process.env.ECC_SHOW_RECOVERY_HINTS;
      else process.env.ECC_SHOW_RECOVERY_HINTS = saved;
    }
  })
)
  passed++;
else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
