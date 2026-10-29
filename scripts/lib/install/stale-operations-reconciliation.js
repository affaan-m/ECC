'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { assertWithinTrustedRoot } = require('../path-safety');
const { isHookRuntimeOperation } = require('./hook-consent');

/**
 * Stale managed copy-file reconciliation (issue #3232).
 *
 * Install-state is cumulative: every reinstall merges the previous managed
 * operations with the new plan so selective `--modules` installs keep earlier
 * ownership. Without reconciliation, a copy-file operation that a selected
 * module no longer ships (a removed source, or a file whose kind/destination
 * changed) stays in install-state forever and doctor reports it as missing or
 * drifted on every run.
 *
 * prepareStaleOperationsReconciliation identifies those records: managed
 * copy-file operations whose module is selected by the current plan but whose
 * destination is no longer planned by any operation. The records stay in the
 * bridge/checkpoint states so a failed install keeps its ownership;
 * withoutStaleOperations drops them only from the successful final state and
 * the dry-run preview. completeStaleOperationsReconciliation runs after the
 * final state is written and deletes a destination only when it is an
 * unchanged regular file with a recorded digest, reached without symlinks,
 * inside the target root. Anything else is preserved with one orphan warning.
 */

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function comparablePath(filePath) {
  const resolvedPath = path.resolve(filePath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

function destinationKeys(operations) {
  return new Set((operations || [])
    .filter(operation => operation && typeof operation.destinationPath === 'string')
    .map(operation => comparablePath(operation.destinationPath)));
}

function materializesWholeModules(plan) {
  // Legacy language installs are cumulative inside one module: pure legacy
  // plans share a module id across languages and Antigravity legacy-compat
  // filters rules-core by language, so an absent operation is not stale there.
  if (plan.mode === 'legacy') {
    return false;
  }
  const request = plan.statePreview && plan.statePreview.request;
  return !(request && request.legacyMode && plan.target === 'antigravity');
}

function hooksDeclined(plan) {
  const request = plan.statePreview && plan.statePreview.request;
  return plan.hookConsent === 'declined' || Boolean(request && request.hookConsent === 'declined');
}

function prepareStaleOperationsReconciliation(plan, migration) {
  const unchanged = { ...migration, staleOperationCandidates: [] };
  const finalOperations = migration && migration.finalState && migration.finalState.operations;
  const resolution = plan && plan.statePreview && plan.statePreview.resolution;
  if (!Array.isArray(finalOperations) || !resolution || !materializesWholeModules(plan)) {
    return unchanged;
  }

  const selectedModules = new Set(resolution.selectedModules || []);
  const plannedDestinations = destinationKeys([
    ...(plan.operations || []),
    ...(plan.statePreview.operations || []),
  ]);
  // Claude flat-skill migration deliberately keeps nested legacy copies that
  // conflict with user-owned flat skills; those records are not stale.
  const retainedLegacyDestinations = destinationKeys(migration.retainedLegacyOperations);
  const skipHookRuntime = hooksDeclined(plan);
  const seen = new Set();
  const staleOperationCandidates = finalOperations.filter(operation => {
    if (
      !operation
      || operation.kind !== 'copy-file'
      || operation.ownership !== 'managed'
      || typeof operation.destinationPath !== 'string'
      || !selectedModules.has(operation.moduleId)
      // Declining hooks strips hook files without the module dropping them.
      || (skipHookRuntime && isHookRuntimeOperation(operation))
    ) {
      return false;
    }
    const key = comparablePath(operation.destinationPath);
    if (plannedDestinations.has(key) || retainedLegacyDestinations.has(key) || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return { ...migration, staleOperationCandidates };
}

function withoutStaleOperations(state, migration) {
  const staleDestinations = destinationKeys(migration && migration.staleOperationCandidates);
  if (!state || !Array.isArray(state.operations) || staleDestinations.size === 0) {
    return state;
  }
  return {
    ...state,
    operations: state.operations.filter(operation => !(
      operation
      && operation.kind === 'copy-file'
      && typeof operation.destinationPath === 'string'
      && staleDestinations.has(comparablePath(operation.destinationPath))
    )),
  };
}

function describeStaleOperationsPreview(migration) {
  const count = ((migration && migration.staleOperationCandidates) || []).length;
  if (count === 0) {
    return [];
  }
  return [
    `${count} previously managed file(s) are no longer part of this install plan; `
    + 'applying it removes their install-state records and deletes only unchanged copies.',
  ];
}

class PreservedStaleFile extends Error {}

function lstatOrNull(filePath) {
  try {
    return fs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return null;
    }
    throw error;
  }
}

// Returns the destination's lstat, or null when it is absent. Every segment
// from the root to the destination is checked with lstat so an in-root
// symlink can never redirect the delete onto its target.
function inspectDestinationPath(destinationPath, targetRoot) {
  const resolvedRoot = path.resolve(targetRoot);
  const resolvedTarget = path.resolve(destinationPath);
  const relativePath = path.relative(resolvedRoot, resolvedTarget);
  if (
    !relativePath
    || relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)
  ) {
    throw new PreservedStaleFile('it is outside the install root');
  }
  assertWithinTrustedRoot(resolvedTarget, resolvedRoot, 'reconcile stale install file');

  const segments = relativePath.split(path.sep);
  let currentPath = resolvedRoot;
  for (let index = 0; index <= segments.length; index += 1) {
    if (index > 0) {
      currentPath = path.join(currentPath, segments[index - 1]);
    }
    const stat = lstatOrNull(currentPath);
    if (!stat) {
      return null;
    }
    if (stat.isSymbolicLink()) {
      throw new PreservedStaleFile(index === segments.length
        ? 'it is a symlink'
        : `its path passes through the symlink ${currentPath}`);
    }
    if (index < segments.length && !stat.isDirectory()) {
      throw new PreservedStaleFile(`${currentPath} is not a directory`);
    }
    if (index === segments.length && !stat.isFile()) {
      throw new PreservedStaleFile('it is not a regular file');
    }
    if (index === segments.length) {
      return stat;
    }
  }
  return null;
}

function hashFileNoFollow(filePath) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(filePath, flags);
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) {
      throw new PreservedStaleFile('it is not a regular file');
    }
    const content = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFile(before, after)) {
      throw new PreservedStaleFile('it changed while being verified');
    }
    return {
      digest: crypto.createHash('sha256').update(content).digest('hex'),
      stat: after,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function sameFile(left, right) {
  return Boolean(left && right)
    && left.ino === right.ino
    && left.dev === right.dev
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function removeEmptyParents(filePath, targetRoot) {
  const resolvedRoot = path.resolve(targetRoot);
  let currentPath = path.dirname(path.resolve(filePath));
  while (
    comparablePath(currentPath) !== comparablePath(resolvedRoot)
    && comparablePath(currentPath).startsWith(`${comparablePath(resolvedRoot)}${path.sep}`)
  ) {
    const stat = lstatOrNull(currentPath);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory() || fs.readdirSync(currentPath).length > 0) {
      return;
    }
    fs.rmdirSync(currentPath);
    currentPath = path.dirname(currentPath);
  }
}

// Removes one stale destination. Returns true when removed, false when it was
// already absent, and throws PreservedStaleFile when it must be kept.
function removeUnchangedStaleFile(candidate, targetRoot) {
  const initialStat = inspectDestinationPath(candidate.destinationPath, targetRoot);
  if (!initialStat) {
    return false;
  }
  if (typeof candidate.contentSha256 !== 'string' || !SHA256_PATTERN.test(candidate.contentSha256)) {
    throw new PreservedStaleFile('its record has no content digest, so it cannot be verified unchanged');
  }

  const destinationPath = path.resolve(candidate.destinationPath);
  const hashed = hashFileNoFollow(destinationPath);
  if (hashed.digest !== candidate.contentSha256.toLowerCase()) {
    throw new PreservedStaleFile('its content changed after install');
  }
  // Revalidate right before unlinking; the path must still name the exact
  // regular file that was hashed.
  const finalStat = inspectDestinationPath(destinationPath, targetRoot);
  if (!sameFile(initialStat, hashed.stat) || !sameFile(finalStat, hashed.stat)) {
    throw new PreservedStaleFile('it changed while being verified');
  }
  fs.unlinkSync(destinationPath);
  try {
    removeEmptyParents(destinationPath, targetRoot);
  } catch (_error) {
    // Pruning emptied directories is best effort; the stale file is gone.
  }
  return true;
}

function completeStaleOperationsReconciliation(migration, plan) {
  const removedPaths = [];
  const warnings = [];
  for (const candidate of (migration && migration.staleOperationCandidates) || []) {
    try {
      if (removeUnchangedStaleFile(candidate, plan.targetRoot)) {
        removedPaths.push(path.resolve(candidate.destinationPath));
      }
    } catch (error) {
      const reason = error instanceof PreservedStaleFile
        ? error.message
        : `it could not be verified or removed (${error.message})`;
      warnings.push(
        `Preserved orphaned file ${candidate.destinationPath}: ECC no longer installs it and `
        + `stopped tracking it, but ${reason}; remove it manually if unwanted.`
      );
    }
  }
  return { removedPaths, warnings };
}

module.exports = {
  completeStaleOperationsReconciliation,
  describeStaleOperationsPreview,
  prepareStaleOperationsReconciliation,
  withoutStaleOperations,
};
