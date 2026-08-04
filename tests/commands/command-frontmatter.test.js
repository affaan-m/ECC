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

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
