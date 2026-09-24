'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { readInstallState } = require('../install-state');
const { assertWithinTrustedRoot } = require('../path-safety');

const OPENCODE_TARGET = 'opencode';
const INSTALL_STATE_NAME = 'ecc-install-state.json';

function samePath(leftPath, rightPath) {
  const left = path.resolve(leftPath);
  const right = path.resolve(rightPath);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
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

function getLegacyOpencodeLocation(homeDir) {
  const targetRoot = path.join(path.resolve(homeDir), '.opencode');
  return {
    targetRoot,
    installStatePath: path.join(targetRoot, INSTALL_STATE_NAME),
    legacyLayout: 'opencode',
  };
}

function getLegacyLocationForPlan(plan) {
  if (
    !plan
    || plan.adapter?.target !== OPENCODE_TARGET
    || typeof plan.targetRoot !== 'string'
  ) {
    return null;
  }
  if (typeof plan.homeDir === 'string' && plan.homeDir.trim() !== '') {
    return getLegacyOpencodeLocation(plan.homeDir);
  }
  const canonicalRoot = path.resolve(plan.targetRoot);
  if (
    path.basename(canonicalRoot) !== 'opencode'
    || path.basename(path.dirname(canonicalRoot)) !== '.config'
  ) {
    return null;
  }
  return getLegacyOpencodeLocation(path.dirname(path.dirname(canonicalRoot)));
}

function inspectLegacyOpencodeState(location) {
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
    const isOpencode = state.target.target === OPENCODE_TARGET
      || state.target.id === 'opencode-home';
    if (
      !isOpencode
      || !samePath(state.target.root, location.targetRoot)
      || !samePath(state.target.installStatePath, location.installStatePath)
    ) {
      return { status: 'invalid', state: null, error: null };
    }
    return { status: 'valid', state, error: null };
  } catch (error) {
    return {
      status: 'unreadable',
      state: null,
      error: `Unable to inspect legacy OpenCode install-state at ${location.installStatePath}: ${error.message}`,
    };
  }
}

