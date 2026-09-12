'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  hasExplicitCommitAttributionPreference,
  withCommitAttributionDisabled,
} = require('../claude-commit-attribution');
const { readInstallState, writeInstallState } = require('../install-state');
const { writeFileAtomic } = require('../atomic-write');
const {
  assertAntigravityHooksPath,
  getAntigravityHooksPath,
  mergeManagedHookGroups,
  readHookConfigSnapshot,
  uninstallManagedHookGroups,
  updateHookConfigAtomic,
  validateHookGroups,
} = require('./antigravity-hooks');
const { assertHookConsentReady, planMaterializesHookRuntime } = require('./hook-consent');
const {
  getClaudeSettingsPath,
  mergeManagedHooks,
  readSettings,
  runWithSettingsLock,
  uninstallManagedHooks,
  updateSettingsAtomic,
  validateManagedHooks,
  validateRecordedManagedHooks,
} = require('./claude-settings');
const { sameFileIdentity } = require('./claude-settings-lock');
const { filterMcpConfig, parseDisabledMcpServers } = require('../mcp-config');
const { assertWithinTrustedRoot } = require('../path-safety');
const {
  assertSafeClaudeSkillOperation,
  prepareClaudeSkillMigration,
  removeLegacyClaudeSkillFiles,
} = require('./claude-skill-migration');
const { cleanupLegacyAntigravityInstall } = require('./antigravity-legacy-migration');
const {
  assertNoNewUserOwnedFile,
  prepareUserOwnedFileGuard,
  preserveUnwrittenFiles,
} = require('./ownership-guard');
const { cleanupLegacyOpencodeInstall } = require('./opencode-legacy-migration');
const { buildInstallIndex, rewriteRelativeLinks } = require('./link-rewrite');
const { adaptAntigravityAgent } = require('./antigravity-agent');

function isMarkdownPath(filePath) {
  return /\.(md|mdx|markdown)$/i.test(String(filePath || ''));
}

function transformInstallContent(operation, content) {
  if (!operation.contentTransform) {
    return content;
  }
  if (operation.contentTransform === 'antigravity-agent-frontmatter') {
    return adaptAntigravityAgent(content, operation.sourceRelativePath);
  }
  throw new Error(`Unknown install content transform: ${operation.contentTransform}`);
}

// Map every copy-file operation to { sourceRel, destRel } so relative links in
// namespaced markdown can be rewritten to the file's actual installed location
// (issue #2340). Returns null when the plan lacks the data needed to do so.
function buildLinkIndexForPlan(plan) {
  if (!plan || !plan.targetRoot || !Array.isArray(plan.operations)) {
    return null;
  }
  const mappings = [];
  for (const operation of plan.operations) {
    if (operation.kind === 'copy-file' && operation.sourceRelativePath) {
      mappings.push({
        sourceRel: operation.sourceRelativePath,
        destRel: path.relative(plan.targetRoot, operation.destinationPath),
      });
    }
  }
  return buildInstallIndex(mappings);
}

