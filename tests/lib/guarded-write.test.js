/** Focused descriptor-bound writes; every filesystem fixture is private. */
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileNoFollow } = require('../../scripts/lib/install/guarded-write');
const { assertFilePostimage } = require('./helpers/assert-file-postimage');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
let passed = 0;
let failed = 0;
function test(name, callback) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-guarded-')));
  const file = path.join(root, 'entry.js');
  const options = { action: 'replace activation', validateDestination: value => value };
  try { callback({ root, file, options }); passed++; console.log(`  PASS ${name}`); }
  catch (error) { failed++; console.error(`  FAIL ${name}: ${error.stack}`); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function replaceMethod(name, replacement, callback) {
  const original = fs[name];
  fs[name] = replacement(original);
  try { callback(); } finally { fs[name] = original; }
}
function existing(options, content = 'old activation bytes') {
  return { ...options, expectedContent: Object.freeze({ kind: 'sha256', digest: digest(content) }) };
}
test('hashing then writing shorter bytes starts at zero and preserves the requested mode', ({ file, options }) => {
  fs.writeFileSync(file, 'old activation bytes');
  writeFileNoFollow(file, 'off\n', { ...existing(options), mode: 0o600 });
  assert.deepStrictEqual(fs.readFileSync(file), Buffer.from('off\n'));
  assert.strictEqual(fs.statSync(file).size, 4);
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
});
test('short writes are completed at explicit positions', ({ file, options }) => {
  const positions = [];
  replaceMethod('writeSync', original => (fd, buffer, offset, length, position) => {
    positions.push(position);
    return original(fd, buffer, offset, Math.min(length, 2), position);
  }, () => writeFileNoFollow(file, 'abcdef', options));
  assert.deepStrictEqual(positions, [0, 2, 4]);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'abcdef');
});
test('expected absence creates a new exact file', ({ file, options }) => {
  writeFileNoFollow(file, Buffer.from('inert'), { ...options, expectedContent: { kind: 'absent' } });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'inert');
});
test('a competing file before exclusive open is preserved', ({ file, options }) => {
  replaceMethod('openSync', original => (...args) => {
    if (args[0] === file && typeof args[1] === 'number') fs.writeFileSync(file, 'user bytes');
    return original(...args);
  }, () => assert.throws(() => writeFileNoFollow(file, 'off', {
    ...options, expectedContent: { kind: 'absent' },
  }), /changed after preflight/));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'user bytes');
});
test('existing content removed before open is never recreated', ({ file, options }) => {
  fs.writeFileSync(file, 'old activation bytes');
  replaceMethod('openSync', original => (...args) => {
    if (args[0] === file) fs.unlinkSync(file);
    return original(...args);
  }, () => assert.throws(() => writeFileNoFollow(file, 'off', existing(options)), /changed after preflight/));
  assert.strictEqual(fs.existsSync(file), false);
});
test('same-inode edit at the writable-open boundary refuses before truncate and closes once', ({ file, options }) => {
  fs.writeFileSync(file, 'old activation bytes');
  let descriptor;
  let closes = 0;
  let truncates = 0;
  const originalOpen = fs.openSync;
  const originalClose = fs.closeSync;
  const originalTruncate = fs.ftruncateSync;
  fs.openSync = (...args) => {
    const fd = originalOpen(...args);
    if (args[0] === file && typeof args[1] === 'number') {
      descriptor = fd;
      fs.writeFileSync(file, 'user edited activation');
    }
    return fd;
  };
  fs.closeSync = fd => { if (fd === descriptor) closes++; return originalClose(fd); };
  fs.ftruncateSync = (...args) => { truncates++; return originalTruncate(...args); };
  try { assert.throws(() => writeFileNoFollow(file, 'off', existing(options)), /changed after preflight/); }
  finally { fs.openSync = originalOpen; fs.closeSync = originalClose; fs.ftruncateSync = originalTruncate; }
  assert.strictEqual(closes, 1);
  assert.strictEqual(truncates, 0);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'user edited activation');
});
test('a descriptor read concurrent edit is observed before truncation', ({ file, options }) => {
  fs.writeFileSync(file, 'old activation bytes');
  replaceMethod('readFileSync', original => (...args) => {
    const result = original(...args);
    if (typeof args[0] === 'number') fs.writeFileSync(file, 'raced during hash');
    return result;
  }, () => assert.throws(() => writeFileNoFollow(file, 'off', existing(options)), /changed after preflight/));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'raced during hash');
});
test('a pathname replacement after opening preserves both original and replacement', ({ file, options }) => {
  fs.writeFileSync(file, 'old activation bytes');
  replaceMethod('openSync', original => (...args) => {
    const fd = original(...args);
    if (args[0] === file && typeof args[1] === 'number') {
      fs.renameSync(file, `${file}.old`);
      fs.writeFileSync(file, 'replacement');
    }
    return fd;
  }, () => assert.throws(() => writeFileNoFollow(file, 'off', existing(options)), /changed/));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'replacement');
  assert.strictEqual(fs.readFileSync(`${file}.old`, 'utf8'), 'old activation bytes');
});
test('a directory destination is refused without writes', ({ file, options }) => {
  fs.mkdirSync(file);
  assert.throws(() => writeFileNoFollow(file, 'off', options));
  assert.ok(fs.statSync(file).isDirectory());
});
test('a parent replacement before native open is refused even when the file identity is unchanged', ({ root, options }) => {
  const parent = path.join(root, 'plugins');
  fs.mkdirSync(parent);
  const file = path.join(parent, 'entry.js');
  const setupFd = fs.openSync(file, 'wx', 0o600);
  let fileIdentity;
  try {
    fs.writeFileSync(setupFd, 'old activation bytes');
    fileIdentity = fs.fstatSync(setupFd, { bigint: true });
  } finally {
    // Close before the parent swap, including on setup failure, for Windows.
    fs.closeSync(setupFd);
  }
  const originalOpen = fs.openSync;
  const originalClose = fs.closeSync;
  const originalTruncate = fs.ftruncateSync;
  let descriptor;
  let swaps = 0;
  let closes = 0;
  let truncates = 0;
  fs.openSync = (...args) => {
    if (args[0] === file && typeof args[1] === 'number') {
      // The writer has pinned the parent, but has not opened the file yet.
      // Moving an open file's parent is not portable to Windows. Keep the
      // same file inode and bytes so only the parent identity rejects this.
      fs.renameSync(parent, `${parent}.old`);
      fs.mkdirSync(parent);
      fs.renameSync(path.join(`${parent}.old`, 'entry.js'), file);
      swaps++;
      descriptor = originalOpen(...args);
      return descriptor;
    }
    return originalOpen(...args);
  };
  fs.closeSync = fd => { if (fd === descriptor) closes++; return originalClose(fd); };
  fs.ftruncateSync = (...args) => { truncates++; return originalTruncate(...args); };
  try {
    assert.throws(() => writeFileNoFollow(file, 'off', existing(options)), error => {
      assert.match(error.message, /changed after preflight/);
      assert.strictEqual(error.cause, undefined, 'the parent guard, not an open error, refuses');
      return true;
    });
  } finally {
    fs.openSync = originalOpen;
    fs.closeSync = originalClose;
    fs.ftruncateSync = originalTruncate;
  }
  assert.strictEqual(swaps, 1);
  assert.strictEqual(typeof descriptor, 'number');
  assert.strictEqual(closes, 1);
  assert.strictEqual(truncates, 0);
  assertFilePostimage(file, fileIdentity, 'old activation bytes');
  assert.ok(fs.statSync(`${parent}.old`).isDirectory());
});
test('a denied native open preserves its cause without closing an unallocated descriptor', ({ file, options }) => {
  fs.writeFileSync(file, 'old activation bytes');
  const denied = Object.assign(new Error('fixture open denied'), { code: 'EPERM' });
  const originalClose = fs.closeSync;
  const originalTruncate = fs.ftruncateSync;
  let closes = 0;
  let truncates = 0;
  fs.closeSync = fd => { closes++; return originalClose(fd); };
  fs.ftruncateSync = (...args) => { truncates++; return originalTruncate(...args); };
  try {
    replaceMethod('openSync', original => (...args) => {
      if (args[0] === file && typeof args[1] === 'number') throw denied;
      return original(...args);
    }, () => assert.throws(() => writeFileNoFollow(file, 'off', existing(options)), error => {
      assert.strictEqual(error.cause, denied);
      assert.strictEqual(error.code, 'EPERM');
      return true;
    }));
  } finally {
    fs.closeSync = originalClose;
    fs.ftruncateSync = originalTruncate;
  }
  assert.strictEqual(closes, 0);
  assert.strictEqual(truncates, 0);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'old activation bytes');
});
test('destination validator is mandatory and must return the same path', ({ file, options }) => {
  assert.throws(() => writeFileNoFollow(file, 'off', {}), /validateDestination/);
  assert.throws(() => writeFileNoFollow(file, 'off', { ...options, validateDestination: () => `${file}.other` }), /changed/);
  assert.strictEqual(fs.existsSync(file), false);
});
test('destination validation runs again after the descriptor hash', ({ file, options }) => {
  fs.writeFileSync(file, 'old activation bytes');
  let validations = 0;
  assert.throws(() => writeFileNoFollow(file, 'off', {
    ...existing(options), validateDestination: value => {
      validations++;
      if (validations === 3) throw new Error('containment changed');
      return value;
    },
  }), /containment changed/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'old activation bytes');
});
for (const method of ['readFileSync', 'ftruncateSync', 'writeSync', 'fchmodSync']) {
  test(`${method} failure closes once and preserves the primary error if close also fails`, ({ file, options }) => {
    fs.writeFileSync(file, 'old activation bytes');
    const primary = new Error(`${method} primary`);
    const secondary = new Error('close secondary');
    const original = fs[method];
    const close = fs.closeSync;
    let closes = 0;
    fs[method] = (...args) => { if (typeof args[0] === 'number') throw primary; return original(...args); };
    fs.closeSync = fd => { closes++; close(fd); throw secondary; };
    try {
      assert.throws(() => writeFileNoFollow(file, 'off', { ...existing(options), mode: 0o600 }), error => {
        assert.strictEqual(error, primary);
        assert.strictEqual(error.closeError, secondary);
        return true;
      });
    } finally { fs[method] = original; fs.closeSync = close; }
    assert.strictEqual(closes, 1);
  });
}
test('close failure after a successful write is reported', ({ file, options }) => {
  replaceMethod('closeSync', original => fd => { original(fd); throw new Error('close failed'); }, () => {
    assert.throws(() => writeFileNoFollow(file, 'off', options), /close failed/);
  });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'off');
});
test('zero-progress writes refuse instead of spinning', ({ file, options }) => {
  replaceMethod('writeSync', () => () => 0, () => assert.throws(() => writeFileNoFollow(file, 'off', options), /progress/));
});
test('malformed expected-content guards fail before opening a destination', ({ file, options }) => {
  for (const expectedContent of [null, true, { kind: 'sha256', digest: 'bad' }, { kind: 'missing' }]) {
    assert.throws(() => writeFileNoFollow(file, 'off', { ...options, expectedContent }), /expectedContent/);
  }
  assert.strictEqual(fs.existsSync(file), false);
});
test('a new exclusive file changed through the owned descriptor is preserved', ({ file, options }) => {
  replaceMethod('openSync', original => (...args) => {
    const fd = original(...args);
    if (args[0] === file && typeof args[1] === 'number') fs.writeSync(fd, Buffer.from('raced creation'), 0, 14, 0);
    return fd;
  }, () => assert.throws(() => writeFileNoFollow(file, 'off', {
    ...options, expectedContent: { kind: 'absent' },
  }), /changed after preflight/));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'raced creation');
});
test('the final pathname must remain a regular non-symlink even without O_NOFOLLOW support', ({ file, options }) => {
  fs.writeFileSync(file, 'old activation bytes');
  replaceMethod('lstatSync', original => (...args) => {
    const stats = original(...args);
    if (args[0] === file) {
      const simulatedSymlink = Object.create(stats);
      simulatedSymlink.isSymbolicLink = () => true;
      return simulatedSymlink;
    }
    return stats;
  }, () => assert.throws(() => writeFileNoFollow(file, 'off', existing(options)), /changed/));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'old activation bytes');
});
test('the immutable preflight digest cannot be changed by a validator callback', ({ file, options }) => {
  fs.writeFileSync(file, 'user bytes');
  const expectedContent = { kind: 'sha256', digest: digest('old bytes') };
  assert.throws(() => writeFileNoFollow(file, 'off', {
    ...options, expectedContent, validateDestination: value => {
      expectedContent.digest = digest('user bytes');
      return value;
    },
  }), /changed after preflight/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'user bytes');
});
test('unexpected input fails without creating a file', ({ file, options }) => {
  assert.throws(() => writeFileNoFollow(file, {}, options), /content/);
  assert.strictEqual(fs.existsSync(file), false);
});
console.log(`Results: Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
