'use strict';

const fs = require('fs');
const path = require('path');

const { readInstallState } = require('../install-state');

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

function comparablePath(filePath) {
  const resolvedPath = path.resolve(filePath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

/**
 * #2964: the shared copy path used to write every copy-file operation
 * unconditionally and record the destination as `ownership: 'managed'` even
 * when the file already existed and was authored by the user. The visible
 * symptom is a lost edit; the dangerous one is the install-state record,
 * which makes a later uninstall delete the user's file.
 *
 * This guard generalises the Claude flat-skill migration conflict pattern to
 * every adapter copy operation: when a destination exists and is NOT recorded
 * as an ECC-managed operation in the previous install-state, the operation is
 * skipped with a warning instead of overwriting and claiming ownership.
 *
 * All managed targets share this ownership boundary (#2964).
 */
function prepareUserOwnedFileGuard(plan, migration) {
  const previousState = pathExists(plan.installStatePath)
    ? readInstallState(plan.installStatePath)
    : null;
  if (previousState && (
    previousState.target.id !== plan.adapter.id
    || comparablePath(previousState.target.root) !== comparablePath(plan.targetRoot)
    || comparablePath(previousState.target.installStatePath) !== comparablePath(plan.installStatePath)
  )) {
    throw new Error(`Refusing install: install-state target does not match the current plan at ${plan.installStatePath}.`);
  }
  // Recorded files remain updateable by reinstall/repair. Preserve their prior
  // digests if an attempt fails before writing them so uninstall detects drift.
  const previousManagedOperations = new Map(
    ((previousState && previousState.operations) || [])
      .filter(operation => (
        operation
        && operation.ownership === 'managed'
        && operation.destinationPath
      ))
      .map(operation => [comparablePath(operation.destinationPath), operation])
  );
  const managedDestinations = new Set(previousManagedOperations.keys());

  const appliedOperations = [];
  const skippedOperations = [];
  const warnings = [];
  for (const operation of (migration && migration.appliedOperations) || []) {
    if (
      operation
      && operation.kind === 'copy-file'
      && operation.destinationPath
      && pathExists(operation.destinationPath)
      && !managedDestinations.has(comparablePath(operation.destinationPath))
    ) {
      skippedOperations.push(operation);
      warnings.push(
        `Skipped user-owned file ${operation.destinationPath}: the existing file is not recorded in ECC install-state.`
      );
      continue;
    }
    appliedOperations.push(operation);
  }

  if (skippedOperations.length === 0) {
    return { ...migration, managedDestinations, previousManagedOperations };
  }

  const skippedDestinations = new Set(
    skippedOperations.map(operation => comparablePath(operation.destinationPath))
  );
  const filterStateOperations = operations => (operations || [])
    .filter(operation => !skippedDestinations.has(comparablePath(operation.destinationPath)));

  // Never leave a skipped destination inside the install-state: recording it
  // would claim ownership of a file ECC did not create and make uninstall
  // delete it (#2964).
  const bridgeState = migration.bridgeState
    ? {
      ...migration.bridgeState,
      operations: filterStateOperations(migration.bridgeState.operations),
    }
    : migration.bridgeState;
  const finalState = migration.finalState
    ? {
      ...migration.finalState,
      operations: filterStateOperations(migration.finalState.operations),
    }
    : migration.finalState;

  return {
    ...migration,
    managedDestinations,
    previousManagedOperations,
    appliedOperations,
    skippedOperations: [
      ...((migration && migration.skippedOperations) || []),
      ...skippedOperations,
    ],
    warnings: [...((migration && migration.warnings) || []), ...warnings],
    bridgeState,
    finalState,
    // Only keep bridge persistence when operations actually remain; a fully
    // skipped plan installs nothing and must not claim anything.
    requiresBridgeState: Boolean(migration.requiresBridgeState)
      && appliedOperations.length > 0,
  };
}

function assertNoNewUserOwnedFile(migration, operation) {
  if (operation.kind !== 'copy-file'
    || migration.managedDestinations.has(comparablePath(operation.destinationPath))
    || !pathExists(operation.destinationPath)) {
    return;
  }
  throw new Error(`Refusing install: a user-owned file appeared at ${operation.destinationPath} after planning. Rerun the installer to preserve it.`);
}

function preserveUnwrittenFiles(state, migration, writtenDestinations) {
  const writtenPaths = new Set([...writtenDestinations].map(comparablePath));
  return {
    ...state,
    operations: state.operations.filter(operation => (
      operation.kind !== 'copy-file'
      || migration.managedDestinations.has(comparablePath(operation.destinationPath))
      || writtenPaths.has(comparablePath(operation.destinationPath))
      || !pathExists(operation.destinationPath)
    )).map(operation => {
      const destination = comparablePath(operation.destinationPath);
      return operation.kind === 'copy-file' && !writtenPaths.has(destination)
        ? migration.previousManagedOperations.get(destination) || operation
        : operation;
    }),
  };
}

module.exports = {
  assertNoNewUserOwnedFile,
  prepareUserOwnedFileGuard,
  preserveUnwrittenFiles,
};
