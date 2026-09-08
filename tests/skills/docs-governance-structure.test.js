#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SKILLS = ['change-impact', 'context-and-decisions', 'docs-governance'];
const REQUIRED_HEADINGS = [
  '## When to Activate',
  '## When to Use',
  '## How It Works',
  '## Examples',
];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    failed += 1;
  }
}

console.log('\n=== Documentation governance skill structure tests ===\n');

for (const skill of SKILLS) {
  test(`${skill} exposes the required canonical sections`, () => {
    const canonicalPath = path.join(ROOT, 'skills', skill, 'SKILL.md');
    const mirrorPath = path.join(ROOT, '.agents', 'skills', skill, 'SKILL.md');
    const canonical = fs.readFileSync(canonicalPath, 'utf8');
    const mirror = fs.readFileSync(mirrorPath, 'utf8');

    for (const heading of REQUIRED_HEADINGS) {
      assert.ok(canonical.includes(heading), `${canonicalPath} is missing ${heading}`);
      assert.ok(mirror.includes(heading), `${mirrorPath} is missing ${heading}`);
    }

    assert.strictEqual(mirror, canonical, `${mirrorPath} must match the canonical skill`);
  });
}

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}\n`);

process.exit(failed === 0 ? 0 : 1);
