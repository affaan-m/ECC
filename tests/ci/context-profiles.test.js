'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/ci/validate-context-profiles.js');

const tests = [
  ['validates every profile against every declared target in read-only mode', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--json'], {
      cwd: ROOT, encoding: 'utf8', timeout: 30_000,
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.status, 'success');
    assert.strictEqual(output.profileCount, 2);
    assert.ok(output.targetCount >= 15);
    assert.strictEqual(output.projectionCount, output.profileCount * output.targetCount);
    assert.ok(output.skillCount >= 286);
    assert.strictEqual(output.nativeCertification, 'unobserved');
  }],
  ['rejects unknown validator flags', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--write'], { encoding: 'utf8', timeout: 30_000 });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Unknown argument/);
  }],
  ['registers the schema gate in the normal test workflow', () => {
    const { scripts } = require('../../package.json');
    assert.strictEqual(scripts['context-profiles:check'], 'node scripts/ci/validate-context-profiles.js');
    assert.ok(scripts.test.includes('validate-context-profiles.js'));
  }],
];

let passed = 0;
for (const [name, test] of tests) {
  try { test(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); }
}
console.log(`Passed: ${passed}\nFailed: ${tests.length - passed}`);
process.exitCode = passed === tests.length ? 0 : 1;
