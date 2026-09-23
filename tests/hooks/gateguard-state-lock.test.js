'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { withStateFileLock, isStaleLock } = require('../../scripts/lib/gateguard-state-lock');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-state-lock-'));
let passed = 0;
let failed = 0;

async function test(name, run) {
  try {
    await run();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed += 1;
  }
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Lock worker exited with status ${code}`));
    });
  });
}

async function run() {
  await test('serializes state updates across hook processes', async () => {
    const stateFile = path.join(tempDir, 'counter.json');
    const modulePath = path.resolve(__dirname, '../../scripts/lib/gateguard-state-lock.js');
    const workerCode = [
      "const fs = require('fs');",
      `const { withStateFileLock } = require(${JSON.stringify(modulePath)});`,
      'const stateFile = process.argv[1];',
      "withStateFileLock(`${stateFile}.lock`, () => {",
      "  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));",
      '  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);',
      "  fs.writeFileSync(stateFile, JSON.stringify({ count: state.count + 1 }));",
      '});'
    ].join('\n');
    fs.writeFileSync(stateFile, JSON.stringify({ count: 0 }));

    const children = Array.from({ length: 6 }, () => spawn(process.execPath, ['-e', workerCode, stateFile]));
    await Promise.all(children.map(waitForExit));

    assert.strictEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')).count, 6);
    assert.strictEqual(fs.existsSync(`${stateFile}.lock`), false);
  });

  await test('does not expose a lock before owner metadata is ready', async () => {
    const lockPath = path.join(tempDir, 'partial-owner.json.lock');
    const stateFile = path.join(tempDir, 'partial-owner.json');
    const barrier = path.join(tempDir, 'owner-write-started');
    const modulePath = path.resolve(__dirname, '../../scripts/lib/gateguard-state-lock.js');
    const workerCode = [
      'const fs = require("fs");',
      'const Atomics = global.Atomics;',
      `const { withStateFileLock } = require(${JSON.stringify(modulePath)});`,
      'const barrier = process.argv[1];',
      'const lockPath = process.argv[2];',
      'const stateFile = process.argv[3];',
      'const wait = new Int32Array(new SharedArrayBuffer(4));',
      'while (!fs.existsSync(barrier)) Atomics.wait(wait, 0, 0, 5);',
      'withStateFileLock(lockPath, () => {',
      '  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));',
      '  state.count += 1;',
      '  fs.writeFileSync(stateFile, JSON.stringify(state));',
      '});'
    ].join('\n');
    fs.writeFileSync(stateFile, JSON.stringify({ count: 0 }));
    const child = spawn(process.execPath, ['-e', workerCode, barrier, lockPath, stateFile]);
    const childExit = waitForExit(child);
    const originalWriteFileSync = fs.writeFileSync;
    let pausedBeforePublication = false;

    fs.writeFileSync = function patchedWriteFileSync(target, ...args) {
      const isClaimFile = String(target).includes(`.claim.${process.pid}.`);
      const isLegacyOwnerFile = target === path.join(lockPath, 'owner.json');
      if (!pausedBeforePublication && (isClaimFile || isLegacyOwnerFile)) {
        pausedBeforePublication = true;
        fs.writeFileSync(barrier, 'ready');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
        if (isLegacyOwnerFile) return originalWriteFileSync.call(this, target, ...args);
      }
      return originalWriteFileSync.call(this, target, ...args);
    };

    try {
      withStateFileLock(lockPath, () => {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        state.count += 1;
        fs.writeFileSync(stateFile, JSON.stringify(state));
      });
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }

    await childExit;
    assert.strictEqual(pausedBeforePublication, true);
    assert.strictEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')).count, 2);
  });

  await test('reclaims a lock owned by a process that no longer exists', () => {
    const lockPath = path.join(tempDir, 'orphaned.json.lock');
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({ pid: 2147483647, token: 'orphaned' }));
    const oldDate = new Date(0);
    fs.utimesSync(lockPath, oldDate, oldDate);

    let callbackRan = false;
    withStateFileLock(lockPath, () => {
      callbackRan = true;
    });

    assert.strictEqual(callbackRan, true);
    assert.strictEqual(fs.existsSync(lockPath), false);
  });

  await test('does not classify an unrelated directory as a stale lock', () => {
    const lockPath = path.join(tempDir, 'occupied-by-user-data.lock');
    fs.mkdirSync(lockPath);
    const sentinelPath = path.join(lockPath, 'keep.txt');
    fs.writeFileSync(sentinelPath, 'user data');
    const oldDate = new Date(0);
    fs.utimesSync(lockPath, oldDate, oldDate);

    assert.strictEqual(isStaleLock(lockPath), false);
    assert.strictEqual(fs.readFileSync(sentinelPath, 'utf8'), 'user data');

    const orphanFilePath = path.join(tempDir, 'occupied-by-file.lock');
    fs.writeFileSync(orphanFilePath, 'unrelated file');
    fs.utimesSync(orphanFilePath, oldDate, oldDate);
    assert.strictEqual(isStaleLock(orphanFilePath), false);
    assert.strictEqual(fs.readFileSync(orphanFilePath, 'utf8'), 'unrelated file');
  });

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log(`\nState lock test summary: Passed: ${passed}, Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

run();
