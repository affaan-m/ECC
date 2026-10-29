'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { sameFileIdentity } = require('./claude-settings-lock');

function snapshotExpectedContent(expectedContent) {
  if (expectedContent === undefined) return undefined;
  if (expectedContent && expectedContent.kind === 'absent') {
    return Object.freeze({ kind: 'absent' });
  }
  if (expectedContent && expectedContent.kind === 'sha256'
    && typeof expectedContent.digest === 'string' && /^[a-f0-9]{64}$/i.test(expectedContent.digest)) {
    return Object.freeze({ kind: 'sha256', digest: expectedContent.digest.toLowerCase() });
  }
  throw new TypeError('Invalid expectedContent for guarded write.');
}

function changedDestination(action, filePath, expectedContent, cause) {
  const message = expectedContent
    ? `Refusing OpenCode hook deactivation: activation changed after preflight at ${filePath}`
    : `Refusing to ${action}: managed destination changed during the write.`;
  const error = new Error(message);
  if (cause) {
    error.cause = cause;
    if (cause.code) error.code = cause.code;
  }
  return error;
}

function writeFileNoFollow(filePath, content, {
  mode,
  action = 'write managed file',
  validateDestination,
  expectedContent: requestedContent,
} = {}) {
  if (typeof validateDestination !== 'function') {
    throw new TypeError('writeFileNoFollow requires validateDestination.');
  }
  const destination = path.resolve(filePath);
  const expectedContent = snapshotExpectedContent(requestedContent);
  const bytes = typeof content === 'string' ? Buffer.from(content) : content;
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Managed file content must be a string or Buffer.');
  const changed = cause => changedDestination(action, destination, expectedContent, cause);
  function validatePath() {
    const validated = validateDestination(destination);
    if (typeof validated !== 'string' || path.resolve(validated) !== destination) throw changed();
  }
  function parentStats() {
    const stats = fs.lstatSync(path.dirname(destination), { bigint: true });
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw changed();
    return stats;
  }
  validatePath();
  const parent = parentStats();
  const flags = (expectedContent ? fs.constants.O_RDWR : fs.constants.O_WRONLY)
    | (!expectedContent || expectedContent.kind === 'absent' ? fs.constants.O_CREAT : 0)
    | (expectedContent && expectedContent.kind === 'absent' ? fs.constants.O_EXCL : 0)
    | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fs.openSync(destination, flags, mode);
  } catch (error) {
    if (expectedContent) throw changed(error);
    throw error;
  }
  function assertPinned() {
    validatePath();
    const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
    const liveStat = fs.lstatSync(destination, { bigint: true });
    if (!sameFileIdentity(parent, parentStats()) || !descriptorStat.isFile()
      || !liveStat.isFile() || liveStat.isSymbolicLink() || !sameFileIdentity(descriptorStat, liveStat)) {
      throw changed();
    }
    return descriptorStat;
  }
  let primaryError;
  try {
    const before = assertPinned();
    if (expectedContent && expectedContent.kind === 'absent' && before.size !== 0n) throw changed();
    if (expectedContent && expectedContent.kind === 'sha256') {
      const digest = crypto.createHash('sha256').update(fs.readFileSync(descriptor)).digest('hex');
      const after = assertPinned();
      if (!sameFileIdentity(before, after) || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
        || digest !== expectedContent.digest) throw changed();
    }
    // Observed changes are rejected before truncation. This is not a CAS against
    // arbitrary editors: callers coordinate participating writers with a lease.
    fs.ftruncateSync(descriptor, 0);
    for (let offset = 0; offset < bytes.length;) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (!Number.isInteger(written) || written <= 0 || written > bytes.length - offset) {
        throw new Error(`Refusing to ${action}: file write made no valid progress.`);
      }
      offset += written;
    }
    if (mode !== undefined) fs.fchmodSync(descriptor, mode);
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      fs.closeSync(descriptor);
    } catch (error) {
      if (primaryError) primaryError.closeError = error;
      else primaryError = error;
    }
  }
  // An exclusive creation that later fails is not unlinked: the pathname may
  // already belong to another writer. Keep the refusal visible to the caller.
  if (primaryError) throw primaryError;
}

module.exports = { writeFileNoFollow };
