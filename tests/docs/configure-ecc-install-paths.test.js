'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

const configureEccDocs = [
  'skills/configure-ecc/SKILL.md',
  'docs/zh-CN/skills/configure-ecc/SKILL.md',
  'docs/ja-JP/skills/configure-ecc/SKILL.md',
];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function readConfigureEccDoc(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

console.log('\n=== Testing configure-ecc install path guidance ===\n');

for (const relativePath of configureEccDocs) {
  test(`${relativePath} delegates to guided plugin setup`, () => {
    const content = readConfigureEccDoc(relativePath);

    assert.ok(content.includes('ecc setup'));
    assert.ok(content.includes('--mode claude-plugin'));
    assert.ok(content.includes('--scope user'));
    assert.ok(content.includes('--hooks standard'));
    assert.ok(!content.includes('rm -rf /tmp/everything-claude-code'));
    assert.ok(!content.includes('cp -R "$ECC_ROOT'));
  });
}

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
