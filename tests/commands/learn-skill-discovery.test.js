'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const commandNames = ['learn', 'learn-eval', 'skill-create'];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function readCommand(name) {
  return fs.readFileSync(path.join(repoRoot, 'commands', `${name}.md`), 'utf8');
}

console.log('\n=== Testing generated skill discoverability ===\n');

for (const name of commandNames) {
  test(`/${name} generates a directory-based SKILL.md`, () => {
    const source = readCommand(name);

    assert.match(
      source,
      /<[^>]*name[^>]*>\/SKILL\.md|\{[^}]*name[^}]*\}[^\n`]*\/SKILL\.md/,
      `Expected /${name} to specify a <name>/SKILL.md output path`,
    );
    assert.doesNotMatch(
      source,
      /skills\/learned\/\[pattern-name\]\.md/,
      `Expected /${name} not to generate an inert flat skill file`,
    );
  });

  test(`/${name} uses trigger-first generated skill metadata`, () => {
    const source = readCommand(name);

    assert.match(
      source,
      /description:\s*["']?Use when\b/,
      `Expected /${name} to generate a description beginning with "Use when"`,
    );
  });

  test(`/${name} verifies the generated skill is discoverable`, () => {
    const source = readCommand(name);

    assert.match(
      source,
      /[Vv]erify discoverability|[Vv]erification/,
      `Expected /${name} to include an explicit discoverability check`,
    );
    assert.match(source, /name:/, `Expected /${name} to verify skill frontmatter`);
    assert.match(source, /description:/, `Expected /${name} to verify skill frontmatter`);
  });
}

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
