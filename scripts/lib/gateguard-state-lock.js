'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 10;
const waitArray = new Int32Array(new SharedArrayBuffer(4));

function waitForRetry() {
  Atomics.wait(waitArray, 0, 0, LOCK_RETRY_MS);
}

function readOwner(lockPath) {
  try {
    const stat = fs.lstatSync(lockPath);
    if (stat.isSymbolicLink()) return null;
    const ownerPath = stat.isDirectory() ? path.join(lockPath, 'owner.json') : lockPath;
    return JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
  } catch (_err) {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function isStaleLock(lockDir) {
  let stat;
  try {
    stat = fs.lstatSync(lockDir);
  } catch (_err) {
    return false;
  }
  if (stat.isSymbolicLink()) return false;

  if (stat.isDirectory()) {
    try {
      const entries = fs.readdirSync(lockDir);
      if (entries.length !== 1 || entries[0] !== 'owner.json') return false;
    } catch (_err) {
      return false;
    }
  }

  const owner = readOwner(lockDir);
  if (owner && Number.isInteger(owner.pid)) {
    return !isProcessAlive(owner.pid);
  }

  return false;
}

function reclaimStaleLock(lockDir) {
  let reclaimed = false;
  try {
    withStateFileLock(`${lockDir}.recovery`, () => {
      if (!isStaleLock(lockDir)) return;
      fs.rmSync(lockDir, { recursive: true, force: true });
      reclaimed = true;
    });
  } catch (_err) {
    return false;
  }
  return reclaimed;
}

/**
 * Runs a synchronous state-file transaction while holding an inter-process lock.
 * @param {string} lockPath Path used as the lock directory.
 * @param {() => any} callback Synchronous read/merge/write transaction.
 * @returns {any} The callback result.
 */
function withStateFileLock(lockPath, callback) {
  const resolvedLockPath = path.resolve(lockPath);
  const owner = {
    pid: process.pid,
    token: crypto.randomBytes(16).toString('hex'),
    createdAt: Date.now()
  };
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  fs.mkdirSync(path.dirname(resolvedLockPath), { recursive: true });

  while (true) {
    const claimPath = `${resolvedLockPath}.claim.${process.pid}.${crypto.randomBytes(16).toString('hex')}`;
    try {
      // Hard-linking a fully-written owner file publishes lock and ownership
      // metadata in one atomic operation, so contenders never see a partial lock.
      fs.writeFileSync(claimPath, JSON.stringify(owner), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.linkSync(claimPath, resolvedLockPath);
      try { fs.unlinkSync(claimPath); } catch (_cleanupErr) { /* claim is harmless after publication */ }
      break;
    } catch (err) {
      try { fs.unlinkSync(claimPath); } catch (_cleanupErr) { /* ignore */ }
      const lockExists = fs.existsSync(resolvedLockPath);
      if (!err || (!['EEXIST', 'ENOTEMPTY', 'EISDIR', 'ENOTDIR'].includes(err.code) && !lockExists)) {
        throw err;
      }

      if (reclaimStaleLock(resolvedLockPath)) continue;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out acquiring GateGuard state lock: ${resolvedLockPath}`);
      }
      waitForRetry();
    }
  }

  try {
    return callback();
  } finally {
    const currentOwner = readOwner(resolvedLockPath);
    if (currentOwner && currentOwner.token === owner.token) {
      fs.rmSync(resolvedLockPath, { recursive: true, force: true });
    }
  }
}

module.exports = { withStateFileLock, isStaleLock };
