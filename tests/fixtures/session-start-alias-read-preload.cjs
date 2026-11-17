'use strict';

const fs = require('fs');
const atomic = require('../../scripts/lib/atomic-write');
const aliasPath = process.env.ECC_TEST_ALIAS_PATH;
const countPath = process.env.ECC_TEST_ALIAS_FAULT_COUNT;
const errorCode = process.env.ECC_TEST_ALIAS_READ_ERROR;
if (!aliasPath || !countPath || !['EACCES', 'EPERM'].includes(errorCode)) {
  throw new Error('Invalid startup alias-read fixture data');
}

const originalRead = fs.readFileSync;
let denied = 0;
fs.readFileSync = function (file) {
  if (file === aliasPath) {
    denied++;
    throw Object.assign(new Error('injected unreadable aliases'), { code: errorCode });
  }
  return originalRead.apply(this, arguments);
};

// Exercise Windows retry semantics only during this synchronous helper call.
// Restore the actual platform before project detection and other hook work.
const readWithRetry = atomic.readFileWithSharingRetry;
atomic.readFileWithSharingRetry = function (...args) {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  try { return readWithRetry(...args); }
  finally { Object.defineProperty(process, 'platform', platform); }
};
process.on('exit', () => fs.writeFileSync(countPath, JSON.stringify(denied)));
