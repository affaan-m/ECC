'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const filename = path.resolve(__dirname, '../../scripts/lib/atomic-write.js');
const source = fs.readFileSync(filename, 'utf8');

// Load the actual helper with a local platform/filesystem facade. File creation,
// fsync, replacement and cleanup remain real; fault injection is module-local.
function loadHelper(platform, rename, { clockStep = 25, read = fs.readFileSync } = {}) {
  let elapsed = 0;
  let waits = 0;
  const filesystem = Object.create(fs);
  filesystem.renameSync = rename;
  filesystem.readFileSync = read;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: name => name === 'fs' ? filesystem : require(name),
    process: { platform, pid: process.pid },
    performance: { now: () => elapsed },
    Atomics: { wait: () => { elapsed += clockStep; waits++; } },
    SharedArrayBuffer, Int32Array,
  }, { filename });
  return { ...module.exports, waits: () => waits };
}

let passed = 0;
let failed = 0;
function test(name, run) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-atomic-rename-')));
  const destination = path.join(root, 'state.json');
  fs.writeFileSync(destination, 'old');
  try { run({ root, destination }); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
const sharingError = code => Object.assign(new Error(`Injected sharing violation: ${code}`), { code });

for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test(`Windows ${code} retries atomic replacement without disturbing old bytes`, ({ root, destination }) => {
    let attempts = 0;
    let guards = 0;
    const helper = loadHelper('win32', (temporary, target) => {
      attempts++;
      assert.strictEqual(fs.readFileSync(target, 'utf8'), 'old');
      assert.strictEqual(fs.readFileSync(temporary, 'utf8'), 'new');
      if (attempts < 3) throw sharingError(code);
      fs.renameSync(temporary, target);
    });
    helper.writeFileAtomic(destination, 'new', { beforeRename: () => { guards++; } });
    assert.strictEqual(attempts, 3);
    assert.strictEqual(guards, attempts);
    assert.strictEqual(helper.waits(), 2);
    assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'new');
    assert.deepStrictEqual(fs.readdirSync(root), ['state.json']);
  });

  test(`Windows permanent ${code} preserves destination and removes private staging`, ({ root, destination }) => {
    let attempts = 0;
    const expected = sharingError(code);
    const helper = loadHelper('win32', (_temporary, target) => {
      attempts++;
      assert.strictEqual(fs.readFileSync(target, 'utf8'), 'old');
      throw expected;
    });
    assert.throws(() => helper.writeFileAtomic(destination, 'new'), error => error === expected);
    assert.strictEqual(attempts, 81, 'Hard attempt bound applies even before the deadline');
    assert.strictEqual(helper.waits(), 80);
    assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'old');
    assert.deepStrictEqual(fs.readdirSync(root), ['state.json']);
  });

  test(`Windows ${code} recovers sustained sharing contention with ownership rechecked`, ({ root, destination }) => {
    let attempts = 0;
    let parents = 0;
    let guards = 0;
    const helper = loadHelper('win32', (temporary, target) => {
      attempts++;
      assert.strictEqual(fs.readFileSync(target, 'utf8'), 'old');
      assert.strictEqual(fs.readFileSync(temporary, 'utf8'), 'new');
      if (attempts <= 50) throw sharingError(code);
      fs.renameSync(temporary, target);
    });
    helper.writeFileAtomic(destination, 'new', {
      validateParent: () => { parents++; },
      beforeRename: () => { guards++; },
    });
    assert.strictEqual(attempts, 51);
    assert.strictEqual(guards, attempts);
    assert.ok(parents >= attempts);
    assert.strictEqual(helper.waits(), 50);
    assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'new');
    assert.deepStrictEqual(fs.readdirSync(root), ['state.json']);
  });
}

test('Windows retries also stop at the elapsed deadline', ({ root, destination }) => {
  let attempts = 0;
  const expected = sharingError('EPERM');
  const helper = loadHelper('win32', () => { attempts++; throw expected; }, { clockStep: 250 });
  assert.throws(() => helper.writeFileAtomic(destination, 'new'), error => error === expected);
  assert.strictEqual(attempts, 9);
  assert.deepStrictEqual(fs.readdirSync(root), ['state.json']);
});

for (const platform of ['linux', 'darwin']) {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    test(`${platform} ${code} propagates immediately with original bytes intact`, ({ root, destination }) => {
      let attempts = 0;
      const expected = sharingError(code);
      const helper = loadHelper(platform, () => { attempts++; throw expected; });
      assert.throws(() => helper.writeFileAtomic(destination, 'new'), error => error === expected);
      assert.strictEqual(attempts, 1);
      assert.strictEqual(helper.waits(), 0);
      assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'old');
      assert.deepStrictEqual(fs.readdirSync(root), ['state.json']);
    });
  }
}

test('Windows unrelated IO failure propagates immediately', ({ root, destination }) => {
  let attempts = 0;
  const expected = sharingError('EIO');
  const helper = loadHelper('win32', () => { attempts++; throw expected; });
  assert.throws(() => helper.writeFileAtomic(destination, 'new'), error => error === expected);
  assert.strictEqual(attempts, 1);
  assert.strictEqual(helper.waits(), 0);
  assert.deepStrictEqual(fs.readdirSync(root), ['state.json']);
});

test('ownership revocation between sharing failures prevents another rename', ({ root, destination }) => {
  let attempts = 0;
  let guards = 0;
  const revoked = new Error('Destination ownership revoked');
  const helper = loadHelper('win32', () => { attempts++; throw sharingError('EPERM'); });
  assert.throws(() => helper.writeFileAtomic(destination, 'new', {
    beforeRename() { if (++guards === 2) throw revoked; },
  }), error => error === revoked);
  assert.strictEqual(attempts, 1);
  assert.strictEqual(guards, 2);
  assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'old');
  assert.deepStrictEqual(fs.readdirSync(root), ['state.json']);
});

