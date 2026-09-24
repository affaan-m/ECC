'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { assertWithinTrustedRoot } = require('../path-safety');

function isCodexUserConfig(plan, operation) {
  if (plan.adapter.id !== 'codex-home' || operation.kind !== 'copy-file') {
    return false;
  }
  const relativePath = path.relative(plan.targetRoot, operation.destinationPath);
  const name = process.platform === 'win32' ? relativePath.toLowerCase() : relativePath;
  return name === 'config.toml' || name === (process.platform === 'win32' ? 'agents.md' : 'AGENTS.md');
}

function readConfigDigest(plan, destinationPath) {
  assertWithinTrustedRoot(destinationPath, plan.targetRoot, 'inspect Codex user configuration');
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(destinationPath, flags);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const current = fs.lstatSync(destinationPath, { bigint: true });
    if (!opened.isFile() || !current.isFile() || current.isSymbolicLink()
      || opened.ino !== current.ino || opened.dev !== current.dev) {
      throw new Error(`Refusing to inspect changed Codex configuration: ${destinationPath}`);
    }
    assertWithinTrustedRoot(destinationPath, plan.targetRoot, 'inspect Codex user configuration');
    return crypto.createHash('sha256').update(fs.readFileSync(descriptor)).digest('hex');
  } finally {
    fs.closeSync(descriptor);
  }
}

function hasEditedCodexUserConfig(plan, operation, previousOperation) {
  if (!isCodexUserConfig(plan, operation)) {
    return false;
  }
  let digest;
  try {
    digest = readConfigDigest(plan, operation.destinationPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false; // A missing scaffold can still be restored.
    }
    throw error;
  }
  // Compare with the bytes ECC actually installed, never the newest template.
  // Old ledgers without a digest cannot prove that an existing file is unchanged.
  const recorded = previousOperation && previousOperation.contentSha256;
  return !/^[a-f0-9]{64}$/i.test(recorded || '') || digest !== recorded.toLowerCase();
}

module.exports = { hasEditedCodexUserConfig, isCodexUserConfig };
