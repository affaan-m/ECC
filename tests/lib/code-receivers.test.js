'use strict';
const assert = require('assert');
const {
  commandBasename,
  receivesAsData,
  sedArguments,
  readsCodeFromStdin,
} = require('../../scripts/lib/code-receivers');

console.log('=== Testing code-receivers.js ===\n');

let passed = 0;
let failed = 0;

function test(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${desc}: ${e.message}`);
    failed++;
  }
}

test('commandBasename drops the path and .exe, and lowercases', () => {
  assert.deepStrictEqual(['/usr/bin/SED', 'C:\\bin\\node.EXE', 'git'].map(commandBasename), ['sed', 'node', 'git']);
});

console.log('\nreceivesAsData (a quoted argument after these words):');
test('an unrelated program receives it as data', () => {
  assert.strictEqual(receivesAsData(['printf']), true);
  assert.strictEqual(receivesAsData(['node', 'x.js']), true);
  assert.strictEqual(receivesAsData(['find', '.', '-exec', 'grep']), true);
});
test('a shell, a wrapper, an eval flag or awk runs it', () => {
  assert.strictEqual(receivesAsData(['sh', '-c']), false);
  assert.strictEqual(receivesAsData(['sudo']), false);
  assert.strictEqual(receivesAsData(['node', '-e']), false);
  assert.strictEqual(receivesAsData(['find', '.', '-exec', 'sh', '-c']), false);
  assert.strictEqual(receivesAsData(['awk']), false);
});
test('a program named by an expansion is unknown, so it may run it', () => {
  assert.strictEqual(receivesAsData(['$SHELL', '-c']), false);
});

console.log('\nsedArguments:');
test("sed's arguments, also behind a wrapper", () => {
  assert.deepStrictEqual(sedArguments(['sed', '-n', 'p']), ['-n', 'p']);
  assert.deepStrictEqual(sedArguments(['sudo', '-u', 'x', 'sed', 'e']), ['e']);
});
test('null when the statement does not run sed', () => {
  assert.strictEqual(sedArguments(['grep', 'sed']), null);
});

console.log('\nreadsCodeFromStdin:');
test('a shell, a runtime without a script, or sed that runs its input', () => {
  for (const words of [['sh'], ['node'], ['python3', '-'], ['sed', 'e'], ['$SHELL']]) {
    assert.strictEqual(readsCodeFromStdin(words), true, words.join(' '));
  }
});
test('a runtime with a script, sed that only edits, or cat', () => {
  for (const words of [['node', 'x.js'], ['sed', 's/x/y/'], ['cat']]) {
    assert.strictEqual(readsCodeFromStdin(words), false, words.join(' '));
  }
});

console.log(`\nPassed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
