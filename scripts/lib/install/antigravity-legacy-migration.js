'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { readInstallState } = require('../install-state');
const { assertWithinTrustedRoot } = require('../path-safety');

const ANTIGRAVITY_TARGET = 'antigravity';
const CANONICAL_ROOT_NAME = '.agents';
const LEGACY_ROOT_NAME = '.agent';
const INSTALL_STATE_NAME = 'ecc-install-state.json';

function samePath(leftPath, rightPath) {
  const left = path.resolve(leftPath);
  const right = path.resolve(rightPath);
  if (process.platform === 'win32') {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

function pathExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return false;
    }
    throw error;
  }
}

function getLegacyAntigravityLocation(projectRoot) {
  const targetRoot = path.join(path.resolve(projectRoot), LEGACY_ROOT_NAME);
  return {
    targetRoot,
    installStatePath: path.join(targetRoot, INSTALL_STATE_NAME),
  };
}

function getLegacyLocationForPlan(plan) {
  if (
    !plan
    || !plan.adapter
    || plan.adapter.target !== ANTIGRAVITY_TARGET
    || typeof plan.targetRoot !== 'string'
    || path.basename(path.resolve(plan.targetRoot)) !== CANONICAL_ROOT_NAME
  ) {
    return null;
  }

  return getLegacyAntigravityLocation(path.dirname(path.resolve(plan.targetRoot)));
}

function inspectLegacyAntigravityState(location) {
  if (!location) {
    return { status: 'absent', state: null, error: null };
  }
  try {
    if (!pathExists(location.installStatePath)) {
      return { status: 'absent', state: null, error: null };
    }
    const rootStat = fs.lstatSync(location.targetRoot);
    const stateStat = fs.lstatSync(location.installStatePath);
    if (
      !rootStat.isDirectory()
      || rootStat.isSymbolicLink()
      || !stateStat.isFile()
      || stateStat.isSymbolicLink()
    ) {
      return { status: 'invalid', state: null, error: null };
    }
    const state = readInstallState(location.installStatePath);
    const isAntigravity = state.target.target === ANTIGRAVITY_TARGET
      || state.target.id === 'antigravity-project';
    if (
      !isAntigravity
      || !samePath(state.target.root, location.targetRoot)
      || !samePath(state.target.installStatePath, location.installStatePath)
      || state.operations.some(operation => (
        operation.kind !== 'copy-file'
        || operation.ownership !== 'managed'
      ))
    ) {
      return { status: 'invalid', state: null, error: null };
    }
    return { status: 'valid', state, error: null };
  } catch (error) {
    return {
      status: 'unreadable',
      state: null,
      error: `Unable to inspect legacy Antigravity install-state at ${location.installStatePath}: ${error.message}`,
    };
  }
}

function readValidLegacyAntigravityState(location) {
  const inspection = inspectLegacyAntigravityState(location);
  return inspection.status === 'valid' ? inspection.state : null;
}

function sha256FileNoFollow(filePath) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(filePath, flags);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {
      return null;
    }
    return {
      digest: crypto.createHash('sha256').update(fs.readFileSync(descriptor)).digest('hex'),
      stat,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function getExpectedLegacyDestination(operation, legacyRoot) {
  const sourceRelativePath = String(operation.sourceRelativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  const parts = sourceRelativePath.split('/');
  if (
    path.posix.isAbsolute(sourceRelativePath)
    || path.win32.isAbsolute(sourceRelativePath)
    || parts.some(part => part === '' || part === '.' || part === '..')
  ) {
    return null;
  }

  if (parts[0] === 'rules' && parts.length >= 2) {
    const fileName = parts.length === 2
      ? parts[1]
      : `${parts[1]}-${parts.slice(2).join('-')}`;
    return path.join(legacyRoot, 'rules', fileName);
  }
  if (parts[0] === 'commands' && parts.length >= 2) {
    return path.join(legacyRoot, 'workflows', ...parts.slice(1));
  }
  if (parts[0] === 'agents' && parts.length >= 2) {
    return path.join(legacyRoot, 'skills', ...parts.slice(1));
  }
  if (parts[0] === '.agents' && parts.length >= 2) {
    return path.join(legacyRoot, '.agents', ...parts.slice(1));
  }
  if (sourceRelativePath === 'AGENTS.md') {
    return path.join(legacyRoot, 'AGENTS.md');
  }
  return null;
}

function getVerifiedManagedFile(operation, legacyRoot, sourceRoot) {
  if (
    !operation
    || operation.ownership !== 'managed'
    || operation.kind !== 'copy-file'
    || typeof operation.destinationPath !== 'string'
    || typeof sourceRoot !== 'string'
    || !/^[a-f0-9]{64}$/i.test(operation.contentSha256 || '')
  ) {
    return null;
  }

  let destinationPath;
  let sourcePath;
  try {
    const expectedDestination = getExpectedLegacyDestination(operation, legacyRoot);
    if (!expectedDestination || !samePath(operation.destinationPath, expectedDestination)) {
      return null;
    }
    destinationPath = assertWithinTrustedRoot(
      operation.destinationPath,
      legacyRoot,
      'migrate legacy Antigravity install'
    );
    sourcePath = assertWithinTrustedRoot(
      path.join(sourceRoot, operation.sourceRelativePath),
      sourceRoot,
      'verify legacy Antigravity source'
    );
  } catch (_error) {
    return null;
  }

  if (!pathExists(destinationPath)) {
    return { destinationPath, missing: true };
  }

  const stat = fs.lstatSync(destinationPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return null;
  }

  const destination = sha256FileNoFollow(destinationPath);
  if (
    !destination
    || destination.digest !== operation.contentSha256.toLowerCase()
  ) {
    return null;
  }

  if (!pathExists(sourcePath)) {
    return {
      destinationPath,
      fileStat: destination.stat,
      missing: false,
      retainedReason: 'The current ECC source file is unavailable, so its provenance cannot be revalidated.',
    };
  }

  const source = sha256FileNoFollow(sourcePath);
  if (!source || destination.digest !== source.digest) {
    return {
      destinationPath,
      fileStat: destination.stat,
      missing: false,
      retainedReason: 'The current ECC source differs from the recorded installed content, so the legacy file was preserved.',
    };
  }

  return { destinationPath, fileStat: destination.stat, missing: false };
}

function cleanupResult(overrides = {}) {
  return {
    detected: false,
    complete: false,
    removedPaths: [],
    retainedPaths: [],
    warnings: [],
    ...overrides,
  };
}

function removeEmptyParents(startPath, legacyRoot) {
  let currentPath = path.dirname(startPath);
  while (!samePath(currentPath, legacyRoot)) {
    let safePath;
    try {
      safePath = assertWithinTrustedRoot(
        currentPath,
        legacyRoot,
        'clean legacy Antigravity install'
      );
    } catch (_error) {
      return;
    }
    if (!pathExists(safePath)) {
      currentPath = path.dirname(safePath);
      continue;
    }
    const stat = fs.lstatSync(safePath);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.readdirSync(safePath).length > 0) {
      return;
    }
    fs.rmdirSync(safePath);
    currentPath = path.dirname(safePath);
  }
}

function listLegacyContent(legacyRoot, installStatePath) {
  if (!pathExists(legacyRoot)) {
    return [];
  }

  const content = [];
  const pending = [legacyRoot];
  while (pending.length > 0) {
    const currentPath = pending.pop();
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name);
      if (samePath(entryPath, installStatePath)) {
        continue;
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        pending.push(entryPath);
      } else {
        content.push(entryPath);
      }
    }
  }
  return content;
}

