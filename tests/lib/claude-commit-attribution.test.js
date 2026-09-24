'use strict';

const assert = require('assert');
const {
  hasExplicitCommitAttributionPreference,
  withCommitAttributionDisabled,
} = require('../../scripts/lib/claude-commit-attribution');

let passed = 0;
let failed = 0;

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

console.log('\nClaude commit attribution preference');

if (test('treats absent settings as unconfigured', () => {
  assert.strictEqual(hasExplicitCommitAttributionPreference(undefined), false);
  assert.strictEqual(hasExplicitCommitAttributionPreference(null), false);
  assert.strictEqual(hasExplicitCommitAttributionPreference({}), false);
  assert.strictEqual(hasExplicitCommitAttributionPreference({ theme: 'dark' }), false);
})) passed++; else failed++;

if (test('treats either includeCoAuthoredBy boolean as an explicit choice', () => {
  assert.strictEqual(hasExplicitCommitAttributionPreference({ includeCoAuthoredBy: true }), true);
  assert.strictEqual(hasExplicitCommitAttributionPreference({ includeCoAuthoredBy: false }), true);
})) passed++; else failed++;

if (test('treats a configured attribution as an explicit choice', () => {
  // `attribution` supersedes `includeCoAuthoredBy` in Claude Code, so a user who
  // set it has already decided and ECC must not write a key that loses to it.
  assert.strictEqual(hasExplicitCommitAttributionPreference({ attribution: { commit: '' } }), true);
  assert.strictEqual(hasExplicitCommitAttributionPreference({ attribution: { pr: '' } }), true);
  assert.strictEqual(
    hasExplicitCommitAttributionPreference({ attribution: { commit: 'Co-Authored-By: Someone <a@b.c>' } }),
    true
  );
})) passed++; else failed++;

if (test('ignores attribution values that carry no commit or pr choice', () => {
  assert.strictEqual(hasExplicitCommitAttributionPreference({ attribution: {} }), false);
  assert.strictEqual(hasExplicitCommitAttributionPreference({ attribution: null }), false);
  assert.strictEqual(hasExplicitCommitAttributionPreference({ attribution: [] }), false);
  assert.strictEqual(hasExplicitCommitAttributionPreference({ attribution: 'off' }), false);
  assert.strictEqual(hasExplicitCommitAttributionPreference({ attribution: { sessionUrl: false } }), false);
})) passed++; else failed++;

if (test('disables attribution while preserving unrelated settings', () => {
  assert.deepStrictEqual(
    withCommitAttributionDisabled({ theme: 'dark' }),
    { theme: 'dark', includeCoAuthoredBy: false }
  );
  assert.deepStrictEqual(withCommitAttributionDisabled({}), { includeCoAuthoredBy: false });
})) passed++; else failed++;

if (test('returns explicit settings unchanged', () => {
  const optIn = { includeCoAuthoredBy: true };
  assert.strictEqual(withCommitAttributionDisabled(optIn), optIn);

  const alreadyOff = { includeCoAuthoredBy: false };
  assert.strictEqual(withCommitAttributionDisabled(alreadyOff), alreadyOff);

  const customAttribution = { attribution: { commit: 'Signed-off-by: Someone <a@b.c>' } };
  assert.strictEqual(withCommitAttributionDisabled(customAttribution), customAttribution);
})) passed++; else failed++;

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
