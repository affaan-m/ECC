'use strict';

const assert = require('assert');
const {
  normalizeGitHubGitOrigin,
} = require('../../scripts/lib/github-origin');

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

console.log('\nGitHub origin normalization');

if (test('accepts only authenticated or TLS GitHub origins', () => {
  assert.strictEqual(
    normalizeGitHubGitOrigin('https://github.com/affaan-m/ECC.git'),
    'affaan-m/ecc'
  );
  assert.strictEqual(
    normalizeGitHubGitOrigin('ssh://git@github.com/affaan-m/ECC/'),
    'affaan-m/ecc'
  );
  assert.strictEqual(
    normalizeGitHubGitOrigin('git@github.com:affaan-m/ECC.git'),
    'affaan-m/ecc'
  );
})) passed++; else failed++;

if (test('rejects shorthand and insecure or unrelated origins', () => {
  assert.strictEqual(normalizeGitHubGitOrigin('affaan-m/ECC'), null);
  assert.strictEqual(
    normalizeGitHubGitOrigin('http://github.com/affaan-m/ECC.git'),
    null
  );
  assert.strictEqual(
    normalizeGitHubGitOrigin('https://example.com/affaan-m/ECC.git'),
    null
  );
  assert.strictEqual(normalizeGitHubGitOrigin(null), null);
})) passed++; else failed++;

if (test('normalizes trailing separators before the optional git suffix', () => {
  for (const prefix of ['https://github.com/', 'ssh://git@github.com/', 'git@github.com:']) {
    for (const suffix of ['.git/', '.GIT///', '///']) {
      assert.strictEqual(normalizeGitHubGitOrigin(`${prefix}Affaan-M/ECC${suffix}`), 'affaan-m/ecc');
    }
  }
  assert.strictEqual(normalizeGitHubGitOrigin('https://github.com/affaan-m/ECC.git.git/'), 'affaan-m/ecc.git');
})) passed++; else failed++;

if (test('trailing separators do not admit insecure hosts or repository subpaths', () => {
  for (const origin of [
    'http://github.com/affaan-m/ECC.git/',
    'https://example.com/affaan-m/ECC.git/',
    'https://github.com.example.com/affaan-m/ECC.git/',
    'https://github.com/affaan-m/ECC/tree/main.git/',
  ]) {
    assert.strictEqual(normalizeGitHubGitOrigin(origin), null);
  }
})) passed++; else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
