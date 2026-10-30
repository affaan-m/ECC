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

function renameAtomic(tempPath, resolvedPath, options) {
  // Concurrent Windows installers can hold replacement sharing locks beyond
  // the reader's shorter retry budget. Keep publication bounded to two seconds.
  const deadline = performance.now() + 2000;
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
        || attempts >= 81 || remaining <= 0) throw error;
      sleeper ||= new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(sleeper, 0, 0, Math.min(25, remaining));
    }
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
    descriptor = fs.openSync(tempPath, 'wx', mode);
    if (options.validateParent) options.validateParent();
    fs.writeFileSync(descriptor, content, { encoding: options.encoding || 'utf8' });
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
