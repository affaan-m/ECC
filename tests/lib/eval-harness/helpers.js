'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

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

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ecc-eval-harness-${prefix}-`));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function finish(title) {
  console.log(`\n${title}: Passed ${passed}, Failed ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

const fixedClock = () => new Date('2026-09-02T00:00:00.000Z');

module.exports = { test, tempDir, cleanup, finish, fixedClock };
