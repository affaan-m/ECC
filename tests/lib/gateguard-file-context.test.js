'use strict';
/**
 * Tests for scripts/lib/gateguard-file-context.js.
 *
 * Run with: node tests/lib/gateguard-file-context.test.js
 */

const assert = require('assert');
const path = require('path');

const { shCodeLines, normalizeShellLine } = require(path.join(__dirname, '..', '..', 'scripts', 'lib', 'gateguard-code-lexer.js'));
const { trivialInFile, cFamilyStartsFresh, pythonStartsFresh, shStartsFresh, lineStartOf, lineEndAt } = require(
  path.join(__dirname, '..', '..', 'scripts', 'lib', 'gateguard-file-context.js')
);

console.log('=== Testing gateguard-file-context.js ===\n');

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

const JS = { lineComment: '//', blockComment: true, quotes: '"\'', indentSensitive: false, flavor: 'js', forbiddenCode: '`/', jsx: true, startsFresh: cFamilyStartsFresh };
const PY = { lineComment: '#', blockComment: false, quotes: '"\'', indentSensitive: true, tripleQuotes: true, fStrings: true, startsFresh: pythonStartsFresh };
const SH = { lexer: shCodeLines, normalize: line => normalizeShellLine(line, '\\'), startsFresh: shStartsFresh };

test('a comment edit between statements is trivial in its file', () => {
  assert.strictEqual(trivialInFile([['// old', '// new']], 'const a = 1;\n// old\nconst b = 2;\n', JS), true);
});

test('comment-looking text inside a template literal is code', () => {
  assert.strictEqual(trivialInFile([['// old', '// new']], 'const s = `\n// old\n`;\n', JS), false);
});

test('comment-looking text inside a Python triple-quoted string is code', () => {
  assert.strictEqual(trivialInFile([['# old', '# new']], 'x = """\n# old\n"""\n', PY), false);
});

test('comment-looking text inside a shell heredoc is code', () => {
  assert.strictEqual(trivialInFile([['# a', '# b']], 'cat <<EOF\n# a\nEOF\n', SH), false);
});

test('a replacement with a $ pattern is never trivial', () => {
  assert.strictEqual(trivialInFile([['// a', '// $& b']], '// a\n', JS), false);
});

test('a file prefix ends fresh only outside strings and comments', () => {
  assert.strictEqual(cFamilyStartsFresh('const a = 1;\n', JS), true);
  assert.strictEqual(cFamilyStartsFresh('const s = "abc', JS), false);
  assert.strictEqual(pythonStartsFresh('x = 1\n'), true);
  assert.strictEqual(pythonStartsFresh('x = """\n'), false);
});

test('line bounds are found around an offset', () => {
  assert.strictEqual(lineStartOf('ab\ncd', 4), 3);
  assert.strictEqual(lineEndAt('ab\ncd', 0), 2);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