test('late ownership revocation stops sustained contention without publication', ({ root, destination }) => {
  let attempts = 0;
  let guards = 0;
  const revoked = new Error('Destination ownership revoked after sustained contention');
  const helper = loadHelper('win32', () => { attempts++; throw sharingError('EPERM'); });
  assert.throws(() => helper.writeFileAtomic(destination, 'new', {
    beforeRename() { if (++guards === 26) throw revoked; },
  }), error => error === revoked);
  assert.strictEqual(attempts, 25);
  assert.strictEqual(guards, 26);
  assert.strictEqual(helper.waits(), 25);
  assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'old');
  assert.deepStrictEqual(fs.readdirSync(root), ['state.json']);
});

test('parent replacement during retry preserves both destinations and original private staging', ({ root, destination }) => {
  const parent = path.join(root, 'parent');
  const original = path.join(root, 'original');
  fs.mkdirSync(parent);
  const target = path.join(parent, 'state.json');
  fs.writeFileSync(target, 'old');
  const identity = fs.statSync(parent).ino;
  const revoked = new Error('Parent identity changed');
  let attempts = 0;
  const helper = loadHelper('win32', () => {
    attempts++;
    fs.renameSync(parent, original);
    fs.mkdirSync(parent);
    fs.writeFileSync(target, 'user replacement');
    throw sharingError('EPERM');
  });
  assert.throws(() => helper.writeFileAtomic(target, 'new', {
    validateParent() { if (fs.statSync(parent).ino !== identity) throw revoked; },
  }), error => error === revoked);
  assert.strictEqual(attempts, 1);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), 'user replacement');
  assert.strictEqual(fs.readFileSync(path.join(original, 'state.json'), 'utf8'), 'old');
  const staging = fs.readdirSync(original).filter(name => name.endsWith('.tmp'));
  assert.strictEqual(staging.length, 1, 'Do not clean a pathname through a substituted parent');
  assert.strictEqual(fs.readFileSync(path.join(original, staging[0]), 'utf8'), 'new');
  assert.deepStrictEqual(fs.readdirSync(parent), ['state.json']);
  assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'old');
});

for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test(`Windows reader recovers ${code} and returns the complete published bytes`, ({ root, destination }) => {
    fs.writeFileSync(destination, '{"published":true}');
    let attempts = 0;
    const helper = loadHelper('win32', fs.renameSync, { read(file, options) {
      attempts++;
      assert.strictEqual(file, destination);
      assert.strictEqual(options, 'utf8');
      if (attempts < 3) throw sharingError(code);
      return fs.readFileSync(file, options);
    } });
    assert.deepStrictEqual(JSON.parse(helper.readFileWithSharingRetry(destination, 'utf8')), { published: true });
    assert.strictEqual(attempts, 3);
    assert.strictEqual(helper.waits(), 2);
    assert.deepStrictEqual(fs.readdirSync(root), ['state.json']);
  });

  test(`Windows reader preserves the final permanent ${code} and never writes`, ({ root, destination }) => {
    let attempts = 0;
    const expected = sharingError(code);
    const helper = loadHelper('win32', fs.renameSync, { read() { attempts++; throw expected; } });
    assert.throws(() => helper.readFileWithSharingRetry(destination, 'utf8'), error => error === expected);
    assert.strictEqual(attempts, 21);
    assert.strictEqual(helper.waits(), 20);
    assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'old');
    assert.deepStrictEqual(fs.readdirSync(root), ['state.json']);
  });
}

for (const platform of ['linux', 'darwin']) {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    test(`${platform} reader propagates ${code} immediately`, ({ destination }) => {
      let attempts = 0;
      const expected = sharingError(code);
      const helper = loadHelper(platform, fs.renameSync, { read() { attempts++; throw expected; } });
      assert.throws(() => helper.readFileWithSharingRetry(destination, 'utf8'), error => error === expected);
      assert.strictEqual(attempts, 1);
      assert.strictEqual(helper.waits(), 0);
    });
  }
}

test('Windows reader stops at the elapsed deadline', ({ destination }) => {
  let attempts = 0;
  const expected = sharingError('EPERM');
  const helper = loadHelper('win32', fs.renameSync, { clockStep: 250, read() { attempts++; throw expected; } });
  assert.throws(() => helper.readFileWithSharingRetry(destination, 'utf8'), error => error === expected);
  assert.strictEqual(attempts, 4);
});

test('Windows reader does not retry missing files', ({ root }) => {
  const helper = loadHelper('win32', fs.renameSync);
  assert.throws(() => helper.readFileWithSharingRetry(path.join(root, 'missing'), 'utf8'), error => error.code === 'ENOENT');
  assert.strictEqual(helper.waits(), 0);
});

test('Windows reader does not retry unrelated IO or JSON parse failures', ({ destination }) => {
  const expected = sharingError('EIO');
  const denied = loadHelper('win32', fs.renameSync, { read() { throw expected; } });
  assert.throws(() => denied.readFileWithSharingRetry(destination, 'utf8'), error => error === expected);
  assert.strictEqual(denied.waits(), 0);
  fs.writeFileSync(destination, '{malformed');
  let reads = 0;
  const invalid = loadHelper('win32', fs.renameSync, { read(file, options) { reads++; return fs.readFileSync(file, options); } });
  assert.throws(() => JSON.parse(invalid.readFileWithSharingRetry(destination, 'utf8')), /JSON|property|Unexpected/);
  assert.strictEqual(reads, 1);
  assert.strictEqual(invalid.waits(), 0);
});

console.log(`Results: Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
