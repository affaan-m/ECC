'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let passed = 0;
let failed = 0;
if (process.platform === 'win32') {
  console.log('Skipping non-Windows Python availability control.');
} else {
  const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-missing-python-'));
  try {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'observe-secret-redaction.test.js')], {
      env: { ...process.env, PATH: emptyPath }, encoding: 'utf8', timeout: 15000
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /FAIL python3 is required/);
    assert.match(result.stdout, /Passed: 0\nFailed: 1/);
    assert.doesNotMatch(result.stdout, /Skipping shell fixtures/);
    console.log('PASS missing Python fails the actual non-Windows redaction gate');
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${error.message}`);
    failed += 1;
  } finally {
    fs.rmSync(emptyPath, { recursive: true, force: true });
  }
}
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
