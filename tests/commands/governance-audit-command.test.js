'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'commands', 'governance-audit.md'),
  'utf8'
);

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

console.log('\n=== Testing governance audit command boundaries ===\n');

test('confines path focuses to the repository', () => {
  assert.match(source, /resolve it from the repository root/i);
  assert.match(source, /reject absolute paths, `\.\.` traversal, nonexistent paths/i);
  assert.match(source, /symlink[^.]*escapes the root/i);
});

test('does not reinterpret an invalid path as a topic', () => {
  assert.match(source, /free-form topic is not a filesystem path/i);
  assert.match(source, /Report an invalid path instead of treating it as a topic/i);
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
