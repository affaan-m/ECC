'use strict';
/**
 * Tests for scripts/lib/gateguard-code-lexer.js.
 *
 * Run with: node tests/lib/gateguard-code-lexer.test.js
 */

const assert = require('assert');
const path = require('path');

const { isTrivialEdit, shCodeLines, psCodeLines, batchCodeLines, normalizeShellLine } = require(
  path.join(__dirname, '..', '..', 'scripts', 'lib', 'gateguard-code-lexer.js')
);

console.log('=== Testing gateguard-code-lexer.js ===\n');

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

const JS = { lineComment: '//', blockComment: true, quotes: '"\'', indentSensitive: false, flavor: 'js', forbiddenCode: '`/', jsx: true };
const PY = { lineComment: '#', blockComment: false, quotes: '"\'', indentSensitive: true, tripleQuotes: true, fStrings: true };

test('a comment-only change to C-family code is trivial', () => {
  assert.strictEqual(isTrivialEdit('a(); // x', 'a(); // y', JS), true);
});

test('comment markers inside a string are code', () => {
  assert.strictEqual(isTrivialEdit('const s = "a // b";', 'const s = "a // c";', JS), false);
  assert.strictEqual(isTrivialEdit("const s = 'x /* y */ z';", "const s = 'x /* q */ z';", JS), false);
});

test('an escaped quote does not end a string', () => {
  assert.strictEqual(isTrivialEdit('const s = "a\\" // b";', 'const s = "a\\" // c";', JS), false);
});

test('a long block comment with stars and slashes stays a comment', () => {
  const before = 'a();\n/* one * two / three\n * four ** five\n */\nb();';
  const after = 'a();\n/* one * two / 3\n * 4 ** five\n */\nb();';
  assert.strictEqual(isTrivialEdit(before, after, JS), true);
});

test('a line comment ending in CRLF keeps the next line as code', () => {
  assert.strictEqual(isTrivialEdit('a(); // x\r\nb();', 'a(); // y\r\nc();', JS), false);
  assert.strictEqual(isTrivialEdit('a(); // x\r\nb();', 'a(); // y\r\nb();', JS), true);
});

test('a code change is not trivial', () => {
  assert.strictEqual(isTrivialEdit('a();', 'b();', JS), false);
});

test('a directive comment counts as code', () => {
  assert.strictEqual(isTrivialEdit('// eslint-disable-next-line', '// note', JS), false);
});

test('an indentation change is not trivial in an indentation-sensitive language', () => {
  assert.strictEqual(isTrivialEdit('  x = 1', 'x = 1', PY), false);
});

test('a trailing comment change in Python is trivial', () => {
  assert.strictEqual(isTrivialEdit('x = 1  # a', 'x = 1  # b', PY), true);
});

test('shell code lines drop comments', () => {
  assert.deepStrictEqual(shCodeLines('echo hi # c\nls'), ['echo hi ', 'ls']);
});

test('shell heredocs are not lexed', () => {
  assert.strictEqual(shCodeLines('cat <<EOF\nx\nEOF'), null);
});

test('PowerShell code lines drop line and block comments', () => {
  assert.deepStrictEqual(psCodeLines('Get-X # c\n<# b #>\nY'), ['Get-X ', ' ', 'Y']);
});

test('batch code lines drop REM lines', () => {
  assert.deepStrictEqual(batchCodeLines('@echo off\nREM x\nset a=1'), ['@echo off', '', 'set a=1']);
});

test('a batch line continuation is not lexed', () => {
  assert.strictEqual(batchCodeLines('echo ^'), null);
});

test('shell line normalization collapses blanks but keeps escaped ones', () => {
  assert.strictEqual(normalizeShellLine('a   b\\ c', '\\'), 'a b\\ c');
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
