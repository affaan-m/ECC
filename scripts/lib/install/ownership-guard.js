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
 * It is opt-in per adapter via `preserveUserOwnedFiles` (default off) so the
 * eleven shipping targets can adopt it individually (#2964).
 */
function prepareUserOwnedFileGuard(plan, migration) {
  const adapter = plan && plan.adapter;
  if (!adapter || !adapter.preserveUserOwnedFiles) {
    return migration;
  }

  const previousState = pathExists(plan.installStatePath)
    ? readInstallState(plan.installStatePath)
    : null;
  const managedDestinations = new Set(
    ((previousState && previousState.operations) || [])
      .filter(operation => (
        operation
        && operation.ownership === 'managed'
        && operation.destinationPath
      ))
      .map(operation => comparablePath(operation.destinationPath))
  );

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
    return migration;
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

module.exports = {
  prepareUserOwnedFileGuard,
};
