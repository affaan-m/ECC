'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { trySymlink } = require('./symlink-support');

// A host that permits symlinks only ever exercises the success branch, so the
// skip and rethrow paths are driven through injected stand-ins. Nothing here
// touches the shared fs or console objects, and each recorder replaces its
// array rather than appending to it.
function recorder(behaviour) {
  let calls = [];
  let logs = [];
  return {
    deps: {
      symlinkSync: (...args) => {
        calls = [...calls, args];
        return behaviour(...args);
      },
      log: message => {
        logs = [...logs, message];
      },
    },
    get calls() { return calls; },
    get logs() { return logs; },
  };
}

const created = () => undefined;

const refusing = code => () => {
  const error = new Error(`stand-in ${code}`);
  if (code) error.code = code;
  throw error;
};

test('reports success and forwards every argument unchanged', () => {
  const spy = recorder(created);
  assert.equal(trySymlink('target', 'link', 'junction', spy.deps), true);
  assert.deepEqual(spy.calls, [['target', 'link', 'junction']]);
  assert.deepEqual(spy.logs, [], 'a created link must not print a skip notice');
});

test('passes the type through as undefined when the caller omits it', () => {
  const spy = recorder(created);
  trySymlink('target', 'link', undefined, spy.deps);
  assert.deepEqual(spy.calls, [['target', 'link', undefined]]);
});

for (const code of ['EPERM', 'EACCES', 'ENOSYS']) {
  test(`treats ${code} as an unsupported platform and skips`, () => {
    const spy = recorder(refusing(code));
    assert.equal(trySymlink('target', 'link', undefined, spy.deps), false);
    assert.equal(spy.logs.length, 1, 'exactly one skip notice');
    assert.match(spy.logs[0], /symlink unsupported/);
  });
}

test('rethrows an unrelated error unchanged rather than skipping', () => {
  const spy = recorder(refusing('EEXIST'));
  assert.throws(() => trySymlink('target', 'link', undefined, spy.deps), /stand-in EEXIST/);
  assert.deepEqual(spy.logs, [], 'a real failure must not look like a skip');
});

test('rethrows an error that carries no code', () => {
  const spy = recorder(refusing(undefined));
  assert.throws(() => trySymlink('target', 'link', undefined, spy.deps), /stand-in undefined/);
  assert.deepEqual(spy.logs, []);
});

test('reaches the real fs.symlinkSync when no stand-in is given', () => {
  // Linking into a directory that does not exist. The outcome depends on the
  // host, and either one proves the default dependency resolved: ENOENT where
  // symlinks are permitted, or a recorded refusal where the OS blocks them
  // before it ever looks at the parent directory. Only `log` is injected, to
  // keep a real skip notice out of the suite's output.
  const linkPath = path.join('no-such-directory-here', 'link');
  let outcome;
  try {
    outcome = trySymlink('target', linkPath, undefined, { log: () => {} });
  } catch (error) {
    outcome = error.code;
  }
  assert.ok(outcome === 'ENOENT' || outcome === false, `unexpected outcome: ${outcome}`);
});
