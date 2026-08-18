'use strict';

const fs = require('fs');
const path = require('path');

const { readInstallState } = require('../install-state');
const { assertWithinTrustedRoot } = require('../path-safety');

const CLAUDE_TARGETS = new Set(['claude', 'claude-project']);

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

function normalizeSourceRelativePath(sourceRelativePath) {
  const slashNormalized = String(sourceRelativePath || '').replace(/\\/g, '/');
  const normalized = path.posix.normalize(slashNormalized).replace(/^\.\//, '');
  if (
    !normalized
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
    || path.posix.isAbsolute(normalized)
  ) {
    return null;
  }
  return normalized;
}

function comparablePath(filePath) {
  const resolvedPath = path.resolve(filePath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

function samePath(leftPath, rightPath) {
  return comparablePath(leftPath) === comparablePath(rightPath);
}

function assertSafeSkillPath(targetPath, targetRoot, action) {
  const resolvedRoot = path.resolve(targetRoot);
  const resolvedTarget = path.resolve(targetPath);
  const relativePath = path.relative(resolvedRoot, resolvedTarget);
  if (
    relativePath === ''
    || relativePath.startsWith('..')
    || path.isAbsolute(relativePath)
  ) {
    throw new Error(
      `Refusing to ${action} outside the install root: '${targetPath}' is not within '${targetRoot}'.`
    );
  }

  let currentPath = resolvedRoot;
  for (const segment of relativePath.split(path.sep)) {
    currentPath = path.join(currentPath, segment);
    let stats;
    try {
      stats = fs.lstatSync(currentPath);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        break;
      }
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Refusing to ${action} through symlinked Claude skill path: '${currentPath}'.`
      );
    }
  }

  if (pathExists(targetRoot)) {
    assertWithinTrustedRoot(targetPath, targetRoot, action);
  }
}

function describeClaudeSkillOperation(targetRoot, operation) {
  if (!operation || operation.kind !== 'copy-file') {
    return null;
  }

  const sourceRelativePath = normalizeSourceRelativePath(operation.sourceRelativePath);
  if (!sourceRelativePath) {
    return null;
  }

  const sourceParts = sourceRelativePath.split('/');
  if (sourceParts[0] !== 'skills' || sourceParts.length < 3 || !sourceParts[1]) {
    return null;
  }

  const skillName = sourceParts[1];
  const relativeParts = sourceParts.slice(2);
  const flatSkillRoot = path.join(targetRoot, 'skills', skillName);
  const legacySkillRoot = path.join(targetRoot, 'skills', 'ecc', skillName);

  return {
    sourceKey: sourceRelativePath,
    skillName,
    flatSkillRoot,
    flatDestinationPath: path.join(flatSkillRoot, ...relativeParts),
    legacySkillRoot,
    legacyDestinationPath: path.join(legacySkillRoot, ...relativeParts),
  };
}

function assertSafeClaudeSkillOperation(plan, operation) {
  const target = plan && plan.adapter && plan.adapter.target;
  if (!CLAUDE_TARGETS.has(target)) {
    return;
  }
  const descriptor = describeClaudeSkillOperation(plan.targetRoot, operation);
  if (!descriptor || !samePath(operation.destinationPath, descriptor.flatDestinationPath)) {
    return;
  }
  assertSafeSkillPath(
    operation.destinationPath,
    plan.targetRoot,
    'install Claude skill'
  );
}

function isManagedOperation(operation) {
  return operation && operation.ownership === 'managed';
}

function uniqueOperations(operations) {
  const byDestination = new Map();
  for (const operation of operations) {
    // A target path has one current owner. Later operations come from the
    // newest plan and replace stale metadata for the same destination.
    byDestination.set(comparablePath(operation.destinationPath), operation);
  }
  return [...byDestination.values()];
}

function buildState(statePreview, operations) {
  return {
    ...statePreview,
    operations: uniqueOperations(operations).map(operation => ({ ...operation })),
  };
}

function groupCurrentSkillOperations(plan) {
  const groups = new Map();
  for (const operation of plan.operations) {
    const descriptor = describeClaudeSkillOperation(plan.targetRoot, operation);
    if (!descriptor || !samePath(operation.destinationPath, descriptor.flatDestinationPath)) {
      continue;
    }

    assertSafeSkillPath(
      operation.destinationPath,
      plan.targetRoot,
      'install Claude skill'
    );

    const current = groups.get(descriptor.flatSkillRoot) || [];
    current.push({ operation, descriptor });
    groups.set(descriptor.flatSkillRoot, current);
  }
  return groups;
}

function classifyPreviousOperations(plan, previousState) {
  const flatByDestination = new Map();
  const legacyBySource = new Map();
  const legacyBySkillRoot = new Map();

  for (const operation of (previousState && previousState.operations) || []) {
    if (!isManagedOperation(operation)) {
      continue;
    }
    const descriptor = describeClaudeSkillOperation(plan.targetRoot, operation);
    if (!descriptor) {
      continue;
    }

    if (samePath(operation.destinationPath, descriptor.flatDestinationPath)) {
      assertSafeSkillPath(
        operation.destinationPath,
        plan.targetRoot,
        'inspect managed Claude skill'
      );
      flatByDestination.set(comparablePath(operation.destinationPath), operation);
      continue;
    }

    if (!samePath(operation.destinationPath, descriptor.legacyDestinationPath)) {
      continue;
    }

    assertSafeSkillPath(
      operation.destinationPath,
      plan.targetRoot,
      'migrate managed Claude skill'
    );
    legacyBySource.set(descriptor.sourceKey, operation);
    const current = legacyBySkillRoot.get(descriptor.legacySkillRoot) || [];
    current.push({ operation, descriptor });
    legacyBySkillRoot.set(descriptor.legacySkillRoot, current);
  }

  return {
    flatByDestination,
    legacyBySource,
    legacyBySkillRoot,
  };
}

function createConflictWarning(skillName, flatSkillRoot, retainsLegacy) {
  const legacySuffix = retainsLegacy
    ? ' The existing ECC-managed nested copy was retained and remains tracked for uninstall.'
    : '';
  return `Skipped Claude skill '${skillName}' at ${flatSkillRoot}: the flat skill directory is user-owned because it is not recorded in ECC install-state.${legacySuffix}`;
}

function createFileConflictWarning(destinationPath, retainsLegacy) {
  const legacySuffix = retainsLegacy
    ? ' The matching ECC-managed nested file was retained and remains tracked for uninstall.'
    : '';
  return `Skipped user-owned Claude skill file ${destinationPath}: the existing file is not recorded in ECC install-state.${legacySuffix}`;
}

function createDisabledMigration(plan, previousState) {
  const finalState = buildState(plan.statePreview, [
    ...((previousState && previousState.operations) || []),
    ...plan.statePreview.operations,
  ]);
  return {
    enabled: false,
    appliedOperations: [...plan.operations],
    skippedOperations: [],
    warnings: [],
    bridgeState: finalState,
    finalState,
    legacyOperationsToRemove: [],
    requiresBridgeState: false,
  };
}

function collectRetainedLegacyOperations(currentGroups, previous) {
  const currentSourceKeys = new Set(
    [...currentGroups.values()]
      .flat()
      .map(({ descriptor }) => descriptor.sourceKey)
  );
  return (
    [...previous.legacyBySource.entries()]
      .filter(([sourceKey]) => !currentSourceKeys.has(sourceKey))
      .map(([_sourceKey, operation]) => operation)
  );
}

function classifySkillGroup(flatSkillRoot, entries, previous) {
  const hasManagedFlatFile = entries.some(({ operation }) => (
    previous.flatByDestination.has(comparablePath(operation.destinationPath))
  ));
  const legacyEntries = previous.legacyBySkillRoot.get(
    entries[0].descriptor.legacySkillRoot
  ) || [];

  if (pathExists(flatSkillRoot) && !hasManagedFlatFile) {
    return {
      skippedOperations: entries.map(({ operation }) => operation),
      warnings: [createConflictWarning(
        entries[0].descriptor.skillName,
        flatSkillRoot,
        legacyEntries.length > 0
      )],
      retainedLegacyOperations: legacyEntries.map(({ operation }) => operation),
    };
  }

  const conflicts = entries.filter(({ operation }) => (
    pathExists(operation.destinationPath)
    && !previous.flatByDestination.has(comparablePath(operation.destinationPath))
  ));
  return {
    skippedOperations: conflicts.map(({ operation }) => operation),
    warnings: conflicts.map(({ operation, descriptor }) => createFileConflictWarning(
      operation.destinationPath,
      previous.legacyBySource.has(descriptor.sourceKey)
    )),
    retainedLegacyOperations: conflicts
      .map(({ descriptor }) => previous.legacyBySource.get(descriptor.sourceKey))
      .filter(Boolean),
  };
}

function classifySkillConflicts(currentGroups, previous) {
  const groupClassifications = [...currentGroups.entries()]
    .map(([flatSkillRoot, entries]) => classifySkillGroup(
      flatSkillRoot,
      entries,
      previous
    ));
  const skippedOperations = groupClassifications
    .flatMap(classification => classification.skippedOperations);
  return {
    skippedOperations,
    skippedDestinations: new Set(
      skippedOperations.map(operation => comparablePath(operation.destinationPath))
    ),
    warnings: groupClassifications.flatMap(classification => classification.warnings),
    retainedLegacyOperations: new Set([
      ...collectRetainedLegacyOperations(currentGroups, previous),
      ...groupClassifications.flatMap(
        classification => classification.retainedLegacyOperations
      ),
    ]),
  };
}

function buildMigrationStates(plan, previousState, previous, classification) {
  const { skippedDestinations, retainedLegacyOperations } = classification;
  const appliedOperations = plan.operations.filter(operation => (
    !skippedDestinations.has(comparablePath(operation.destinationPath))
  ));
  const legacyOperations = [...previous.legacyBySource.values()];
  const legacyOperationsToRemove = legacyOperations.filter(operation => (
    !retainedLegacyOperations.has(operation)
  ));
  const removedLegacyDestinations = new Set(
    legacyOperationsToRemove.map(operation => comparablePath(operation.destinationPath))
  );
  const finalOperations = [
    ...((previousState && previousState.operations) || []).filter(operation => (
      !removedLegacyDestinations.has(comparablePath(operation.destinationPath))
    )),
    ...plan.statePreview.operations.filter(operation => (
      !skippedDestinations.has(comparablePath(operation.destinationPath))
    )),
  ];
  const bridgeOperations = [
    ...((previousState && previousState.operations) || []),
    ...appliedOperations,
  ];

  return {
    appliedOperations,
    bridgeState: buildState(plan.statePreview, bridgeOperations),
    finalState: buildState(plan.statePreview, finalOperations),
    legacyOperationsToRemove,
    requiresBridgeState: appliedOperations.length > 0,
  };
}

function prepareClaudeSkillMigration(plan) {
  const previousState = pathExists(plan.installStatePath)
    ? readInstallState(plan.installStatePath)
    : null;
  const target = plan && plan.adapter && plan.adapter.target;
  if (!CLAUDE_TARGETS.has(target)) {
    return createDisabledMigration(plan, previousState);
  }
  const currentGroups = groupCurrentSkillOperations(plan);
  const previous = classifyPreviousOperations(plan, previousState);
  const classification = classifySkillConflicts(currentGroups, previous);
  const states = buildMigrationStates(
    plan,
    previousState,
    previous,
    classification
  );

  return {
    enabled: true,
    appliedOperations: states.appliedOperations,
    skippedOperations: classification.skippedOperations,
    warnings: classification.warnings,
    bridgeState: states.bridgeState,
    finalState: states.finalState,
    legacyOperationsToRemove: states.legacyOperationsToRemove,
    requiresBridgeState: states.requiresBridgeState,
  };
}

function cleanupEmptyLegacyParents(filePath, targetRoot) {
  const skillsRoot = path.join(targetRoot, 'skills');
  let currentPath = path.dirname(filePath);

  while (!samePath(currentPath, skillsRoot)) {
    assertSafeSkillPath(currentPath, targetRoot, 'clean Claude skill migration');
    if (!pathExists(currentPath) || fs.readdirSync(currentPath).length > 0) {
      return;
    }
    fs.rmdirSync(currentPath);
    currentPath = path.dirname(currentPath);
  }
}

function removeLegacyClaudeSkillFiles(migration, targetRoot) {
  for (const operation of migration.legacyOperationsToRemove) {
    assertSafeSkillPath(
      operation.destinationPath,
      targetRoot,
      'migrate managed Claude skill'
    );
    fs.rmSync(operation.destinationPath, { force: true });
    cleanupEmptyLegacyParents(operation.destinationPath, targetRoot);
  }
}

module.exports = {
  assertSafeClaudeSkillOperation,
  prepareClaudeSkillMigration,
  removeLegacyClaudeSkillFiles,
};