function readJsonObject(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const wrappedError = new Error(`Failed to parse ${label} at ${filePath}: ${error.message}`);
    wrappedError.code = error.code;
    throw wrappedError;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid ${label} at ${filePath}: expected a JSON object`);
  }

  return parsed;
}

function readOptionalJsonObject(filePath, label) {
  try {
    return readJsonObject(filePath, label);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function readInstalledFileNoFollow(plan, operation) {
  assertSafeInstallOperation(plan, operation);
  assertSafeClaudeSkillOperation(plan, operation);
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fs.openSync(operation.destinationPath, flags);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  try {
    const openedStat = fs.fstatSync(descriptor, { bigint: true });
    const finalPathStat = fs.lstatSync(operation.destinationPath, { bigint: true });
    if (finalPathStat.isSymbolicLink() || !finalPathStat.isFile()) {
      return null;
    }
    const identityMatches = openedStat.ino === finalPathStat.ino
      && (!openedStat.dev || !finalPathStat.dev || openedStat.dev === finalPathStat.dev);
    if (!openedStat.isFile() || !identityMatches) {
      throw new Error(
        `Refusing to hash changed install destination: ${operation.destinationPath}`
      );
    }
    // Revalidate the full path after opening. The descriptor pins the file so
    // the digest and metadata refer to the same object.
    assertSafeInstallOperation(plan, operation);
    assertSafeClaudeSkillOperation(plan, operation);
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function stateWithContentDigests(state, plan) {
  const currentDestinations = new Set((plan.operations || [])
    .filter(operation => operation.destinationPath)
    .map(operation => {
      const resolved = path.resolve(operation.destinationPath);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    }));
  return {
    ...state,
    operations: (state.operations || []).map(operation => {
      if (!operation.destinationPath) {
        return { ...operation };
      }
      if (operation.kind === 'update-antigravity-hooks') {
        const { contentSha256: _sharedFileDigest, ...operationWithoutDigest } = operation;
        return operationWithoutDigest;
      }
      const resolved = path.resolve(operation.destinationPath);
      const destinationKey = process.platform === 'win32'
        ? resolved.toLowerCase()
        : resolved;
      if (!currentDestinations.has(destinationKey)) {
        return { ...operation };
      }
      const installedContent = readInstalledFileNoFollow(plan, operation);
      if (installedContent === null) {
        return { ...operation };
      }
      return {
        ...operation,
        contentSha256: crypto.createHash('sha256')
          .update(installedContent)
          .digest('hex'),
      };
    }),
  };
}

function cloneJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeJson(baseValue, patchValue) {
  if (!isPlainObject(baseValue) || !isPlainObject(patchValue)) {
    return cloneJsonValue(patchValue);
  }

  const merged = { ...baseValue };
  for (const [key, value] of Object.entries(patchValue)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMergeJson(merged[key], value);
    } else {
      merged[key] = cloneJsonValue(value);
    }
  }
  return merged;
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function shouldSetClaudeCommitAttributionPreference(plan) {
  if (!plan?.adapter || !['claude', 'claude-project'].includes(plan.adapter.target)) {
    return false;
  }

  return plan.operations.some(operation => {
    if (typeof operation?.destinationPath !== 'string') {
      return false;
    }
    const relativePath = path.relative(plan.targetRoot, operation.destinationPath);
    return relativePath && !relativePath.startsWith(`docs${path.sep}`) && relativePath !== 'docs';
  });
}

function writeClaudeCommitAttributionPreference(settingsPath, options = {}) {
  let settings;
  try {
    settings = readSettings(settingsPath);
  } catch (_error) {
    // Unreadable or malformed settings belong to the user; leave them untouched.
    return false;
  }

  if (hasExplicitCommitAttributionPreference(settings)) {
    return false;
  }

  let changed = false;
  updateSettingsAtomic(settingsPath, latestSettings => {
    if (hasExplicitCommitAttributionPreference(latestSettings)) {
      return { settings: latestSettings };
    }
    changed = true;
    return { settings: withCommitAttributionDisabled(latestSettings) };
  }, options);
  return changed;
}

function isMcpConfigPath(filePath) {
  const basename = path.basename(String(filePath || ''));
  return basename === '.mcp.json' || basename === 'mcp.json';
}

function assertSafeInstallOperation(plan, operation) {
  if (!operation || typeof operation.destinationPath !== 'string') {
    throw new Error('Refusing to apply install operation: missing destination path.');
  }

  const targetRoot = plan && plan.targetRoot;
  assertWithinTrustedRoot(operation.destinationPath, targetRoot, 'install ECC file');

  const resolvedRoot = path.resolve(targetRoot);
  const resolvedTarget = path.resolve(operation.destinationPath);
  const relativePath = path.relative(resolvedRoot, resolvedTarget);
  const segments = relativePath ? relativePath.split(path.sep) : [];
  for (const segmentIndex of Array.from({ length: segments.length + 1 }, (_value, index) => index)) {
    const currentPath = segmentIndex === 0
      ? resolvedRoot
      : path.join(resolvedRoot, ...segments.slice(0, segmentIndex));
    try {
      const stats = fs.lstatSync(currentPath);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `Refusing to install ECC file through symlinked path: '${currentPath}'.`
        );
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        break;
      }
      throw error;
    }
  }
}

function removeManagedFileAtomic(plan, operation) {
  assertSafeInstallOperation(plan, operation);
  let originalStats;
  try {
    originalStats = fs.lstatSync(operation.destinationPath, { bigint: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
  if (!originalStats.isFile() || originalStats.isSymbolicLink()) {
    throw new Error(`Refusing to remove unsafe managed hook runtime: ${operation.destinationPath}`);
  }
  const quarantinePath = path.join(
    path.dirname(operation.destinationPath),
    `.${path.basename(operation.destinationPath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.remove`
  );
  assertSafeInstallOperation(plan, { destinationPath: quarantinePath });
  fs.renameSync(operation.destinationPath, quarantinePath);
  try {
    assertSafeInstallOperation(plan, { destinationPath: quarantinePath });
    const movedStats = fs.lstatSync(quarantinePath, { bigint: true });
    if (!movedStats.isFile() || !sameFileIdentity(originalStats, movedStats)) {
      throw new Error(`Refusing to remove changed managed hook runtime: ${operation.destinationPath}`);
    }
    const currentDigest = crypto.createHash('sha256').update(fs.readFileSync(quarantinePath)).digest('hex');
    if (!operation.contentSha256 || currentDigest !== operation.contentSha256.toLowerCase()) {
      throw new Error(`Refusing to remove modified managed hook runtime: ${operation.destinationPath}`);
    }
    fs.unlinkSync(quarantinePath);
    return true;
  } catch (error) {
    if (!fs.existsSync(operation.destinationPath) && fs.existsSync(quarantinePath)) {
      fs.renameSync(quarantinePath, operation.destinationPath);
    }
    throw error;
  }
}

function cleanupEmptyManagedParents(filePath, stopAt) {
  const resolvedStop = path.resolve(stopAt);
  let currentPath = path.dirname(path.resolve(filePath));
  while (currentPath !== resolvedStop) {
    assertWithinTrustedRoot(currentPath, resolvedStop, 'clean up hook runtime');
    if (!fs.existsSync(currentPath)) {
      currentPath = path.dirname(currentPath);
      continue;
    }
    const stats = fs.lstatSync(currentPath);
    if (!stats.isDirectory() || stats.isSymbolicLink() || fs.readdirSync(currentPath).length > 0) {
      break;
    }
    fs.rmdirSync(currentPath);
    currentPath = path.dirname(currentPath);
  }
}

function copyManagedFileAtomic(plan, operation, beforeRename) {
  const sourceStats = fs.statSync(operation.sourcePath);
  if (!sourceStats.isFile()) {
    throw new Error(`Invalid install source file: ${operation.sourcePath}`);
  }
  writeFileAtomic(operation.destinationPath, fs.readFileSync(operation.sourcePath), {
    mode: sourceStats.mode & 0o777,
    validateParent() {
      assertSafeInstallOperation(plan, operation);
      assertSafeClaudeSkillOperation(plan, operation);
    },
    beforeRename() {
      if (typeof beforeRename === 'function') beforeRename({ plan, operation });
      assertSafeInstallOperation(plan, operation);
      assertSafeClaudeSkillOperation(plan, operation);
    },
  });
}

function readPreviousInstallState(plan) {
  if (!fs.existsSync(plan.installStatePath)) {
    return null;
  }
  return readInstallState(plan.installStatePath);
}

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function findPreviousManagedHooks(previousState, plan, operation) {
  if (
    !previousState
    || previousState.target.id !== plan.adapter.id
    || comparablePath(previousState.target.root) !== comparablePath(plan.targetRoot)
    || comparablePath(previousState.target.installStatePath) !== comparablePath(plan.installStatePath)
  ) {
    return null;
  }

  const previousOperation = (previousState.operations || []).find(candidate => (
    candidate.kind === operation.kind
    && comparablePath(candidate.destinationPath) === comparablePath(operation.destinationPath)
  ));
  if (!previousOperation || !previousOperation.managedHooks) {
    return null;
  }

  return validateRecordedManagedHooks(
    previousOperation.managedHooks,
    'previous managed hooks'
  );
}

function findPreviousManagedHookGroups(previousState, plan, operation) {
  if (
    !previousState
    || previousState.target.id !== plan.adapter.id
    || comparablePath(previousState.target.root) !== comparablePath(plan.targetRoot)
    || comparablePath(previousState.target.installStatePath) !== comparablePath(plan.installStatePath)
  ) {
    return null;
  }
  const previousOperation = (previousState.operations || []).find(candidate => (
    candidate.kind === 'update-antigravity-hooks'
    && comparablePath(candidate.destinationPath) === comparablePath(operation.destinationPath)
  ));
  return previousOperation && previousOperation.managedHookGroups
    ? validateHookGroups(previousOperation.managedHookGroups, 'previous managed Antigravity hook groups')
    : null;
}

function preflightClaudeSettingsOperations(plan) {
  const settingsOperations = plan.operations.filter(operation => (
    operation.kind === 'update-claude-settings'
    || operation.kind === 'remove-claude-settings-hooks'
  ));
  if (settingsOperations.length === 0) {
    return new Map();
  }

  const previousState = readPreviousInstallState(plan);
  return new Map(settingsOperations.map(operation => {
    assertSafeInstallOperation(plan, operation);
    const managedHooks = validateManagedHooks(operation.managedHooks);
    const settings = readSettings(operation.destinationPath);
    const previousManagedHooks = findPreviousManagedHooks(previousState, plan, operation);
    if (operation.kind === 'remove-claude-settings-hooks') {
      const removal = uninstallManagedHooks(settings, managedHooks);
      if (removal.retained.length > 0) {
        throw new Error(
          `Refusing to disable modified Claude hooks in ${operation.destinationPath}; `
          + 'run the ECC uninstaller to review retained entries.'
        );
      }
    } else {
      mergeManagedHooks(settings, managedHooks, { previousManagedHooks });
    }
    return [operation, { managedHooks, previousManagedHooks }];
  }));
}

function preflightAntigravityHookOperations(plan) {
  const operations = plan.operations.filter(operation => (
    operation.kind === 'update-antigravity-hooks'
    || operation.kind === 'remove-antigravity-hooks'
  ));
  if (operations.length === 0) return new Map();

  const previousState = readPreviousInstallState(plan);
  return new Map(operations.map(operation => {
    assertSafeInstallOperation(plan, operation);
    assertAntigravityHooksPath(operation.destinationPath, plan.targetRoot);
    const managedHookGroups = validateHookGroups(operation.managedHookGroups);
    const previousManagedHookGroups = findPreviousManagedHookGroups(previousState, plan, operation);
    const snapshot = readHookConfigSnapshot(operation.destinationPath);
    const currentConfig = snapshot.config;
    const result = operation.kind === 'remove-antigravity-hooks'
      ? uninstallManagedHookGroups(currentConfig, managedHookGroups)
      : mergeManagedHookGroups(currentConfig, managedHookGroups, { previousManagedHookGroups });
    if (operation.kind === 'remove-antigravity-hooks' && result.retained.length > 0) {
      throw new Error(
        `Refusing to disable modified Antigravity hook group(s): ${result.retained.join(', ')}`
      );
    }
    return [operation, { managedHookGroups, previousManagedHookGroups, exists: snapshot.exists }];
  }));
}

function prepareHookConsentMigration(plan, migration) {
  if (plan.hookConsent !== 'declined') {
    return migration;
  }
  const previousState = readPreviousInstallState(plan);
  if (!previousState) {
    return migration;
  }

  const previousHookOperations = (previousState.operations || [])
    .filter(operation => operation.moduleId === 'hooks-runtime');
  const configRemovals = previousHookOperations
    .filter(operation => (
      operation.kind === 'update-claude-settings'
      || operation.kind === 'update-antigravity-hooks'
    ))
    .map(operation => ({
      ...operation,
      kind: operation.kind === 'update-claude-settings'
        ? 'remove-claude-settings-hooks'
        : 'remove-antigravity-hooks',
      strategy: operation.kind === 'update-claude-settings'
        ? 'remove-hook-ids'
        : 'remove-hook-groups',
      scaffoldOnly: false,
    }));
  const runtimeRemovals = previousHookOperations
    .filter(operation => operation.kind === 'copy-file')
    .map(operation => ({
      ...operation,
      kind: 'remove-managed-file',
      strategy: 'remove-managed-file',
      scaffoldOnly: false,
    }));
  const removals = [...configRemovals, ...runtimeRemovals];
  if (removals.length === 0) {
    return migration;
  }
  const removedHookOperations = new Set(previousHookOperations.map(operation => (
    `${operation.kind}:${comparablePath(operation.destinationPath)}`
  )));
  return {
    ...migration,
    // Disable hooks only after every ordinary install operation succeeds so a
    // partial reinstall cannot silently revoke working hooks before failing.
    appliedOperations: [...migration.appliedOperations, ...removals],
    finalState: {
      ...migration.finalState,
      operations: migration.finalState.operations.filter(operation => !(
        operation.moduleId === 'hooks-runtime'
        && removedHookOperations.has(`${operation.kind}:${comparablePath(operation.destinationPath)}`)
      )),
    },
    bridgeState: {
      ...migration.bridgeState,
      request: {
        ...migration.bridgeState.request,
        hookConsent: 'enabled',
      },
      resolution: {
        ...migration.bridgeState.resolution,
        selectedModules: [...new Set([
          ...migration.bridgeState.resolution.selectedModules,
          'hooks-runtime',
        ])],
      },
    },
    requiresBridgeState: true,
  };
}

function getBridgeStateCheckpoint(migration) {
  return {
    ...migration.bridgeState,
    operations: migration.bridgeState.operations.flatMap(operation => {
      if (operation.kind !== 'update-antigravity-hooks') return [operation];
      const previous = migration.previousManagedOperations.get(
        comparablePath(operation.destinationPath)
      );
      return previous && previous.kind === 'update-antigravity-hooks' ? [previous] : [];
    }),
  };
}

function previewInstallPlan(plan) {
  const migration = prepareHookConsentMigration(
    plan,
    prepareUserOwnedFileGuard(plan, prepareClaudeSkillMigration(plan))
  );
  const appliedPlan = {
    ...plan,
    operations: migration.appliedOperations,
  };
  preflightClaudeSettingsOperations(appliedPlan);
  preflightAntigravityHookOperations(appliedPlan);
  const hookConsentWarnings = planMaterializesHookRuntime(plan) && plan.hookConsent !== 'enabled'
    ? ['Applying this plan requires an explicit hook decision: --enable-hooks or --no-hooks.']
    : [];
  return {
    ...plan,
    statePreview: migration.finalState,
    plannedOperations: [...plan.operations],
    operations: migration.appliedOperations,
    skippedOperations: migration.skippedOperations,
    warnings: [
      ...(Array.isArray(plan.warnings) ? plan.warnings : []),
      ...migration.warnings,
      ...hookConsentWarnings,
    ],
    applied: false,
  };
}

function applyInstallPlan(plan, dependencies = {}) {
  assertHookConsentReady(plan);
  const isClaudeManualTarget = plan.adapter
    && (plan.adapter.target === 'claude' || plan.adapter.target === 'claude-project');
  const hookConfigPathToLock = isClaudeManualTarget
    ? getClaudeSettingsPath(plan.targetRoot)
    : plan.adapter?.target === 'antigravity'
      ? getAntigravityHooksPath(plan.targetRoot)
      : null;
  if (hookConfigPathToLock) {
    assertSafeInstallOperation(plan, { destinationPath: hookConfigPathToLock });
  }
  return hookConfigPathToLock
    ? runWithSettingsLock(
      hookConfigPathToLock,
      () => applyInstallPlanLocked(plan, dependencies, true)
    )
    : applyInstallPlanLocked(plan, dependencies, false);
}

function applyInstallPlanLocked(plan, dependencies = {}, settingsLockHeld = false) {
  const persistInstallState = dependencies.writeInstallState || writeInstallState;
  const beforeInstallStateRead = dependencies.beforeInstallStateRead;
  const beforeOperationWrite = dependencies.beforeOperationWrite;
  const beforeCopyRename = dependencies.beforeCopyRename;
  const beforeInstallStateWrite = dependencies.beforeInstallStateWrite;
  if (typeof beforeInstallStateRead === 'function') {
    beforeInstallStateRead({ plan });
  }
  const migration = prepareHookConsentMigration(
    plan,
    prepareUserOwnedFileGuard(plan, prepareClaudeSkillMigration(plan))
  );
  const appliedPlan = {
    ...plan,
    operations: migration.appliedOperations,
  };
  const skippedAntigravityRuntime = migration.skippedOperations.filter(operation => (
    plan.adapter?.target === 'antigravity'
    && operation.moduleId === 'hooks-runtime'
  ));
  if (skippedAntigravityRuntime.length > 0) {
    throw new Error(
      'Refusing to enable Antigravity hooks because an ECC runtime destination is user-owned: '
      + skippedAntigravityRuntime.map(operation => operation.destinationPath).join(', ')
    );
  }
  for (const operation of appliedPlan.operations.filter(candidate => (
    candidate.kind === 'remove-managed-file'
  ))) {
    let currentStats = null;
    try {
      currentStats = fs.lstatSync(operation.destinationPath, { bigint: true });
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
    if (currentStats && (!currentStats.isFile() || currentStats.isSymbolicLink())) {
      throw new Error(`Refusing to remove unsafe managed hook runtime: ${operation.destinationPath}`);
    }
    const currentContent = readInstalledFileNoFollow(appliedPlan, operation);
    if (currentContent === null) continue;
    const currentDigest = crypto.createHash('sha256').update(currentContent).digest('hex');
    if (!operation.contentSha256 || currentDigest !== operation.contentSha256.toLowerCase()) {
      throw new Error(`Refusing to remove modified managed hook runtime: ${operation.destinationPath}`);
    }
  }
  const preparedClaudeSettings = preflightClaudeSettingsOperations(appliedPlan);
  const preparedAntigravityHooks = preflightAntigravityHookOperations(appliedPlan);
  const disabledServers = parseDisabledMcpServers(process.env.ECC_DISABLED_MCPS);
  const linkIndex = buildLinkIndexForPlan(appliedPlan);
  const hasLegacyMigration = migration.legacyOperationsToRemove.length > 0;
  const hookRemovalCount = appliedPlan.operations.filter(operation => (
    operation.kind === 'remove-claude-settings-hooks'
    || operation.kind === 'remove-antigravity-hooks'
    || operation.kind === 'remove-managed-file'
  )).length;
  let completedHookRemovalCount = 0;
  const writtenDestinations = new Set();
    if (migration.requiresBridgeState) {
      // Own every operation that may be written during a flat-skill migration
      // before the first copy. A later failure is retryable and uninstall can
      // clean the entire partial install, including non-skill files. During
      // legacy migration the bridge also retains the prior managed operations.
      const bridgeStateCheckpoint = getBridgeStateCheckpoint(migration);
      if (typeof beforeInstallStateWrite === 'function') {
        beforeInstallStateWrite({ plan: appliedPlan, state: bridgeStateCheckpoint });
      }
      persistInstallState(plan.installStatePath, bridgeStateCheckpoint);
    }

    let finalState;
    try {
      for (const operation of appliedPlan.operations) {
      assertSafeInstallOperation(appliedPlan, operation);
      assertSafeClaudeSkillOperation(appliedPlan, operation);
      fs.mkdirSync(path.dirname(operation.destinationPath), { recursive: true });
      // Recheck directories that were absent during the first validation. This
      // narrows the symlink-swap window around mkdirSync, but path checks cannot
      // eliminate a later TOCTOU race before the file write.
      assertSafeInstallOperation(appliedPlan, operation);
      assertSafeClaudeSkillOperation(appliedPlan, operation);
      if (typeof beforeOperationWrite === 'function') {
        beforeOperationWrite({ plan: appliedPlan, operation });
      }
      assertNoNewUserOwnedFile(migration, operation);

      if (
        operation.kind === 'update-claude-settings'
        || operation.kind === 'remove-claude-settings-hooks'
      ) {
        // Re-read at the write boundary so unrelated settings added after
        // planning are preserved. A same-ID change still fails closed.
        const prepared = preparedClaudeSettings.get(operation);
        assertSafeInstallOperation(appliedPlan, operation);
        updateSettingsAtomic(operation.destinationPath, latestSettings => {
          const merged = operation.kind === 'remove-claude-settings-hooks'
            ? uninstallManagedHooks(latestSettings, prepared.managedHooks)
            : mergeManagedHooks(latestSettings, prepared.managedHooks, {
              previousManagedHooks: prepared.previousManagedHooks,
            });
          if (
            operation.kind === 'remove-claude-settings-hooks'
            && merged.retained.length > 0
          ) {
            throw new Error(
              `Refusing to disable modified Claude hooks in ${operation.destinationPath}; `
              + 'run the ECC uninstaller to review retained entries.'
            );
          }
          return merged;
        }, {
          lockHeld: settingsLockHeld,
          beforeCommit() {
            assertSafeInstallOperation(appliedPlan, operation);
          },
        });
        writtenDestinations.add(operation.destinationPath);
        if (operation.kind === 'remove-claude-settings-hooks') {
          completedHookRemovalCount += 1;
        }
        continue;
      }

      if (operation.kind === 'remove-managed-file') {
        if (removeManagedFileAtomic(appliedPlan, operation)) {
          cleanupEmptyManagedParents(operation.destinationPath, appliedPlan.targetRoot);
        }
        writtenDestinations.add(operation.destinationPath);
        completedHookRemovalCount += 1;
        continue;
      }

      if (
        operation.kind === 'update-antigravity-hooks'
        || operation.kind === 'remove-antigravity-hooks'
      ) {
        const prepared = preparedAntigravityHooks.get(operation);
        if (operation.kind === 'remove-antigravity-hooks' && !prepared.exists) {
          completedHookRemovalCount += 1;
          continue;
        }
        updateHookConfigAtomic(operation.destinationPath, currentConfig => {
          const result = operation.kind === 'remove-antigravity-hooks'
            ? uninstallManagedHookGroups(currentConfig, prepared.managedHookGroups)
            : mergeManagedHookGroups(currentConfig, prepared.managedHookGroups, {
              previousManagedHookGroups: prepared.previousManagedHookGroups,
            });
          if (operation.kind === 'remove-antigravity-hooks' && result.retained.length > 0) {
            throw new Error(
              `Refusing to disable modified Antigravity hook group(s): ${result.retained.join(', ')}`
            );
          }
          return result;
        }, {
          lockHeld: settingsLockHeld,
          beforeCommit() {
            assertSafeInstallOperation(appliedPlan, operation);
          },
        });
        writtenDestinations.add(operation.destinationPath);
        if (operation.kind === 'remove-antigravity-hooks') completedHookRemovalCount += 1;
        continue;
      }

      if (operation.kind === 'merge-json') {
        const payload = cloneJsonValue(operation.mergePayload);
        if (payload === undefined) {
          throw new Error(`Missing merge payload for ${operation.destinationPath}`);
        }

        const filteredPayload = (
          isMcpConfigPath(operation.destinationPath) && disabledServers.length > 0
        )
          ? filterMcpConfig(payload, disabledServers).config
          : payload;

        const currentValue = readOptionalJsonObject(
          operation.destinationPath,
          'existing JSON config'
        );
        const mergedValue = deepMergeJson(currentValue, filteredPayload);
        fs.writeFileSync(operation.destinationPath, formatJson(mergedValue), 'utf8');
        writtenDestinations.add(operation.destinationPath);
        continue;
      }

      if (operation.kind === 'copy-file' && isMcpConfigPath(operation.destinationPath) && disabledServers.length > 0) {
        const sourceConfig = readJsonObject(operation.sourcePath, 'MCP config');
        const filteredConfig = filterMcpConfig(sourceConfig, disabledServers).config;
        fs.writeFileSync(operation.destinationPath, formatJson(filteredConfig), 'utf8');
        writtenDestinations.add(operation.destinationPath);
        continue;
      }

      // Declared transforms are part of the install contract and always apply.
      // Markdown link rewriting is additive when the plan has a usable index.
      const needsLinkRewrite = Boolean(
        linkIndex
        && operation.sourceRelativePath
        && isMarkdownPath(operation.destinationPath)
      );
      if (operation.kind === 'copy-file' && (operation.contentTransform || needsLinkRewrite)) {
        const transformed = transformInstallContent(
          operation,
          fs.readFileSync(operation.sourcePath, 'utf8')
        );
        const installedContent = needsLinkRewrite
          ? rewriteRelativeLinks(transformed, {
            sourceRel: operation.sourceRelativePath,
            index: linkIndex,
          })
          : transformed;
        fs.writeFileSync(operation.destinationPath, installedContent, 'utf8');
        writtenDestinations.add(operation.destinationPath);
        continue;
      }

      copyManagedFileAtomic(appliedPlan, operation, beforeCopyRename);
      writtenDestinations.add(operation.destinationPath);
      }

      if (hasLegacyMigration) {
        removeLegacyClaudeSkillFiles(migration, plan.targetRoot);
      }

      if (shouldSetClaudeCommitAttributionPreference(appliedPlan)) {
        writeClaudeCommitAttributionPreference(
          getClaudeSettingsPath(plan.targetRoot),
          { lockHeld: settingsLockHeld }
        );
      }

      finalState = stateWithContentDigests(migration.finalState, appliedPlan);
      if (typeof beforeInstallStateWrite === 'function') {
        beforeInstallStateWrite({ plan: appliedPlan, state: finalState });
      }
      persistInstallState(plan.installStatePath, finalState);
    } catch (error) {
      if (migration.requiresBridgeState) {
        try {
          // The bridge was committed before any writes. Refresh it with hashes of
          // files that now exist so uninstall can remove only bytes this attempt
          // actually installed while preserving user changes.
          persistInstallState(
            plan.installStatePath,
            stateWithContentDigests(
              preserveUnwrittenFiles(
                hookRemovalCount > 0 && completedHookRemovalCount === hookRemovalCount
                  ? migration.finalState
                  : migration.bridgeState,
                migration,
                writtenDestinations
              ),
              {
                ...appliedPlan,
                operations: appliedPlan.operations.filter(operation => (
                  writtenDestinations.has(operation.destinationPath)
                )),
              }
            )
          );
        } catch (checkpointError) {
          throw new Error(
            `${error.message} Install-state checkpoint also failed: ${checkpointError.message}`,
            { cause: error }
          );
        }
      }
      throw error;
    }
    let antigravityMigrationWarnings = [];
  try {
    const antigravityMigration = cleanupLegacyAntigravityInstall(appliedPlan);
    if (antigravityMigration.detected && !antigravityMigration.complete) {
      antigravityMigrationWarnings = [
        'Legacy Antigravity migration is incomplete. ECC preserved modified, unverifiable, or unmanaged content under .agent; review and move anything you want to keep, then rerun the Antigravity install.',
        ...(Array.isArray(antigravityMigration.warnings) ? antigravityMigration.warnings : []),
      ];
    }
  } catch (error) {
    antigravityMigrationWarnings = [
      `Legacy Antigravity cleanup did not finish: ${error.message}. Content under .agent was preserved; remove it manually or rerun the Antigravity install.`,
    ];
  }

  let opencodeMigrationWarnings = [];
  try {
    const opencodeMigration = cleanupLegacyOpencodeInstall(appliedPlan);
    if (opencodeMigration.detected && !opencodeMigration.complete) {
      opencodeMigrationWarnings = [
        'Legacy OpenCode migration is incomplete. ECC preserved modified or unverifiable managed content under ~/.opencode; review it and rerun the OpenCode install.',
        ...(Array.isArray(opencodeMigration.warnings) ? opencodeMigration.warnings : []),
      ];
    }
  } catch (error) {
    opencodeMigrationWarnings = [
      `Legacy OpenCode cleanup did not finish: ${error.message}. Content under ~/.opencode was preserved; rerun the OpenCode install or review it manually.`,
    ];
  }

    return {
      ...plan,
      statePreview: finalState,
      plannedOperations: [...plan.operations],
      operations: migration.appliedOperations,
      skippedOperations: migration.skippedOperations,
      warnings: [
        ...(Array.isArray(plan.warnings) ? plan.warnings : []),
        ...migration.warnings,
        ...antigravityMigrationWarnings,
        ...opencodeMigrationWarnings,
      ],
      applied: true,
    };
}

module.exports = {
  applyInstallPlan,
  assertSafeInstallOperation,
  previewInstallPlan,
};
