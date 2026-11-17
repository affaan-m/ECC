'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getFallbackSessionRecordingPath,
  normalizeClaudeHistorySession,
  persistCanonicalSnapshot
} = require('../../scripts/lib/session-adapters/canonical-session');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}: ${error.message}`);
    failed += 1;
  }
}

function snapshot(title) {
  return normalizeClaudeHistorySession({
    shortId: 'recording-session',
    sessionPath: '/fixture/session.tmp',
    metadata: { title }
  }, { type: 'claude-history', value: 'recording-session' });
}

function failAfterPartialWrite(callback, observe) {
  const originalWrite = fs.writeFileSync;
  const error = Object.assign(new Error('Simulated disk full after partial write'), { code: 'ENOSPC' });
  let calls = 0;
  fs.writeFileSync = destination => {
    calls += 1;
    // The atomic writer stages through an open descriptor; write the partial
    // bytes to that same descriptor instead of re-opening any path.
    assert.strictEqual(typeof destination, 'number', 'staging must write through a descriptor');
    fs.writeSync(destination, '{"incomplete":');
    observe();
    throw error;
  };
  try {
    assert.throws(callback, caught => caught === error);
    assert.strictEqual(calls, 1, 'the failure must occur during an actual write');
  } finally {
    fs.writeFileSync = originalWrite;
  }
}

const backends = [
  ['missing state store', () => null],
  ['factory state store', () => ({ createStateStore() {} })]
];

for (const [backend, loadStateStoreImpl] of backends) {
  test(`failed replacement preserves prior snapshot and history: ${backend}`, () => {
    const recordingDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-recording-replace-')));
    try {
      const options = { recordingDir, loadStateStoreImpl };
      const first = snapshot('Existing session');
      const next = snapshot('Next session state — 已完成');
      persistCanonicalSnapshot(first, options);
      const filePath = getFallbackSessionRecordingPath(first, options);
      const before = fs.readFileSync(filePath, 'utf8');
      let observed;

      failAfterPartialWrite(() => persistCanonicalSnapshot(next, options), () => {
        observed = fs.readFileSync(filePath, 'utf8');
      });

      assert.strictEqual(observed, before, 'readers must retain the prior complete recording during a write');
      assert.strictEqual(fs.readFileSync(filePath, 'utf8'), before, 'a failed write must not truncate saved history');
      assert.deepStrictEqual(fs.readdirSync(path.dirname(filePath)), [path.basename(filePath)]);

      persistCanonicalSnapshot(next, options);
      const recovered = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      assert.strictEqual(recovered.createdAt, JSON.parse(before).createdAt);
      assert.deepStrictEqual(recovered.latest, next);
      assert.deepStrictEqual(recovered.history.map(entry => entry.snapshot), [first, next]);
    } finally {
      fs.rmSync(recordingDir, { recursive: true, force: true });
    }
  });

  test(`failed first write does not publish an invalid recording: ${backend}`, () => {
    const recordingDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-recording-initial-')));
    try {
      const options = { recordingDir, loadStateStoreImpl };
      const first = snapshot('First session');
      const filePath = getFallbackSessionRecordingPath(first, options);
      let visibleDuringWrite;

      failAfterPartialWrite(() => persistCanonicalSnapshot(first, options), () => {
        visibleDuringWrite = fs.existsSync(filePath);
      });

      assert.strictEqual(visibleDuringWrite, false, 'the first recording must only become visible when complete');
      assert.strictEqual(fs.existsSync(filePath), false);
      assert.deepStrictEqual(fs.readdirSync(path.dirname(filePath)), []);

      persistCanonicalSnapshot(first, options);
      const recovered = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      assert.deepStrictEqual(recovered.latest, first);
      assert.strictEqual(recovered.history.length, 1);
    } finally {
      fs.rmSync(recordingDir, { recursive: true, force: true });
    }
  });
}

/** The single published recording under a private fixture directory. */
function findOnlyRecording(directory) {
  const found = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && entry.name.endsWith('.json')) found.push(child);
    }
  };
  walk(directory);
  assert.strictEqual(found.length, 1, `expected one recording, found ${found.length}`);
  return found[0];
}

/** Inspect or adjust the published recording through one opened handle. */
function withSavedRecording(filePath, inspect) {
  const fd = fs.openSync(filePath, 'r');
  try {
    return inspect(fd);
  } finally {
    fs.closeSync(fd);
  }
}

if (process.platform !== 'win32') {
  test('recording publication preserves creation umask and existing POSIX permissions', () => {
    const recordingDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-recording-mode-')));
    try {
      const options = { recordingDir, loadStateStoreImpl: () => null };
      const first = snapshot('Initial permissions');
      persistCanonicalSnapshot(first, options);
      // Locate the published file inside this test's private directory so the
      // path never derives from the library's shared-temp default.
      const filePath = findOnlyRecording(recordingDir);
      assert.strictEqual(path.basename(filePath), path.basename(getFallbackSessionRecordingPath(first, options)));
      withSavedRecording(filePath, fd => {
        assert.strictEqual(fs.fstatSync(fd).mode & 0o777, 0o666 & ~process.umask());
      });

      for (const mode of [0o600, 0o640, 0o660]) {
        withSavedRecording(filePath, fd => fs.fchmodSync(fd, mode));
        const next = snapshot(`Permissions ${mode.toString(8)}`);
        const originalWrite = fs.writeFileSync;
        const observedModes = [];
        fs.writeFileSync = (destination, contents) => {
          assert.strictEqual(typeof destination, 'number', 'staging must write through a descriptor');
          const readMode = () => fs.fstatSync(destination).mode & 0o777;
          observedModes.push(readMode());
          fs.writeSync(destination, contents);
          observedModes.push(readMode());
        };
        try {
          persistCanonicalSnapshot(next, options);
        } finally {
          fs.writeFileSync = originalWrite;
        }
        assert.strictEqual(observedModes.length, 2);
        for (const observed of observedModes) {
          assert.strictEqual(observed & ~mode, 0, 'staging must not grant permissions absent from the saved recording');
        }
        withSavedRecording(filePath, fd => {
          assert.strictEqual(fs.fstatSync(fd).mode & 0o777, mode);
          assert.deepStrictEqual(JSON.parse(fs.readFileSync(fd, 'utf8')).latest, next);
        });
      }
    } finally {
      fs.rmSync(recordingDir, { recursive: true, force: true });
    }
  });
}

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
