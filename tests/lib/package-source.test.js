'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  formatPackageSourcePath,
  isPackageSourcePath,
  parsePackageSourcePath,
  resolvePackageSourcePath,
} = require('../../scripts/lib/install/package-source');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function writePackage(packageRoot, name, files = {}) {
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
  for (const [relativePath, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(packageRoot, relativePath)), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, relativePath), content);
  }
}

console.log('\n=== Testing install/package-source.js ===\n');

test('formats package chains as the installed node_modules layout', () => {
  assert.strictEqual(formatPackageSourcePath(['ajv']), 'node_modules/ajv');
  assert.strictEqual(
    formatPackageSourcePath(['ajv', '@scope/dep'], 'dist\\index.js'),
    'node_modules/ajv/node_modules/@scope/dep/dist/index.js'
  );
});

test('recognizes only node_modules-rooted sources', () => {
  assert.strictEqual(isPackageSourcePath('node_modules/ajv/package.json'), true);
  assert.strictEqual(isPackageSourcePath('scripts/node_modules/x.js'), false);
  assert.strictEqual(isPackageSourcePath(undefined), false);
});

test('rejects traversal and malformed package names', () => {
  for (const source of [
    'node_modules/ajv/../../secret',
    'node_modules/../etc/passwd',
    'node_modules/ajv/./x',
    'node_modules/Bad Name/x',
    'node_modules/@scope',
    'node_modules',
  ]) {
    assert.throws(() => parsePackageSourcePath(source), /Invalid package source path/, source);
  }
});

test('resolves hoisted sibling packages through Node resolution', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-package-source-'));
  try {
    const repoRoot = path.join(root, 'node_modules', 'ecc-universal');
    writePackage(repoRoot, 'ecc-universal');
    writePackage(path.join(root, 'node_modules', 'dep-a'), 'dep-a', { 'lib/a.js': 'a' });
    writePackage(path.join(root, 'node_modules', 'dep-b'), 'dep-b', { 'b.js': 'b' });

    const resolved = resolvePackageSourcePath(repoRoot, 'node_modules/dep-a/node_modules/dep-b/b.js');
    assert.strictEqual(fs.realpathSync(resolved), fs.realpathSync(path.join(root, 'node_modules', 'dep-b', 'b.js')));
    assert.strictEqual(resolvePackageSourcePath(repoRoot, 'node_modules/ecc-missing-package/x.js'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
