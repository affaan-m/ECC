'use strict';
const assert = require('assert');
const { verify, CHECKS } = require('../../scripts/copilot-core-verify');
let passed = 0;
function test(name, action) { action(); passed++; console.log(`PASS ${name}`); }
test('green subprocesses remain fixture evidence with native acceptance pending', () => {
  const result = verify({ runner: () => ({ status: 0, stdout: 'success' }) });
  assert.equal(result.fixturesPassed, true); assert.equal(result.complete, false);
  assert.equal(result.checks.length, CHECKS.length);
  for (const phase of Object.values(result.phases)) assert.equal(phase.nativeAcceptance, 'pending');
});
test('nonzero exit, crash, timeout and unknown status cannot become passing checks', () => {
  for (const failure of [{ status: 1 }, { status: null }, { status: 0, signal: 'SIGTERM' }, { status: 0, error: { code: 'ETIMEDOUT' } }]) {
    assert.equal(verify({ runner: () => failure }).fixturesPassed, false);
  }
});
test('private subprocess output is represented only by its digest', () => {
  const result = verify({ runner: () => ({ status: 0, stdout: 'PRIVATE_BODY', stderr: 'password=SYNTHETIC_SENTINEL' }) });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_BODY|SYNTHETIC_SENTINEL/);
  assert.match(result.checks[0].outputSha256, /^[a-f0-9]{64}$/);
});
console.log(`Passed: ${passed}, Failed: 0`);