function hashFileNoFollow(filePath) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(filePath, flags);
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) {
      throw new Error(`Refusing to read a non-file at ${filePath}`);
    }
    const content = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const finalPathStat = fs.lstatSync(filePath, { bigint: true });
    const unchanged = before.dev === after.dev
      && before.ino === after.ino
      && before.size === after.size
      && before.mtimeMs === after.mtimeMs
      && before.ctimeMs === after.ctimeMs
      && after.dev === finalPathStat.dev
      && after.ino === finalPathStat.ino
      && after.size === finalPathStat.size
      && after.mtimeMs === finalPathStat.mtimeMs
      && after.ctimeMs === finalPathStat.ctimeMs;
    if (finalPathStat.isSymbolicLink() || !finalPathStat.isFile() || !unchanged) {
      throw new Error(`Refusing to read a file that changed during validation: ${filePath}`);
    }
    return {
      digest: crypto.createHash('sha256').update(content).digest('hex'),
      stat: after,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function removeEmptyParents(startPath, legacyRoot) {
  let currentPath = path.dirname(startPath);
  while (!samePath(currentPath, legacyRoot)) {
    const safePath = assertWithinTrustedRoot(
      currentPath,
      legacyRoot,
      'clean legacy OpenCode install'
    );
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

function verifyManagedLegacyFile(operation, location, sourceRoot) {
  if (operation?.ownership !== 'managed' || operation?.kind !== 'copy-file') {
    return { skipped: true };
  }
  if (
    typeof operation.destinationPath !== 'string'
    || typeof operation.sourceRelativePath !== 'string'
    || !/^[a-f0-9]{64}$/i.test(operation.contentSha256 || '')
  ) {
    return { retainedPath: operation?.destinationPath || location.targetRoot };
  }

  let destinationPath;
  let sourcePath;
  try {
    destinationPath = assertWithinTrustedRoot(
      operation.destinationPath,
      location.targetRoot,
      'migrate legacy OpenCode install'
    );
    sourcePath = assertWithinTrustedRoot(
      path.join(sourceRoot, operation.sourceRelativePath),
      sourceRoot,
      'verify legacy OpenCode source'
    );
  } catch (_error) {
    return { retainedPath: operation.destinationPath };
  }

  let destination;
  try {
    destination = hashFileNoFollow(destinationPath);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return { missing: true };
    }
    return { retainedPath: destinationPath };
  }
  if (destination.digest !== operation.contentSha256.toLowerCase()) {
    return { retainedPath: destinationPath };
  }
  let source;
  try {
    source = hashFileNoFollow(sourcePath);
  } catch (_error) {
    return { retainedPath: destinationPath };
  }
  if (source.digest !== destination.digest) {
    return { retainedPath: destinationPath };
  }
  return { destinationPath, stat: destination.stat };
}

function pathExistsWith(fileSystem, filePath) {
  try {
    fileSystem.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return false;
    }
    throw error;
  }
}

function restoreQuarantinedFileNoClobber(quarantinePath, safePath, fileSystem) {
  try {
    fileSystem.linkSync(quarantinePath, safePath);
  } catch (error) {
    error.retainedPath = quarantinePath;
    throw error;
  }
  try {
    fileSystem.rmSync(quarantinePath);
  } catch (error) {
    error.retainedPath = quarantinePath;
    throw error;
  }
}

function removeVerifiedLegacyFile(entry, location, fileSystem = fs) {
  const safePath = assertWithinTrustedRoot(
    entry.destinationPath,
    location.targetRoot,
    'remove verified legacy OpenCode file'
  );
  const quarantineDir = fileSystem.mkdtempSync(path.join(
    path.dirname(location.targetRoot),
    '.ecc-opencode-remove-'
  ));
  const quarantinePath = path.join(quarantineDir, path.basename(safePath));
  try {
    fileSystem.renameSync(safePath, quarantinePath);
    const quarantinedStat = fileSystem.lstatSync(quarantinePath, { bigint: true });
    const identityMatches = !quarantinedStat.isSymbolicLink()
      && quarantinedStat.isFile()
      && quarantinedStat.dev === entry.stat.dev
      && quarantinedStat.ino === entry.stat.ino;
    if (!identityMatches) {
      const identityError = new Error(
        `Legacy OpenCode file changed during quarantine: ${safePath}`
      );
      identityError.code = 'ESTALE';
      throw identityError;
    }
    fileSystem.rmSync(quarantinePath);
    fileSystem.rmdirSync(quarantineDir);
    return true;
  } catch (error) {
    let restoreError = null;
    try {
      if (pathExistsWith(fileSystem, quarantinePath)) {
        restoreQuarantinedFileNoClobber(quarantinePath, safePath, fileSystem);
      }
      if (
        pathExistsWith(fileSystem, quarantineDir)
        && fileSystem.readdirSync(quarantineDir).length === 0
      ) {
        fileSystem.rmdirSync(quarantineDir);
      }
    } catch (recoveryError) {
      restoreError = recoveryError;
    }
    if (restoreError) {
      restoreError.cause = error;
      throw restoreError;
    }
    throw error;
  }
}

function emptyCleanupResult() {
  return {
    detected: false,
    complete: false,
    removedPaths: [],
    retainedPaths: [],
    warnings: [],
  };
}

function hasTrustedCanonicalState(plan) {
  if (typeof plan.sourceRoot !== 'string' || !pathExists(plan.installStatePath)) {
    return false;
  }
  try {
    const canonicalState = readInstallState(plan.installStatePath);
    return !(
      (canonicalState.target.target !== OPENCODE_TARGET
        && canonicalState.target.id !== 'opencode-home')
      || !samePath(canonicalState.target.root, plan.targetRoot)
      || !samePath(canonicalState.target.installStatePath, plan.installStatePath)
    );
  } catch (_error) {
    return false;
  }
}

function classifyLegacyOperations(inspection, location, sourceRoot) {
  const removable = [];
  const retainedPaths = [];
  for (const operation of inspection.state.operations || []) {
    const verified = verifyManagedLegacyFile(operation, location, sourceRoot);
    if (verified.destinationPath) removable.push(verified);
    else if (verified.retainedPath) retainedPaths.push(verified.retainedPath);
  }
  return { removable, retainedPaths };
}

function removeLegacyFiles(removable, location, retainedPaths) {
  const removedPaths = [];
  for (const entry of removable) {
    try {
      if (!removeVerifiedLegacyFile(entry, location)) {
        retainedPaths.push(entry.destinationPath);
        continue;
      }
      removedPaths.push(entry.destinationPath);
      removeEmptyParents(entry.destinationPath, location.targetRoot);
    } catch (error) {
      retainedPaths.push(entry.destinationPath);
      if (error.retainedPath) retainedPaths.push(error.retainedPath);
    }
  }
  return removedPaths;
}

function finalizeLegacyCleanup(location, retainedPaths, removedPaths) {
  if (retainedPaths.length > 0) return false;
  fs.rmSync(location.installStatePath, { force: true });
  removedPaths.push(location.installStatePath);
  try {
    if (pathExists(location.targetRoot) && fs.readdirSync(location.targetRoot).length === 0) {
      fs.rmdirSync(location.targetRoot);
    }
  } catch (_error) {
    // Removing an empty legacy root is best effort after ownership is cleared.
  }
  return true;
}

function cleanupLegacyOpencodeInstall(plan) {
  const location = getLegacyLocationForPlan(plan);
  const emptyResult = emptyCleanupResult();
  if (!location || !hasTrustedCanonicalState(plan)) return emptyResult;

  const inspection = inspectLegacyOpencodeState(location);
  if (inspection.status === 'unreadable') {
    return {
      ...emptyResult,
      detected: true,
      retainedPaths: [location.targetRoot],
      warnings: [inspection.error],
    };
  }
  if (inspection.status !== 'valid') {
    return emptyResult;
  }

  const { removable, retainedPaths } = classifyLegacyOperations(
    inspection,
    location,
    plan.sourceRoot
  );
  const removedPaths = removeLegacyFiles(removable, location, retainedPaths);
  const complete = finalizeLegacyCleanup(location, retainedPaths, removedPaths);

  return {
    detected: true,
    complete,
    removedPaths,
    retainedPaths: [...new Set(retainedPaths)].sort(),
    warnings: complete
      ? []
      : ['Modified, unsupported, or unverifiable managed files remain under ~/.opencode and were preserved.'],
  };
}

module.exports = {
  cleanupLegacyOpencodeInstall,
  getLegacyOpencodeLocation,
  inspectLegacyOpencodeState,
  removeVerifiedLegacyFile,
};
