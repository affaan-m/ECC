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

const admitted = (item, rel) => filtersAdmitTarget(item, ctxFor(rel), null) && admits(item, rel);

test('rg -t/--type selects ripgrep type globs instead of being skipped', () => {
  for (const args of [['-t', 'py'], ['-tpy'], ['--type', 'py'], ['--type=py'], ['-it', 'py']]) {
    const item = rgItem([...args, 'tokenizer', 'src']);
    assert.strictEqual(admitted(item, 'src/tokenizer.js'), false, args.join(' '));
    assert.strictEqual(admitted(item, 'src/tokenizer.pyi'), true, args.join(' '));
  }
  assert.strictEqual(admitted(rgItem(['-t', 'js', 'x']), 'src/tokenizer.mjs'), true);
  assert.strictEqual(admitted(rgItem(['-t', 'py', '-t', 'js', 'x']), 'src/tokenizer.js'), true, 'types are alternatives');
});

test('rg -T/--type-not excludes the type globs', () => {
  for (const args of [['-T', 'js'], ['-Tjs'], ['--type-not', 'js'], ['--type-not=js']]) {
    assert.strictEqual(admitted(rgItem([...args, 'x']), 'src/tokenizer.js'), false, args.join(' '));
    assert.strictEqual(admitted(rgItem([...args, 'x']), 'src/tokenizer.py'), true, args.join(' '));
  }
});

test('rg type selection preserves case in literals and bracket classes', () => {
  const cpp = rgItem(['-t', 'cpp', 'tokenizer', 'src']);
  assert.strictEqual(admitted(cpp, 'src/tokenizer.c'), false);
  assert.strictEqual(admitted(cpp, 'src/cpp.C'), true);
  assert.strictEqual(admitted(cpp, 'src/tokenizer.h'), true);
  assert.strictEqual(admitted(cpp, 'src/tokenizer.H'), true);
  assert.strictEqual(admitted(cpp, 'src/tokenizer.CC'), false);
  assert.strictEqual(admitted(rgItem(['-t', 'js']), 'src/tokenizer.JS'), false);
  assert.strictEqual(admitted(rgItem(['-T', 'cpp']), 'src/tokenizer.c'), true);
  assert.strictEqual(admitted(rgItem(['-T', 'cpp']), 'src/tokenizer.C'), false);
  const grepCpp = { ...grepToolFilters(undefined, 'cpp'), scopes: [['.']], pathIncludes: true };
  assert.strictEqual(admitted(grepCpp, 'src/tokenizer.c'), false);
  assert.strictEqual(admitted(grepCpp, 'src/cpp.C'), true);
});

test('rg negative types match only the file basename; path globs still exclude ancestors', () => {
  assert.strictEqual(admitted(rgItem(['-T', 'js']), 'src.js/tokenizer.py'), true);
  assert.strictEqual(admitted(rgItem(['--type-not=cpp']), 'vendor.C/tokenizer.py'), true);
  assert.strictEqual(admitted(rgItem(['-T', 'js']), 'src.py/tokenizer.js'), false);
  assert.strictEqual(admitted(rgItem(['-T', 'js', '-g', '!vendor/**']), 'vendor/src.js/tokenizer.py'), false);
  assert.strictEqual(admitted(rgItem(['-g', '!*.js']), 'src.js/tokenizer.py'), false);
  assert.strictEqual(admitted(rgItem(['-T', 'js', '-g', '*.js']), 'src.js/tokenizer.js'), true);
});

test('case-folded Windows contexts cannot prove type coverage or bypass a possible exclusion', () => {
  const ctx = file => ({ targetKey: `c:/proj/${file}`, resolveDir: () => 'c:/proj' });
  assert.strictEqual(includesAdmitTarget(rgItem(['-t', 'js']), ctx('src/tokenizer.js')), false);
  assert.strictEqual(filtersAdmitTarget(rgItem(['-T', 'cpp']), ctx('src/tokenizer.c'), null), false);
  assert.strictEqual(filtersAdmitTarget(rgItem(['-T', 'js']), ctx('src.js/tokenizer.py'), null), true);
});

test('type filters keep the existing enumerable fields and string-array evidence shape', () => {
  for (const item of [shellSearchFilters('rg', ['-t', 'cpp']), shellSearchFilters('rg', ['-T', 'cpp', '-g', '!vendor/**'])]) {
    assert.deepStrictEqual(Object.keys(item).sort(), ['dropped', 'exclusions', 'includes', 'opaque']);
    assert.ok(item.includes.every(glob => typeof glob === 'string'));
    assert.ok(item.exclusions.every(glob => typeof glob === 'string'));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(item.includes)), [...item.includes]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(item.exclusions)), [...item.exclusions]);
  }
});

test('explicit rg globs take precedence over type alternatives in either flag order', () => {
  for (const args of [['-t', 'js', '-g', '*.py'], ['-g', '*.py', '--type=js']]) {
    const item = rgItem([...args, 'tokenizer', 'src']);
    assert.strictEqual(admitted(item, 'src/tokenizer.js'), false, args.join(' '));
    assert.strictEqual(admitted(item, 'src/tokenizer.py'), true, args.join(' '));
  }
  assert.strictEqual(admitted(rgItem(['-t', 'py', '-g', '*.js']), 'src/tokenizer.js'), true);
  assert.strictEqual(admitted(rgItem(['-T', 'js', '-g', '*.js']), 'src/tokenizer.js'), true);
  assert.strictEqual(admitted(rgItem(['-t', 'js', '-g', '!*.js']), 'src/tokenizer.js'), false);
});

test('Grep tool explicit globs do not gain an alternative from its type', () => {
  const item = { ...grepToolFilters('*.py', 'js'), scopes: [['.']], pathIncludes: true };
  assert.strictEqual(admitted(item, 'src/tokenizer.js'), false);
  assert.strictEqual(admitted(item, 'src/tokenizer.py'), true);
});

test('unknown or redefined rg types are unreadable filters', () => {
  for (const args of [['-t', 'nosuchtype'], ['-T', 'nosuchtype'], ['--type-add', 'web:*.js', '-t', 'web'], ['--type-clear', 'js']]) {
    assert.strictEqual(admitted(rgItem([...args, 'x']), 'src/tokenizer.js'), false, args.join(' '));
  }
});

test('fd -e/--extension is an include', () => {
  const fdItem = args => ({ ...shellSearchFilters('fd', args), scopes: [['.']], pathIncludes: false });
  for (const args of [['-e', 'py'], ['-epy'], ['--extension', 'py'], ['--extension=.py']]) {
    assert.strictEqual(admitted(fdItem([...args, 'tokenizer', 'src']), 'src/tokenizer.js'), false, args.join(' '));
    assert.strictEqual(admitted(fdItem([...args, 'tokenizer', 'src']), 'src/tokenizer.py'), true, args.join(' '));
  }
});

test('the Grep tool type parameter is an include, and an unknown type is unreadable', () => {
  const grepItem = (glob, type) => ({ ...grepToolFilters(glob, type), scopes: [['.']], pathIncludes: true });
  assert.strictEqual(admitted(grepItem(undefined, 'py'), 'src/tokenizer.js'), false);
  assert.strictEqual(admitted(grepItem(undefined, 'py'), 'src/tokenizer.py'), true);
  assert.strictEqual(admitted(grepItem(undefined, 'nosuchtype'), 'src/tokenizer.js'), false);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
