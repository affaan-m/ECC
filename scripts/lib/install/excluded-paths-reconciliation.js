'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { readInstallState } = require('../install-state');
const { assertWithinTrustedRoot } = require('../path-safety');
const { getInstallTargetAdapter } = require('../install-targets/registry');

/**
 * Upgrade reconciliation for excluded source paths (issue #3116).
 *
 * Adapters can declare `excludedSourcePaths` (today: `.agents` for the Claude
 * and Codex home targets). The exclusion stops new copy operations from being
 * planned, but a home install created before the exclusion still has the
 * copied files on disk and the copy operations recorded in install-state, so
 * doctor keeps reporting drift and repair keeps restoring files the target
 * never reads.
 *
 * prepareExcludedPathsReconciliation runs before the new state is written: it
 * reads the previous install-state and drops the recorded managed operations
 * whose source path is now excluded. completeExcludedPathsReconciliation runs
 * after a successful apply: it removes the files those operations recorded,
 * but only when the recorded content digest still matches, and prunes the
 * emptied directories. Files the state does not own, modified files,
 * symlinks, and anything outside the target root are preserved with a
 * warning.
 */

function comparablePath(filePath) {
  const resolvedPath = path.resolve(filePath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

function getReconcilingAdapter(plan) {
  if (!plan || typeof plan.target !== 'string') {
    return null;
  }
  let adapter;
  try {
    adapter = getInstallTargetAdapter(plan.target);
  } catch {
    return null;
  }
  return adapter && typeof adapter.excludesSourcePath === 'function' ? adapter : null;
}

function isRecordedExcludedManagedOperation(adapter, operation) {
  return Boolean(
    operation
    && operation.ownership === 'managed'
    && typeof operation.destinationPath === 'string'
    && typeof operation.sourceRelativePath === 'string'
    && adapter.excludesSourcePath(operation.sourceRelativePath)
  );
}

function filterStateOperations(state, shouldDrop) {
  if (!state || !Array.isArray(state.operations)) {
    return state;
  }
  return {
    ...state,
    operations: state.operations.filter(operation => !shouldDrop(operation)),
  };
}

function prepareExcludedPathsReconciliation(plan, migration) {
  const adapter = getReconcilingAdapter(plan);
  if (!adapter || !fs.existsSync(plan.installStatePath)) {
    return { ...migration, excludedPathCandidates: [] };
  }

  const previousState = readInstallState(plan.installStatePath);
  const candidates = ((previousState && previousState.operations) || [])
    .filter(operation => isRecordedExcludedManagedOperation(adapter, operation));

  if (candidates.length === 0) {
    return { ...migration, excludedPathCandidates: [] };
  }

  const droppedDestinations = new Set(
    candidates.map(operation => comparablePath(operation.destinationPath))
  );
  const shouldDrop = operation => Boolean(
    operation
    && typeof operation.destinationPath === 'string'
    && droppedDestinations.has(comparablePath(operation.destinationPath))
    && typeof operation.sourceRelativePath === 'string'
    && adapter.excludesSourcePath(operation.sourceRelativePath)
  );

  return {
    ...migration,
    bridgeState: filterStateOperations(migration.bridgeState, shouldDrop),
    finalState: filterStateOperations(migration.finalState, shouldDrop),
    excludedPathCandidates: candidates,
  };
}

function pathExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
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
      && after.dev === finalPathStat.dev
      && after.ino === finalPathStat.ino
      && after.size === finalPathStat.size;
    if (finalPathStat.isSymbolicLink() || !finalPathStat.isFile() || !unchanged) {
      throw new Error(`Refusing to read a file that changed during validation: ${filePath}`);
    }
    return crypto.createHash('sha256').update(content).digest('hex');
  } finally {
    fs.closeSync(descriptor);
  }
}

function removeEmptyParents(startPath, targetRoot) {
  let currentPath = path.dirname(startPath);
  while (comparablePath(currentPath) !== comparablePath(targetRoot)) {
    const safePath = assertWithinTrustedRoot(
      currentPath,
      targetRoot,
      'reconcile excluded install paths'
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

function completeExcludedPathsReconciliation(migration, plan) {
  const candidates = (migration && migration.excludedPathCandidates) || [];
  const removedPaths = [];
  const warnings = [];

  for (const candidate of candidates) {
    if (candidate.kind !== 'copy-file') {
      continue;
    }

    let safePath;
    try {
      safePath = assertWithinTrustedRoot(
        candidate.destinationPath,
        plan.targetRoot,
        'reconcile excluded install paths'
      );
    } catch (error) {
      warnings.push(
        `Preserved previously managed file ${candidate.destinationPath}: ${error.message}`
      );
      continue;
    }

    if (!pathExists(safePath)) {
      continue;
    }

    const stat = fs.lstatSync(safePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      warnings.push(
        `Preserved previously managed file ${safePath}: it is not a regular file; remove it manually if unwanted.`
      );
      continue;
    }

    if (typeof candidate.contentSha256 !== 'string') {
      warnings.push(
        `Preserved previously managed file ${safePath}: the recorded operation has no content digest, so the file cannot be verified unchanged; remove it manually if unwanted.`
      );
      continue;
    }

    let currentDigest;
    try {
      currentDigest = hashFileNoFollow(safePath);
    } catch (error) {
      warnings.push(`Preserved previously managed file ${safePath}: ${error.message}`);
      continue;
    }

    if (currentDigest !== candidate.contentSha256.toLowerCase()) {
      warnings.push(
        `Preserved previously managed file ${safePath}: content changed after install; remove it manually if unwanted.`
      );
      continue;
    }

    fs.unlinkSync(safePath);
    removedPaths.push(safePath);
    removeEmptyParents(safePath, plan.targetRoot);
  }

  return { removedPaths, warnings };
}

module.exports = {
  completeExcludedPathsReconciliation,
  prepareExcludedPathsReconciliation,
};
