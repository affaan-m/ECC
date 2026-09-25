'use strict';
const assert = require('assert');
const {
  startsAtSubstitution,
  statementBounds,
  endsStatement,
  mayGroupStatements,
} = require('../../scripts/lib/shell-statements');

console.log('=== Testing shell-statements.js ===\n');

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

console.log('statementBounds:');
test('a statement ends at ; or at a pipe', () => {
  assert.deepStrictEqual(statementBounds('sed -n p f; echo x', 0), { end: 10, opaque: false });
  assert.deepStrictEqual(statementBounds("sed '$d' f | cat", 0), { end: 11, opaque: false });
});
test('a statement inside a substitution ends where the substitution closes', () => {
  assert.deepStrictEqual(statementBounds('echo "$(sed e f)" x', 9), { end: 15, opaque: false });
});
test('a parameter expansion makes the words opaque, a quoted $ does not', () => {
  assert.deepStrictEqual(statementBounds('sed $OPTS f', 0), { end: 11, opaque: true });
  assert.strictEqual(statementBounds("sed '$d' f", 0).opaque, false);
});
test('a substitution is part of the statement, and makes it opaque', () => {
  assert.deepStrictEqual(statementBounds("sed $(printf -n) 'e x' f; echo", 0), { end: 24, opaque: true });
  assert.deepStrictEqual(statementBounds("sed `printf -n` 'e x' f", 0), { end: 23, opaque: true });
});

console.log('\nendsStatement:');
test('; && || and a background & end a statement', () => {
  assert.strictEqual(endsStatement('a; b', 1), true);
  assert.strictEqual(endsStatement('a && b', 2), true);
  assert.strictEqual(endsStatement('a || b', 2), true);
  assert.strictEqual(endsStatement('a & b', 2), true);
});
test('a pipe and the & of a redirection do not', () => {
  assert.strictEqual(endsStatement('a | b', 2), false);
  assert.strictEqual(endsStatement('a 2>&1', 4), false);
  assert.strictEqual(endsStatement('a &> f', 2), false);
  assert.strictEqual(endsStatement('a >&2', 3), false);
});

console.log('\nmayGroupStatements:');
test('a group, a subshell or a compound command can carry output on', () => {
  assert.strictEqual(mayGroupStatements('{ echo x; }', 10), true);
  assert.strictEqual(mayGroupStatements('( echo x )', 10), true);
  assert.strictEqual(mayGroupStatements('if true; then echo', 18), true);
});
test('quoted parentheses and a brace inside a word do not', () => {
  assert.strictEqual(mayGroupStatements("echo '(x)'", 10), false);
  assert.strictEqual(mayGroupStatements('ls /tmp/{a,b}', 13), false);
});

console.log('\nstartsAtSubstitution:');
test('a statement right inside $( ), backticks or <( ) starts at a substitution', () => {
  assert.strictEqual(startsAtSubstitution('echo $(sed e f)', 7), true);
  assert.strictEqual(startsAtSubstitution('echo `sed e f`', 6), true);
  assert.strictEqual(startsAtSubstitution('source <(echo x)', 9), true);
  assert.strictEqual(startsAtSubstitution('sed e f', 0), false);
});

console.log(`\nPassed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
