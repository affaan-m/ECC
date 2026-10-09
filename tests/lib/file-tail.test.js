'use strict';
/**
 * Tests for scripts/lib/file-tail.js.
 *
 * Run with: node tests/lib/file-tail.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readFileTail, DEFAULT_TRANSCRIPT_TAIL_BYTES } = require(path.join(__dirname, '..', '..', 'scripts', 'lib', 'file-tail.js'));

console.log('=== Testing file-tail.js ===\n');

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-tail-'));
const file = path.join(dir, 'f.txt');
fs.writeFileSync(file, 'abcdef');

test('the default tail is 256 KiB', () => {
  assert.strictEqual(DEFAULT_TRANSCRIPT_TAIL_BYTES, 256 * 1024);
});

test('a file smaller than the tail is read whole', () => {
  assert.deepStrictEqual(readFileTail(file, 1024), { text: 'abcdef', truncated: false });
});

test('a larger file is cut to its last bytes and marked truncated', () => {
  assert.deepStrictEqual(readFileTail(file, 2), { text: 'ef', truncated: true });
});

test('an empty file gives empty text', () => {
  const empty = path.join(dir, 'empty.txt');
  fs.writeFileSync(empty, '');
  assert.deepStrictEqual(readFileTail(empty, 10), { text: '', truncated: false });
});

test('a missing file gives null', () => {
  assert.strictEqual(readFileTail(path.join(dir, 'missing.txt'), 10), null);
});

test('transcript-context still exports the same reader', () => {
  const context = require(path.join(__dirname, '..', '..', 'scripts', 'lib', 'transcript-context.js'));
  assert.strictEqual(context.readFileTail, readFileTail);
  assert.strictEqual(context.DEFAULT_TRANSCRIPT_TAIL_BYTES, DEFAULT_TRANSCRIPT_TAIL_BYTES);
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
