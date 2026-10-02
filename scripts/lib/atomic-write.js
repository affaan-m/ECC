'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
    if (options.validateParent) options.validateParent();
    if (options.beforeRename) options.beforeRename();
    fs.renameSync(tempPath, resolvedPath);
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
  writeFileAtomic,
};
