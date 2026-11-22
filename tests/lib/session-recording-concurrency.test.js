'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { acquireSettingsLock } = require('../../scripts/lib/install/claude-settings-lock');
const {
  getFallbackSessionRecordingPath,
  normalizeClaudeHistorySession,
  persistCanonicalSnapshot,
} = require('../../scripts/lib/session-adapters/canonical-session');

function snapshot(title, id = 'shared-recording') {
  return normalizeClaudeHistorySession({
    shortId: id,
    sessionPath: '/fixture/session.tmp',
    metadata: { title },
  }, { type: 'claude-history', value: id });
}

async function withPausedWriter(title, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-recording-concurrency-'));
  const recordingDir = path.join(root, 'recordings');
  const options = { recordingDir, loadStateStoreImpl: () => null };
  const initial = snapshot('Initial state');
  let child;
  let done;
  try {
    persistCanonicalSnapshot(initial, options);
    const recordingPath = getFallbackSessionRecordingPath(initial, options);
    child = spawn(process.execPath, [
      path.join(__dirname, 'helpers', 'session-recording-worker.js'), recordingDir, root, title,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal, stderr }));
    });
    done.catch(() => {});
    const deadline = performance.now() + 10000;
    while (!fs.existsSync(path.join(root, 'read'))) {
      if (child.exitCode !== null || performance.now() >= deadline) {
        throw new Error(`Writer did not read the initial recording: ${stderr}`);
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await callback({ options, recordingPath, initial, done,
      release: () => fs.writeFileSync(path.join(root, 'release'), '') });
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (done) await done;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function publishContending(snapshotValue, options, recordingPath, release) {
  const originalLink = fs.linkSync;
  let contended = false;
  fs.linkSync = function (source, target) {
    try { return originalLink.apply(this, arguments); }
    catch (error) {
      if (target === `${recordingPath}.ecc.lock` && error.code === 'EEXIST') {
        contended = true;
        release();
      }
      throw error;
    }
  };
  try {
    persistCanonicalSnapshot(snapshotValue, options);
  } finally {
    fs.linkSync = originalLink;
    // The original implementation has no lock attempt. Let its paused writer
    // finish after the second successful publication to expose the lost update.
    release();
  }
  return contended;
}

const cases = [
  ['concurrent processes preserve both successfully saved history transitions', () =>
    withPausedWriter('First transition', async ({ options, recordingPath, initial, done, release }) => {
      const next = snapshot('Second transition');
      const initialCreatedAt = JSON.parse(fs.readFileSync(recordingPath, 'utf8')).createdAt;
      const contended = publishContending(next, options, recordingPath, release);
      const result = await done;
      assert.strictEqual(result.code, 0, result.stderr);
      const saved = JSON.parse(fs.readFileSync(recordingPath, 'utf8'));
      assert.deepStrictEqual(saved.history.map(entry => entry.snapshot), [initial, snapshot('First transition'), next]);
      assert.deepStrictEqual(saved.latest, next);
      assert.strictEqual(saved.createdAt, initialCreatedAt);
      assert.strictEqual(contended, true, 'the second process must wait for the real owner');
      assert.deepStrictEqual(fs.readdirSync(path.dirname(recordingPath)), [path.basename(recordingPath)]);
    })],
  ['concurrent identical snapshots retain one changed history entry', () =>
    withPausedWriter('Same transition', async ({ options, recordingPath, initial, done, release }) => {
      const next = snapshot('Same transition');
      publishContending(next, options, recordingPath, release);
      const result = await done;
      assert.strictEqual(result.code, 0, result.stderr);
      const saved = JSON.parse(fs.readFileSync(recordingPath, 'utf8'));
      assert.deepStrictEqual(saved.history.map(entry => entry.snapshot), [initial, next]);
      assert.deepStrictEqual(saved.latest, next);
    })],
  ['an unrelated session can save while the first recording writer is paused', () =>
    withPausedWriter('First transition', async ({ options, recordingPath, done, release }) => {
      const separate = snapshot('Independent session', 'other-recording');
      persistCanonicalSnapshot(separate, options);
      const otherPath = getFallbackSessionRecordingPath(separate, options);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(otherPath, 'utf8')).latest, separate);
      assert.strictEqual(JSON.parse(fs.readFileSync(recordingPath, 'utf8')).latest.workers[0].label, 'Initial state');
      release();
      const result = await done;
      assert.strictEqual(result.code, 0, result.stderr);
    })],
  ['a bounded lock timeout leaves committed history intact and permits a later retry', () => {
    const recordingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-recording-busy-'));
    const initial = snapshot('Initial state');
    const options = { recordingDir, loadStateStoreImpl: () => null, lockTimeoutMs: 20 };
    const recordingPath = getFallbackSessionRecordingPath(initial, options);
    let release;
    try {
      persistCanonicalSnapshot(initial, options);
      const before = fs.readFileSync(recordingPath, 'utf8');
      release = acquireSettingsLock(recordingPath);
      assert.throws(() => persistCanonicalSnapshot(snapshot('Retry state'), options), /Another ECC process.*session recording/);
      assert.strictEqual(fs.readFileSync(recordingPath, 'utf8'), before);
      release();
      release = null;
      persistCanonicalSnapshot(snapshot('Retry state'), options);
      assert.strictEqual(JSON.parse(fs.readFileSync(recordingPath, 'utf8')).history.length, 2);
      assert.deepStrictEqual(fs.readdirSync(path.dirname(recordingPath)), [path.basename(recordingPath)]);
    } finally {
      if (release) release();
      fs.rmSync(recordingDir, { recursive: true, force: true });
    }
  }],
];

(async () => {
  let passed = 0;
  let failed = 0;
  for (const [name, run] of cases) {
    try { await run(); passed++; console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
  }
  console.log(`Results: Passed: ${passed}, Failed: ${failed}`);
  process.exitCode = failed ? 1 : 0;
})();
