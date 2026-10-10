'use strict';
/**
 * Tests for scripts/lib/gateguard-search-filters.js.
 *
 * Run with: node tests/lib/gateguard-search-filters.test.js
 */

const assert = require('assert');
const path = require('path');

const { grepToolFilters, shellSearchFilters, filtersAdmitTarget, includesAdmitTarget, powershellFilterArg } = require(
  path.join(__dirname, '..', '..', 'scripts', 'lib', 'gateguard-search-filters.js')
);

console.log('=== Testing gateguard-search-filters.js ===\n');

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

const ROOT = '/proj';
const ctxFor = rel => ({ targetKey: `${ROOT}/${rel}`, resolveDir: (...parts) => path.posix.resolve(ROOT, ...parts) });
const rgItem = (args, scope = '.') => ({ ...shellSearchFilters('rg', args), scopes: [[scope]], pathIncludes: true });
const admits = (item, rel) => includesAdmitTarget(item, ctxFor(rel));

test('Grep tool globs split into includes and exclusions', () => {
  const filters = grepToolFilters('*.py,!tests/**,src/*.js');
  assert.deepStrictEqual(filters.includes, ['*.py', 'src/*.js']);
  assert.deepStrictEqual(filters.exclusions, ['tests/**']);
});

test('rg -g keeps directory-qualified includes', () => {
  assert.deepStrictEqual(shellSearchFilters('rg', ['-g', 'src/*.js', 'foo', '.']).includes, ['src/*.js']);
});

test('a basename include matches the file name anywhere', () => {
  assert.strictEqual(admits(rgItem(['-g', '*.py']), 'a/b/widget.py'), true);
  assert.strictEqual(admits(rgItem(['-g', '*.md']), 'a/b/widget.py'), false);
});

test('a directory-qualified include is anchored at the search root', () => {
  const item = rgItem(['-g', 'src/*.js']);
  assert.strictEqual(admits(item, 'src/foo.js'), true);
  assert.strictEqual(admits(item, 'lib/foo.js'), false);
  assert.strictEqual(admits(item, 'vendor/src/foo.js'), false);
  assert.strictEqual(admits(item, 'src/deep/foo.js'), false);
});

test('a leading **/ lets a directory-qualified include start anywhere', () => {
  assert.strictEqual(admits(rgItem(['-g', '**/src/*.js']), 'vendor/src/foo.js'), true);
});

test('a directory-qualified include is relative to a narrower search path', () => {
  assert.strictEqual(admits(rgItem(['-g', 'deep/*.js'], 'src'), 'src/deep/foo.js'), true);
  assert.strictEqual(admits(rgItem(['-g', 'src/*.js'], 'src'), 'src/foo.js'), false);
});

test('tools that match names only never admit a directory-qualified include', () => {
  const item = { ...shellSearchFilters('grep', ['-r', '--include=src/*.py', 'widget', '.']), scopes: [['.']], pathIncludes: false };
  assert.strictEqual(admits(item, 'src/widget.py'), false);
});

test('an include past the length bound admits nothing', () => {
  assert.strictEqual(admits(rgItem(['-g', `${'a'.repeat(300)}*.py`]), 'src/widget.py'), false);
});

test('an exclusion that covers the target blocks it', () => {
  const item = rgItem(['-g', '!src/**']);
  assert.strictEqual(filtersAdmitTarget(item, ctxFor('src/widget.py'), null), false);
  assert.strictEqual(filtersAdmitTarget(item, ctxFor('lib/widget.py'), null), true);
});

test('PowerShell -Exclude binds from an unambiguous prefix', () => {
  const filter = powershellFilterArg('get-childitem', ['-Recurse', '-excl', 'a.py,', 'widget.py'], 1);
  assert.strictEqual(filter.name, 'exclude');
  assert.deepStrictEqual(filter.globs, ['a.py', 'widget.py']);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
