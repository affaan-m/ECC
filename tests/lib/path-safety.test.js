'use strict';
/**
 * Tests for scripts/lib/path-safety.js — the install-state containment guard
 * that fixes arbitrary file write/delete via attacker-controlled install-state
 * (GHSA-hfpv-w6mp-5g95).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { assertWithinTrustedRoot, isWithinRoot } = require('../../scripts/lib/path-safety');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    ${error.message}`);
    failed += 1;
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'path-safety-root-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'path-safety-out-'));

try {
  test('allows a path inside the trusted root', () => {
    const p = path.join(root, '.cursor', 'rules', 'x.md');
    // Returns the canonicalized path (symlinks like /var -> /private/var resolved).
    assert.doesNotThrow(() => assertWithinTrustedRoot(p, root, 'repair'));
    assert.ok(assertWithinTrustedRoot(p, root, 'repair').endsWith(path.join('.cursor', 'rules', 'x.md')));
    assert.strictEqual(isWithinRoot(p, root), true);
  });

  test('allows the root itself', () => {
    assert.strictEqual(isWithinRoot(root, root), true);
  });

  test('refuses an absolute path outside the root', () => {
    const evil = path.join(outside, 'PWNED.txt');
    assert.throws(() => assertWithinTrustedRoot(evil, root, 'repair'), /outside the install root/);
    assert.strictEqual(isWithinRoot(evil, root), false);
  });

  test('refuses a ../ traversal escape', () => {
    const evil = path.join(root, '..', 'escape.txt');
    assert.throws(() => assertWithinTrustedRoot(evil, root, 'uninstall'), /outside the install root/);
  });

  test('refuses a symlinked intermediate directory that escapes the root', () => {
    const linkDir = path.join(root, 'link');
    try {
      fs.symlinkSync(outside, linkDir, 'dir');
    } catch {
      console.log('    (symlink unsupported on this platform; skipping)');
      return;
    }
    // root/link -> outside, so root/link/PWNED resolves outside the root.
    const evil = path.join(linkDir, 'PWNED.txt');
    assert.throws(() => assertWithinTrustedRoot(evil, root, 'repair'), /outside the install root/);
  });

  test('refuses when no trusted root is resolved', () => {
    assert.throws(() => assertWithinTrustedRoot(path.join(root, 'x'), null, 'repair'), /no trusted install root/);
  });

  test('refuses a missing destination path', () => {
    assert.throws(() => assertWithinTrustedRoot('', root, 'repair'), /missing destination path/);
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
}

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
}
