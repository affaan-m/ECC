'use strict';

/**
 * Private staging helpers enforcing owner-only permissions from the very first
 * filesystem creation/write (avoiding permissive-umask windows before chmod).
 * Issue #3875.
 */

const fs = require('fs');
const path = require('path');

function createPrivateStagingDir(dirPath) {
  const resolved = path.resolve(dirPath);
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    fs.chmodSync(resolved, 0o700);
  }
  return resolved;
}

function writePrivateStagingFile(targetPath, content) {
  const resolved = path.resolve(targetPath);
  createPrivateStagingDir(path.dirname(resolved));
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(resolved, flags, 0o600);
  try {
    if (process.platform !== 'win32') {
      fs.fchmodSync(fd, 0o600);
    }
    fs.writeFileSync(fd, content, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
  return resolved;
}

module.exports = {
  createPrivateStagingDir,
  writePrivateStagingFile,
};
