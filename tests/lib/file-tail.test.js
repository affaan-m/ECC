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

test('reports raw bytes separately from decoded UTF-8 text when requested', () => {
  const incomplete = path.join(dir, 'incomplete.txt');
  fs.writeFileSync(incomplete, Buffer.from([0xe4, 0xb8]));
  assert.deepStrictEqual(readFileTail(incomplete, 10, { includeByteLength: true }), {
    text: '\ufffd', truncated: false, byteLength: 2
  });
});

test('reports zero raw bytes for an empty file when requested', () => {
  const empty = path.join(dir, 'empty.txt');
  assert.deepStrictEqual(readFileTail(empty, 10, { includeByteLength: true }), {
    text: '', truncated: false, byteLength: 0
  });
});

test('transcript-context still exports the same reader', () => {
  const context = require(path.join(__dirname, '..', '..', 'scripts', 'lib', 'transcript-context.js'));
  assert.strictEqual(context.readFileTail, readFileTail);
  assert.strictEqual(context.DEFAULT_TRANSCRIPT_TAIL_BYTES, DEFAULT_TRANSCRIPT_TAIL_BYTES);
});

function withReadSync(read, fn) {
  const original = fs.readSync;
  fs.readSync = (...args) => read(original, ...args);
  try {
    fn();
  } finally {
    fs.readSync = original;
  }
}

test('fills the requested tail after short reads', () => {
  withReadSync((read, fd, buffer, offset, length, position) =>
    read(fd, buffer, offset, Math.min(length, 1), position), () => {
    assert.deepStrictEqual(readFileTail(file, 4, { includeByteLength: true }), {
      text: 'cdef', truncated: true, byteLength: 4
    });
  });
});

test('decodes UTF-8 after joining short reads across multibyte characters', () => {
  const unicode = path.join(dir, 'unicode.txt');
  const text = '你好\u{1F30D}abc';
  fs.writeFileSync(unicode, text);
  withReadSync((read, fd, buffer, offset, length, position) =>
    read(fd, buffer, offset, Math.min(length, 2), position), () => {
    assert.deepStrictEqual(readFileTail(unicode, 1024, { includeByteLength: true }), {
      text, truncated: false, byteLength: Buffer.byteLength(text)
    });
  });
});

test('stops at EOF if the file shrinks while reading', () => {
  const shrinking = path.join(dir, 'shrinking.txt');
  fs.writeFileSync(shrinking, 'abcdef');
  let calls = 0;
  withReadSync((read, fd, buffer, offset, length, position) => {
    calls++;
    if (calls === 1) fs.truncateSync(shrinking, 3);
    return read(fd, buffer, offset, Math.min(length, 2), position);
  }, () => {
    assert.deepStrictEqual(readFileTail(shrinking, 1024, { includeByteLength: true }), {
      text: 'abc', truncated: false, byteLength: 3
    });
    assert.strictEqual(calls, 3);
  });
});

test('does not read beyond the original tail when the file grows', () => {
  const growing = path.join(dir, 'growing.txt');
  fs.writeFileSync(growing, 'abcdef');
  let calls = 0;
  withReadSync((read, fd, buffer, offset, length, position) => {
    if (calls++ === 0) fs.appendFileSync(growing, 'ghijkl');
    return read(fd, buffer, offset, Math.min(length, 2), position);
  }, () => {
    assert.deepStrictEqual(readFileTail(growing, 4, { includeByteLength: true }), {
      text: 'cdef', truncated: true, byteLength: 4
    });
    assert.strictEqual(calls, 2);
  });
});

test('returns null and closes the descriptor if a later read fails', () => {
  let calls = 0;
  let descriptor;
  withReadSync((read, fd, buffer, offset, length, position) => {
    descriptor = fd;
    if (calls++ > 0) throw Object.assign(new Error('read failed'), { code: 'EIO' });
    return read(fd, buffer, offset, 1, position);
  }, () => {
    assert.strictEqual(readFileTail(file, 1024), null);
    assert.throws(() => fs.fstatSync(descriptor), { code: 'EBADF' });
  });
});

test('context detection retains the latest usage record after short reads', () => {
  const transcript = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(transcript, [1000, 170000].map(tokens => JSON.stringify({
    type: 'assistant',
    message: { model: 'claude-sonnet-4-6', usage: { input_tokens: tokens } }
  })).join('\n'));
  const { readLatestContextTokens } = require('../../scripts/lib/transcript-context');
  withReadSync((read, fd, buffer, offset, length, position) =>
    read(fd, buffer, offset, Math.min(length, 32), position), () => {
    assert.deepStrictEqual(readLatestContextTokens(transcript), {
      tokens: 170000, model: 'claude-sonnet-4-6'
    });
  });
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
