'use strict';

const fs = require('fs');

const UNSUPPORTED_CODES = new Set(['EPERM', 'EACCES', 'ENOSYS']);

// Creating symlinks needs Developer Mode or admin rights on Windows. Returns
// false (after logging a skip notice) when the OS refuses; rethrows anything else.
function trySymlink(target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    if (!UNSUPPORTED_CODES.has(error.code)) throw error;
    console.log('    (symlink unsupported on this platform; skipping)');
    return false;
  }
}

module.exports = { trySymlink };
