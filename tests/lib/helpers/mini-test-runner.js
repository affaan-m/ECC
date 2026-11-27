/**
 * Shared mini test harness for standalone tests/lib/*.test.js scripts.
 *
 * Centralizes test execution and console reporting so individual test
 * files don't duplicate the runner or log directly.
 */

'use strict';

function report(message) {
  console.log(message);
}

function test(name, fn) {
  try {
    fn();
    report(`  ✓ ${name}`);
    return true;
  } catch (err) {
    report(`  ✗ ${name}`);
    report(`    Error: ${err.message}`);
    return false;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    report(`  ✓ ${name}`);
    return true;
  } catch (err) {
    report(`  ✗ ${name}`);
    report(`    Error: ${err.message}`);
    return false;
  }
}

function banner(title) {
  report(`\n=== ${title} ===`);
}

function section(label) {
  report(`\n${label}`);
}

function summary(passed, failed) {
  report(`\n  Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

function fatal(message) {
  console.error(message);
  process.exit(1);
}

module.exports = { test, testAsync, banner, section, summary, fatal };
