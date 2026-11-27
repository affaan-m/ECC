'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const commandsDir = path.join(repoRoot, 'commands');

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

function getCommandFiles() {
  return fs.readdirSync(commandsDir)
    .filter(fileName => fileName.endsWith('.md'))
    .sort();
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match ? match[1] : null;
}

console.log('\n=== Testing command frontmatter metadata ===\n');

test('frontmatter parser accepts LF and CRLF line endings', () => {
  assert.strictEqual(parseFrontmatter('---\ndescription: ok\n---\n# Title'), 'description: ok');
  assert.strictEqual(parseFrontmatter('---\r\ndescription: ok\r\n---\r\n# Title'), 'description: ok');
});

for (const fileName of getCommandFiles()) {
  test(`${fileName} declares command metadata frontmatter`, () => {
    const content = fs.readFileSync(path.join(commandsDir, fileName), 'utf8');
    const frontmatter = parseFrontmatter(content);

    assert.ok(frontmatter, 'Expected command file to start with YAML frontmatter');
    assert.ok(
      /^description:\s*\S/m.test(frontmatter),
      'Expected command frontmatter to include a non-empty description'
    );
  });
}

test('argument-hint is never an unquoted YAML flow sequence', () => {
  const offenders = [];

  for (const fileName of getCommandFiles()) {
    const content = fs.readFileSync(path.join(commandsDir, fileName), 'utf8');
    const frontmatter = parseFrontmatter(content);
    if (!frontmatter) {
      continue;
    }

    for (const line of frontmatter.split(/\r?\n/)) {
      const match = line.match(/^argument-hint:\s*(.*)$/);
      if (!match) {
        continue;
      }

      const value = match[1].trim();
      // An unquoted leading '[' makes YAML parse the value as a flow sequence.
      // Harnesses that type-check argument-hint as a string then reject the whole
      // file, and the slash command disappears from the catalog without a
      // user-visible error. Other keys are deliberately not covered: allowed-tools
      // is a legitimate list.
      if (/^[[{]/.test(value) && !/^["']/.test(value)) {
        offenders.push(`${fileName}: ${line.trim()}`);
      }
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    'argument-hint must be quoted when it starts with [ or { so YAML parses it as a string'
  );
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
