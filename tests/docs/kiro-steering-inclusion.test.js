/**
 * Regression coverage for Kiro steering file inclusion modes.
 *
 * Kiro only loads a steering file in every conversation with `inclusion: always`;
 * `auto` loads it only when the request matches its description.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const KIRO_DIR = path.join(__dirname, '..', '..', '.kiro');
const STEERING_DIR = path.join(KIRO_DIR, 'steering');
const README = path.join(KIRO_DIR, 'README.md');

const ALWAYS_ON = [
  'coding-style.md',
  'security.md',
  'testing.md',
  'development-workflow.md',
  'git-workflow.md',
  'patterns.md',
  'performance.md',
  'lessons-learned.md',
];

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

function readFrontmatter(file) {
  const content = fs.readFileSync(path.join(STEERING_DIR, file), 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, `${file} should start with YAML frontmatter`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^(\w+):\s*(.*)$/);
    if (field) fields[field[1]] = field[2].trim();
  }
  return fields;
}

function readReadmeInclusions() {
  const readme = fs.readFileSync(README, 'utf8');
  const inclusions = {};
  for (const row of readme.matchAll(/^\| `([\w-]+\.md)` \| (always|auto|manual|fileMatch)\b/gm)) {
    inclusions[row[1]] = row[2];
  }
  return inclusions;
}

function runTests() {
  console.log('\n=== Testing Kiro steering inclusion modes ===\n');

  let passed = 0;
  let failed = 0;

  const steeringFiles = fs.readdirSync(STEERING_DIR).filter(file => file.endsWith('.md'));

  if (test('core steering files use always inclusion', () => {
    for (const file of ALWAYS_ON) {
      assert.strictEqual(
        readFrontmatter(file).inclusion,
        'always',
        `${file} should use inclusion: always so it loads in every conversation`
      );
    }
  })) passed++; else failed++;

  if (test('README steering table matches each file frontmatter', () => {
    const documented = readReadmeInclusions();
    for (const file of steeringFiles) {
      assert.ok(documented[file], `${file} should be listed in the .kiro/README.md steering table`);
      assert.strictEqual(
        readFrontmatter(file).inclusion,
        documented[file],
        `${file} frontmatter inclusion should match the README table`
      );
    }
  })) passed++; else failed++;

  if (test('steering files declare the fields their inclusion mode requires', () => {
    for (const file of steeringFiles) {
      const fields = readFrontmatter(file);
      if (fields.inclusion === 'auto') {
        assert.ok(fields.name && fields.description, `${file} uses auto inclusion and needs name and description`);
      }
      if (fields.inclusion === 'fileMatch') {
        assert.ok(fields.fileMatchPattern, `${file} uses fileMatch inclusion and needs fileMatchPattern`);
      }
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
