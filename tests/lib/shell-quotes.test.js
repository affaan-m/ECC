'use strict';
const assert = require('assert');
const { quotedRegions, quotedRegionAt, commandStatements } = require('../../scripts/lib/shell-quotes');

console.log('=== Testing shell-quotes.js ===\n');

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

test('each quoted region, with the argv0 of its statement', () => {
  assert.deepStrictEqual(quotedRegions("echo 'a b' \"c\""), [
    { start: 5, quote: "'", argv0: 'echo', argv0Start: 0, substitution: false, end: 9 },
    { start: 11, quote: '"', argv0: 'echo', argv0Start: 0, substitution: false, end: 13 },
  ]);
});
test('a substitution splits a double-quoted string, and both halves say so', () => {
  const regions = quotedRegions('echo "x $(printf y) z"');
  assert.deepStrictEqual(
    regions.map(({ start, end, substitution }) => ({ start, end, substitution })),
    [
      { start: 5, end: 8, substitution: true },
      { start: 18, end: 21, substitution: true },
    ]
  );
});
test('quotedRegionAt finds the region around an index, or null', () => {
  const input = "echo 'a b' \"c\"";
  assert.strictEqual(quotedRegionAt(input, 7).start, 5);
  assert.strictEqual(quotedRegionAt(input, 2), null);
});
test('commandStatements lists the argv0 of every statement', () => {
  assert.deepStrictEqual(commandStatements('FOO=1 sed e f | if grep -q x f; then :; fi'), [
    { argv0: 'sed', argv0Start: 6 },
    { argv0: 'grep', argv0Start: 19 },
    { argv0: ':', argv0Start: 37 },
  ]);
});
test('commandStatements includes a statement inside a substitution', () => {
  assert.deepStrictEqual(
    commandStatements('echo "$(sed e f)"').map(({ argv0 }) => argv0),
    ['echo', 'sed']
  );
});

console.log(`\nPassed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
