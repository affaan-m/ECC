'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

/** Assert the final private fixture path still names the expected file and bytes. */
function assertFilePostimage(filePath, expectedIdentity, expectedContent, fileSystem = fs) {
  const fd = fileSystem.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0), 0o600);
  let failed = false;
  let failure;
  try {
    const before = fileSystem.fstatSync(fd, { bigint: true });
    assert.ok(before.isFile(), 'postimage must be a regular file');
    for (const field of ['dev', 'ino', 'mode']) {
      assert.equal(before[field], expectedIdentity[field], `postimage ${field} must match`);
    }
    const bytes = fileSystem.readFileSync(fd);
    const after = fileSystem.fstatSync(fd, { bigint: true });
    const currentPath = fileSystem.lstatSync(filePath, { bigint: true });
    assert.ok(currentPath.isFile() && !currentPath.isSymbolicLink(), 'postimage path must remain a regular file');
    for (const field of ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs']) {
      assert.equal(after[field], before[field], `postimage ${field} changed during read`);
      assert.equal(currentPath[field], after[field], `postimage path ${field} must match the descriptor`);
    }
    assert.deepEqual(bytes, Buffer.from(expectedContent), 'postimage bytes must match');
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    fileSystem.closeSync(fd);
  } catch (error) {
    if (!failed) throw error;
  }
  if (failed) throw failure;
}

module.exports = { assertFilePostimage };
