'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Native Windows replacement can temporarily deny a reader's open as well as
// a writer's rename. Retry only sharing errors, never missing files or parsing.
function readFileWithSharingRetry(filePath, options) {
  const deadline = performance.now() + 750;
  let attempts = 0;
  let sleeper;
  while (true) {
    try {
      return fs.readFileSync(filePath, options);
    } catch (error) {
      attempts++;
      const remaining = deadline - performance.now();
      if (process.platform !== 'win32'
        || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)
        || attempts >= 21 || remaining <= 0) throw error;
      sleeper ||= new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(sleeper, 0, 0, Math.min(25, remaining));
    }
  }
}

// Concurrent Windows writers (and real-time antivirus scans of each freshly
// published file) can hold replacement sharing locks for well over a second.
// Fixed-interval retries keep contenders in lockstep, so one writer can lose
// every round until it gives up. Short, fully jittered waits break that
// lockstep; longer (exponential) waits measurably starve the loser further.
const DEFAULT_RENAME_RETRY_BUDGET_MS = 2000;
const RENAME_RETRY_MIN_WAIT_MS = 5;
const RENAME_RETRY_MAX_WAIT_MS = 25;

function renameRetryWaitMs(remaining) {
  const jittered = RENAME_RETRY_MIN_WAIT_MS
    + Math.random() * (RENAME_RETRY_MAX_WAIT_MS - RENAME_RETRY_MIN_WAIT_MS);
  return Math.min(remaining, jittered);
}

function renameAtomic(tempPath, resolvedPath, options) {
  // Keep publication bounded by an elapsed budget (callers that are not on a
  // latency-sensitive hook path may raise it). The attempt cap is only a
  // safety net: size it for the shortest possible wait so it can never end
  // retries before the elapsed budget does.
  const budget = options.renameRetryBudgetMs || DEFAULT_RENAME_RETRY_BUDGET_MS;
  const maxAttempts = Math.ceil(budget / RENAME_RETRY_MIN_WAIT_MS) + 1;
  const deadline = performance.now() + budget;
  let attempts = 0;
  let sleeper;
  while (true) {
    // A sharing violation may outlast the original validation. Recheck both
    // the parent and destination ownership before every publication attempt.
    if (options.validateParent) options.validateParent();
    if (options.beforeRename) options.beforeRename();
    try {
      fs.renameSync(tempPath, resolvedPath);
      return;
    } catch (error) {
      attempts++;
      const remaining = deadline - performance.now();
      if (process.platform !== 'win32'
        || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)
        || attempts >= maxAttempts || remaining <= 0) throw error;
      sleeper ||= new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(sleeper, 0, 0, renameRetryWaitMs(remaining));
    }
  }
}

function readExistingFileMode(filePath) {
  try {
    return fs.statSync(filePath).mode & 0o777;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function writeFileAtomic(filePath, content, options = {}) {
  const resolvedPath = path.resolve(filePath);
  const parentDir = path.dirname(resolvedPath);
  const tempPath = path.join(
    parentDir,
    `.${path.basename(resolvedPath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  );
  const mode = options.mode || 0o600;

  if (options.validateParent) options.validateParent();
  fs.mkdirSync(parentDir, { recursive: true });

  let descriptor;
  try {
    if (options.validateParent) options.validateParent();
    const existingMode = options.preserveExistingMode ? readExistingFileMode(resolvedPath) : undefined;
    descriptor = fs.openSync(tempPath, 'wx', existingMode ?? mode);
    if (options.validateParent) options.validateParent();
    fs.writeFileSync(descriptor, content, { encoding: options.encoding || 'utf8' });
    // Restore existing permissions after writing, without applying the process umask a second time.
    if (existingMode !== undefined) fs.fchmodSync(descriptor, existingMode);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    renameAtomic(tempPath, resolvedPath, options);
  } catch (error) {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
    // If the parent was replaced, this pathname may now name somebody else's
    // file. Leave the private staging file in its original directory.
    let parentUnchanged = true;
    try {
      if (options.validateParent) options.validateParent();
    } catch (_error) {
      parentUnchanged = false;
    }
    if (parentUnchanged) fs.rmSync(tempPath, { force: true });
    throw error;
  }

  return resolvedPath;
}

module.exports = {
  readFileWithSharingRetry,
  writeFileAtomic,
};
