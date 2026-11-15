'use strict';

const fs = require('fs');
const os = require('os');
const { performance } = require('perf_hooks');

const WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));
const DEFAULT_TIMEOUT_MS = 5000;

const CLEANUP_ERRORS = new WeakMap();
const EMPTY_CLEANUP_ERRORS = Object.freeze({});

// Preserve the original throw's identity and properties, including frozen errors
// and proxies. Primitive throws cannot own diagnostics and are left unchanged.
function recordCleanupError(primary, name, secondary) {
  if (primary === null || (typeof primary !== 'object' && typeof primary !== 'function')) return;
  CLEANUP_ERRORS.set(primary, Object.freeze({ ...getCleanupErrors(primary), [name]: secondary }));
}

// Frozen snapshots are local to this module instance; they do not cross workers.
function getCleanupErrors(primary) {
  return CLEANUP_ERRORS.get(primary) || EMPTY_CLEANUP_ERRORS;
}

function hasCode(error, code) {
  try { return error !== null && error !== undefined && error.code === code; }
  catch (_error) { return false; }
}

function sameIdentity(left, right) {
  if (left.ino !== right.ino) return false;
  // Windows path stats can omit the volume serial (dev = 0) even when fstat
  // reports it. Keep device checks strict elsewhere and when both are known.
  if (process.platform === 'win32' && (left.dev === 0n || right.dev === 0n)) return true;
  return left.dev === right.dev;
}

function lostLock(lockPath) {
  return Object.assign(new Error(`State-store lock changed or lost; refusing to remove it: ${lockPath}`),
    { code: 'STATE_STORE_LOCK_LOST' });
}

function releaseOwnedLock(lockPath, descriptor, identity) {
  let failed = false;
  let primary;
  let pendingDelete = false;
  let inspected = false;
  let closeFailed = false;
  try {
    const current = fs.lstatSync(lockPath, { bigint: true });
    inspected = true;
    if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(identity, current)) {
      throw lostLock(lockPath);
    }
    // Keep the owned descriptor through validation and unlink. This cooperative
    // lock is not an atomic compare-and-unlink against a directory mutator.
    fs.unlinkSync(lockPath);
  } catch (error) {
    failed = true;
    primary = hasCode(error, 'ENOENT') ? lostLock(lockPath) : error;
    pendingDelete = !inspected && hasCode(error, 'EPERM');
  }
  try {
    fs.closeSync(descriptor); // Exactly one attempt, even after a release failure.
  } catch (error) {
    closeFailed = true;
    if (failed) recordCleanupError(primary, 'closeError', error);
    else { failed = true; primary = error; }
  }
  if (pendingDelete && !closeFailed) {
    // Windows can defer deletion until the handle closes. Only a subsequent
    // ENOENT proves loss; preserve genuine EPERM and never unlink after close.
    try { fs.lstatSync(lockPath, { bigint: true }); }
    catch (error) { if (hasCode(error, 'ENOENT')) primary = lostLock(lockPath); }
  }
  if (failed) throw primary;
}

function acquireLock(dbPath, timeoutMs) {
  const lockPath = `${dbPath}.ecc-state.lock`;
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    let descriptor;
    try {
      descriptor = fs.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      // Windows may report EPERM while the previous owner's unlinked file is
      // pending deletion. Retry exclusive creation within the same deadline.
      const retryablePermissionError = process.platform === 'win32' && hasCode(error, 'EPERM');
      if (!hasCode(error, 'EEXIST') && !retryablePermissionError) throw error;
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        // EPERM can also mean genuine access denial; preserve its diagnostics
        // rather than advising the caller to remove a possibly unrelated lock.
        if (retryablePermissionError) throw error;
        const busy = new Error(`State store is busy: ${dbPath}. Retry after the other ECC operation finishes. `
          + `If an operation terminated unexpectedly, stop all ECC processes using this database, `
          + `then inspect and remove the leftover lock: ${lockPath}`);
        busy.code = 'STATE_STORE_BUSY';
        throw busy;
      }
      Atomics.wait(WAIT_BUFFER, 0, 0, Math.min(20, remaining));
      continue;
    }
    let identity;
    try {
      identity = fs.fstatSync(descriptor, { bigint: true });
      fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, hostname: os.hostname() })}\n`);
    } catch (error) {
      try {
        if (identity) releaseOwnedLock(lockPath, descriptor, identity);
        else fs.closeSync(descriptor);
      } catch (releaseError) {
        recordCleanupError(error, 'releaseError', releaseError);
      }
      throw error;
    }
    return () => releaseOwnedLock(lockPath, descriptor, identity);
  }
}

/** Serialize one synchronous snapshot operation, never a handle's lifetime.
 * Locks are not expired or stolen: a paused writer must not lose exclusivity.
 * An abnormal process exit can leave a lock requiring the explicit recovery
 * described by STATE_STORE_BUSY. No database bytes are changed on timeout. */
function withStateStoreLock(dbPath, callback, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const release = acquireLock(dbPath, timeoutMs);
  let result;
  let primaryError;
  let failed = false;
  try {
    result = callback();
  } catch (error) {
    failed = true;
    primaryError = error;
  }
  try {
    release();
  } catch (releaseError) {
    if (!failed) throw releaseError;
    recordCleanupError(primaryError, 'releaseError', releaseError);
  }
  if (failed) throw primaryError;
  return result;
}

module.exports = { withStateStoreLock, recordCleanupError, getCleanupErrors };
