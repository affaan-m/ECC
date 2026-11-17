const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectProjectType } = require('../../scripts/lib/project-detect');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-project-scan-'));
  try {
    fn(root);
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}: ${error.message}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function observeDirectoryReads(root, fn, reject = false) {
  const original = fs.readdirSync;
  let reads = 0;
  fs.readdirSync = function (directory, ...args) {
    if (directory === root) {
      reads += 1;
      if (reject) throw Object.assign(new Error('fixture permission denied'), { code: 'EACCES' });
    }
    return original.call(this, directory, ...args);
  };
  try {
    return { result: fn(), reads };
  } finally {
    fs.readdirSync = original;
  }
}

test('detects all root extensions with one directory enumeration', root => {
  for (const name of ['main.py', 'main.ts', 'main.js', 'main.go', 'main.rs', 'main.rb',
    'Main.java', 'main.c', 'Main.cs', 'Main.fs', 'Main.swift', 'main.kt', 'main.ex',
    'main.php', 'main.dart']) fs.writeFileSync(path.join(root, name), '');
  const { result, reads } = observeDirectoryReads(root, () => detectProjectType(root));
  assert.deepStrictEqual(result.languages, ['python', 'typescript', 'golang', 'rust', 'ruby',
    'java', 'c', 'csharp', 'fsharp', 'swift', 'kotlin', 'elixir', 'php', 'dart']);
  assert.strictEqual(result.primary, 'python');
  assert.strictEqual(reads, 1);
});

test('does not infer languages from directory names or nested files', root => {
  fs.mkdirSync(path.join(root, 'archive.py'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'main.rs'), '');
  const { result, reads } = observeDirectoryReads(root, () => detectProjectType(root));
  assert.deepStrictEqual(result.languages, []);
  assert.strictEqual(result.primary, 'unknown');
  assert.strictEqual(reads, 1);
});

test('refreshes the directory snapshot on every detection', root => {
  assert.deepStrictEqual(detectProjectType(root).languages, []);
  fs.writeFileSync(path.join(root, 'main.py'), '');
  assert.deepStrictEqual(detectProjectType(root).languages, ['python']);
  fs.unlinkSync(path.join(root, 'main.py'));
  fs.writeFileSync(path.join(root, 'main.rs'), '');
  assert.deepStrictEqual(detectProjectType(root).languages, ['rust']);
});

test('keeps marker and dependency detection when enumeration fails', root => {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { express: '*' } }));
  const { result, reads } = observeDirectoryReads(root, () => detectProjectType(root), true);
  assert.deepStrictEqual(result.languages, ['javascript']);
  assert.deepStrictEqual(result.frameworks, ['express']);
  assert.strictEqual(result.primary, 'express');
  assert.strictEqual(reads, 1);
});

console.log(`\nPassed: ${passed}, Failed: ${failed}\n`);
process.exitCode = failed > 0 ? 1 : 0;
