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

  fs.mkdirSync(parentDir, { recursive: true });

  let descriptor;
  try {
    descriptor = fs.openSync(tempPath, 'wx', mode);
    fs.writeFileSync(descriptor, content, { encoding: options.encoding || 'utf8' });
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(tempPath, resolvedPath);
  } catch (error) {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
    fs.rmSync(tempPath, { force: true });
    throw error;
  }

  return resolvedPath;
}

module.exports = {
  writeFileAtomic,
};
