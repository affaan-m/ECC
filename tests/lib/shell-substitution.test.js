'use strict';
const assert = require('assert');
const {
  extractCommandSubstitutions,
  extractSubshellGroups,
  extractBraceGroups,
} = require('../../scripts/lib/shell-substitution');

console.log('=== Testing shell-substitution.js ===\n');

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

// extractCommandSubstitutions
console.log('extractCommandSubstitutions:');
test('extracts a plain $(...) body', () => {
  assert.deepStrictEqual(extractCommandSubstitutions('echo $(whoami)'), ['whoami']);
});
test('extracts a backtick body', () => {
  assert.deepStrictEqual(extractCommandSubstitutions('echo `id`'), ['id']);
});
test('extracts nested $(...) recursively', () => {
  assert.deepStrictEqual(extractCommandSubstitutions('echo $(echo $(id))'), [
    'echo $(id)',
    'id',
  ]);
});
test('ignores substitutions inside single quotes', () => {
  assert.deepStrictEqual(extractCommandSubstitutions("echo '$(whoami)'"), []);
});
test('scans substitutions inside double quotes', () => {
  assert.deepStrictEqual(extractCommandSubstitutions('echo "$(whoami)"'), ['whoami']);
});
test('returns [] when there is no substitution', () => {
  assert.deepStrictEqual(extractCommandSubstitutions('echo hello'), []);
});
test('handles empty string', () => {
  assert.deepStrictEqual(extractCommandSubstitutions(''), []);
});
test('handles null/undefined input', () => {
  assert.deepStrictEqual(extractCommandSubstitutions(null), []);
  assert.deepStrictEqual(extractCommandSubstitutions(undefined), []);
});

// extractSubshellGroups
console.log('\nextractSubshellGroups:');
test('extracts a plain (...) subshell body', () => {
  assert.deepStrictEqual(extractSubshellGroups('(npm run dev)'), ['npm run dev']);
});
test('skips $(...) command substitutions', () => {
  assert.deepStrictEqual(extractSubshellGroups('echo $(whoami)'), []);
});
test('extracts nested (...) recursively', () => {
  assert.deepStrictEqual(extractSubshellGroups('(a && (b))'), ['a && (b)', 'b']);
});
test('ignores parens inside single quotes', () => {
  assert.deepStrictEqual(extractSubshellGroups("echo '(not a subshell)'"), []);
});
test('ignores parens inside double quotes', () => {
  assert.deepStrictEqual(extractSubshellGroups('echo "(not a subshell)"'), []);
});
test('returns [] when there is no subshell', () => {
  assert.deepStrictEqual(extractSubshellGroups('echo hello'), []);
});
test('handles null/undefined input', () => {
  assert.deepStrictEqual(extractSubshellGroups(null), []);
  assert.deepStrictEqual(extractSubshellGroups(undefined), []);
});

// extractBraceGroups
console.log('\nextractBraceGroups:');
test('extracts a { ...; } brace group body', () => {
  assert.deepStrictEqual(extractBraceGroups('{ npm run dev; }'), [' npm run dev; ']);
});
test('does not treat {token} (no space) as a group', () => {
  assert.deepStrictEqual(extractBraceGroups('{npm run dev}'), []);
});
test('skips (...) subshell spans', () => {
  assert.deepStrictEqual(extractBraceGroups('(npm run dev)'), []);
});
test('extracts nested brace groups recursively', () => {
  assert.deepStrictEqual(extractBraceGroups('{ a; { b; }; }'), [' a; { b; }; ', ' b; ']);
});
test('returns [] when there is no brace group', () => {
  assert.deepStrictEqual(extractBraceGroups('echo hello'), []);
});
test('handles null/undefined input', () => {
  assert.deepStrictEqual(extractBraceGroups(null), []);
  assert.deepStrictEqual(extractBraceGroups(undefined), []);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
