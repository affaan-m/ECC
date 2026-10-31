'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { trySymlink } = require('./symlink-support');

// A host that permits symlinks only ever exercises the success branch, so the
// skip and rethrow paths are driven with a stand-in. The helper looks up
// fs.symlinkSync at call time, and require('fs') and require('node:fs') return
// the same module object, so replacing the property here is what it sees.
function withSymlinkSync(fake, run) {
  const originalSymlink = fs.symlinkSync;
  const originalLog = console.log;
  const logged = [];
  fs.symlinkSync = fake;
  console.log = message => logged.push(message);
  try {
    return run(logged);
  } finally {
    fs.symlinkSync = originalSymlink;
    console.log = originalLog;
  }
}

const throwing = code => () => {
  const error = new Error(`stand-in ${code}`);
  if (code) error.code = code;
  throw error;
};

test('reports success and forwards every argument unchanged', () => {
  const calls = [];
  withSymlinkSync((...args) => calls.push(args), logged => {
    assert.equal(trySymlink('target', 'link', 'junction'), true);
    assert.deepEqual(calls, [['target', 'link', 'junction']]);
    assert.deepEqual(logged, [], 'a created link must not print a skip notice');
  });
});

test('omits the type argument when the caller does', () => {
  const calls = [];
  withSymlinkSync((...args) => calls.push(args), () => {
    trySymlink('target', 'link');
    assert.deepEqual(calls, [['target', 'link', undefined]]);
  });
});

for (const code of ['EPERM', 'EACCES', 'ENOSYS']) {
  test(`treats ${code} as an unsupported platform and skips`, () => {
    withSymlinkSync(throwing(code), logged => {
      assert.equal(trySymlink('target', 'link'), false);
      assert.equal(logged.length, 1, 'exactly one skip notice');
      assert.match(logged[0], /symlink unsupported/);
    });
  });
}

test('rethrows an unrelated error unchanged rather than skipping', () => {
  withSymlinkSync(throwing('EEXIST'), logged => {
    assert.throws(() => trySymlink('target', 'link'), /stand-in EEXIST/);
    assert.deepEqual(logged, [], 'a real failure must not look like a skip');
  });
});

test('rethrows an error that carries no code', () => {
  withSymlinkSync(throwing(undefined), logged => {
    assert.throws(() => trySymlink('target', 'link'), /stand-in undefined/);
    assert.deepEqual(logged, []);
  });
});