function removeLegacyStateWhenEmpty(location) {
  if (listLegacyContent(location.targetRoot, location.installStatePath).length > 0) {
    return false;
  }

  try {
    fs.rmSync(location.installStatePath, { force: true });
  } catch (_error) {
    return false;
  }
  try {
    if (pathExists(location.targetRoot) && fs.readdirSync(location.targetRoot).length === 0) {
      fs.rmdirSync(location.targetRoot);
    }
  } catch (_error) {
    // Root cleanup is best effort after the legacy state is gone.
  }
  return true;
}

function cleanupLegacyAntigravityInstall(plan) {
  const location = getLegacyLocationForPlan(plan);
  if (!location || typeof plan.sourceRoot !== 'string' || !pathExists(plan.installStatePath)) {
    return cleanupResult();
  }

  try {
    const canonicalState = readInstallState(plan.installStatePath);
    const isCanonicalState = (
      canonicalState.target.target === ANTIGRAVITY_TARGET
      || canonicalState.target.id === 'antigravity-project'
    )
      && samePath(canonicalState.target.root, plan.targetRoot)
      && samePath(canonicalState.target.installStatePath, plan.installStatePath);
    if (!isCanonicalState) {
      return cleanupResult();
    }
  } catch (_error) {
    return cleanupResult();
  }

  const legacyInspection = inspectLegacyAntigravityState(location);
  if (legacyInspection.status === 'unreadable') {
    return cleanupResult({
      detected: true,
      retainedPaths: [location.targetRoot],
      warnings: [legacyInspection.error],
    });
  }
  if (legacyInspection.status !== 'valid') {
    return cleanupResult();
  }
  const legacyState = legacyInspection.state;

  const removedPaths = [];
  const filesToRemove = [];
  const warnings = [];
  for (const operation of legacyState.operations || []) {
    const verified = getVerifiedManagedFile(operation, location.targetRoot, plan.sourceRoot);
    if (!verified) {
      continue;
    }
    if (verified.missing) {
      continue;
    }
    if (verified.retainedReason) {
      warnings.push(`${verified.destinationPath}: ${verified.retainedReason}`);
      continue;
    }
    filesToRemove.push({
      destinationPath: verified.destinationPath,
      fileStat: verified.fileStat,
    });
  }

  for (const { destinationPath, fileStat } of filesToRemove) {
    try {
      const safeDestination = assertWithinTrustedRoot(
        destinationPath,
        location.targetRoot,
        'remove verified legacy Antigravity file'
      );
      const currentStat = fs.lstatSync(safeDestination);
      if (
        currentStat.isSymbolicLink()
        || !currentStat.isFile()
        || currentStat.dev !== fileStat.dev
        || currentStat.ino !== fileStat.ino
      ) {
        continue;
      }
      fs.rmSync(safeDestination);
      removedPaths.push(safeDestination);
      removeEmptyParents(safeDestination, location.targetRoot);
    } catch (_error) {
      // Keep failed deletions tracked in legacy state so a later install can retry.
    }
  }

  let complete = false;
  try {
    complete = removeLegacyStateWhenEmpty(location);
  } catch (_error) {
    complete = false;
  }
  if (complete) {
    removedPaths.push(location.installStatePath);
  }
  let retainedPaths = [];
  if (!complete) {
    try {
      retainedPaths = listLegacyContent(location.targetRoot, location.installStatePath);
    } catch (_error) {
      retainedPaths = [location.targetRoot];
    }
  }
  return cleanupResult({ detected: true, complete, removedPaths, retainedPaths, warnings });
}

module.exports = {
  cleanupLegacyAntigravityInstall,
  getLegacyAntigravityLocation,
  inspectLegacyAntigravityState,
  readValidLegacyAntigravityState,
};
