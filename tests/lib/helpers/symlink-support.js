'use strict';

const fs = require('fs');

const UNSUPPORTED_CODES = new Set(['EPERM', 'EACCES', 'ENOSYS']);

// Creating symlinks needs Developer Mode or admin rights on Windows, and some
// filesystems have no symlink support at all. Returns false (after logging a
// skip notice) when the OS refuses; rethrows anything else.
//
// deps follows the injection shape collectResources already uses, so the
// refusal branches can be driven without replacing methods on the shared fs
// and console objects.
function trySymlink(target, linkPath, type, deps = {}) {
  try {
    (deps.symlinkSync || fs.symlinkSync)(target, linkPath, type);
    return true;
  } catch (error) {
    if (!UNSUPPORTED_CODES.has(error.code)) throw error;
    (deps.log || console.log)('    (symlink unsupported on this platform; skipping)');
    return false;
  }
}

module.exports = { trySymlink };
