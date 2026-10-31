const crypto = require('crypto');
const fs = require('fs');
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const { loadInstallManifests } = require('./install-manifests');
const { readInstallState, validateInstallState } = require('./install-state');
const { assertWithinTrustedRoot } = require('./path-safety');
const { createInstallPlanFromRequest } = require('./install/runtime');
const { assertNoNewUserOwnedFile, prepareUserOwnedFileGuard } = require('./install/ownership-guard');
const { withOpenCodeInstallLocks } = require('./install/opencode-install-lock');
const { isCodexUserConfig } = require('./install/codex-user-config');
const {
  getRecordedHookConsent,
  withHookConsent,
} = require('./install/hook-consent');
const {
  prepareClaudeSkillMigration,
} = require('./install/claude-skill-migration');
const {
  getLegacyAntigravityLocation,
  inspectLegacyAntigravityState,
} = require('./install/antigravity-legacy-migration');
const {
  getLegacyOpencodeLocation,
  inspectLegacyOpencodeState,
} = require('./install/opencode-legacy-migration');
const {
  acquireSettingsLock,
  getClaudeSettingsPath,
  inspectManagedHooks,
  materializeManagedHooks,
  repairManagedHooks,
  uninstallManagedHooks,
  updateSettingsAtomic,
  validateManagedHooks,
} = require('./install/claude-settings');
const { transformInstallContent } = require('./install/content-transform');
const { buildInstallIndex, rewriteRelativeLinks } = require('./install/link-rewrite');
const { getInstallTargetAdapter, listInstallTargetAdapters } = require('./install-targets/registry');
const { resolveInvocationEnvironment } = require('./invocation-environment');
const {
  assertClaudeSettingsDestination,
  cleanupEmptyParentDirs,
  copyContainedFile,
  getContainedExistingPath,
  getManagedDestination,
  prepareContainedWriteDestination,
  readFileNoFollow,
  readFileWithMetadataNoFollow,
  readHooksConfigNoFollow,
  readJsonNoFollow,
  removeContainedPath,
  writeContainedFile,
} = require('./install/contained-fs');
const {
  JSON_REMOVE_SENTINEL,
  deepMergeJson,
  deepRemoveJsonSubset,
  formatJson,
  getOperationJsonPayload,
  getOperationPreviousContent,
  getOperationPreviousJson,
  getOperationTextContent,
  jsonContainsSubset,
} = require('./install/json-ops');
const OPENCODE_BUILD_ARTIFACT = path.join('.opencode', 'dist');
const OPENCODE_BUILD_SCRIPT = path.join('scripts', 'build-opencode.js');
const OPENCODE_PLUGIN_NOT_BUILT_CODE = 'opencode-plugin-not-built';

const DEFAULT_REPO_ROOT = path.join(__dirname, '../..');

function readPackageVersion(repoRoot) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    return packageJson.version || null;
  } catch (_error) {
    return null;
  }
}

function normalizeTargets(targets) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return listInstallTargetAdapters().map(adapter => adapter.target);
  }

  const normalizedTargets = [];
  for (const target of targets) {
    const adapter = getInstallTargetAdapter(target);
    if (!normalizedTargets.includes(adapter.target)) {
      normalizedTargets.push(adapter.target);
    }
  }

  return normalizedTargets;
}

function compareStringArrays(left, right) {
  const leftValues = Array.isArray(left) ? left : [];
  const rightValues = Array.isArray(right) ? right : [];

  if (leftValues.length !== rightValues.length) {
    return false;
  }

  return leftValues.every((value, index) => value === rightValues[index]);
}

function buildRecordedManifestRequest(record) {
  const state = record.state || {};
  const request = state.request || {};

  return {
    mode: 'manifest',
    target: state.target && state.target.target ? state.target.target : record.adapter.target,
    profileId: request.profile || null,
    moduleIds: Array.isArray(request.modules) ? [...request.modules] : [],
    includeComponentIds: Array.isArray(request.includeComponents) ? [...request.includeComponents] : [],
    excludeComponentIds: Array.isArray(request.excludeComponents) ? [...request.excludeComponents] : [],
    legacyLanguages: Array.isArray(request.legacyLanguages) ? [...request.legacyLanguages] : [],
    hookConsent: getRecordedHookConsent(state),
  };
}

function resolveRecordedManifestPlan(record, context, options = {}) {
  return createInstallPlanFromRequest(buildRecordedManifestRequest(record), {
    sourceRoot: context.repoRoot,
    projectRoot: context.projectRoot,
    homeDir: context.homeDir,
    env: context.env,
    exemptValidationCodes: options.exemptValidationCodes || [],
  });
}

function hasOpencodeBuildError(issues) {
  return Array.isArray(issues) && issues.some(issue => issue.code === OPENCODE_PLUGIN_NOT_BUILT_CODE);
}

function getOpencodeBuildValidationIssues(context) {
  return getInstallTargetAdapter('opencode').validate({
    homeDir: context.homeDir,
    repoRoot: context.repoRoot,
    env: context.env,
  });
}

function buildOpencodePayload(repoRoot, buildRunner = execFileSync) {
  buildRunner(process.execPath, [path.join(repoRoot, OPENCODE_BUILD_SCRIPT)], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function formatBuildErrorMessage(error) {
  const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
  const stdout = typeof error.stdout === 'string' ? error.stdout.trim() : '';
  return stderr || stdout || error.message || 'Failed to build OpenCode payload';
}

function getManagedOperations(state) {
  return Array.isArray(state && state.operations) ? state.operations.filter(operation => operation.ownership === 'managed') : [];
}

function createUnsafeRepairSourceError() {
  return new Error(
    'Refusing unsafe repair source metadata: sources must stay within the repository.'
  );
}

function assertSafeRepairSourcePath(sourcePath, repoRoot) {
  try {
    return assertWithinTrustedRoot(sourcePath, repoRoot, 'read repair source');
  } catch {
    throw createUnsafeRepairSourceError();
  }
}

function resolveOperationSourcePath(repoRoot, operation) {
  if (operation.sourceRelativePath) {
    if (typeof operation.sourceRelativePath !== 'string') {
      throw createUnsafeRepairSourceError();
    }

    const sourceRelativePath = operation.sourceRelativePath;
    const hasParentTraversal = sourceRelativePath
      .split(/[/\\]+/)
      .includes('..');
    const isAbsolute = path.isAbsolute(sourceRelativePath)
      || path.win32.isAbsolute(sourceRelativePath);
    if (isAbsolute || hasParentTraversal) {
      throw createUnsafeRepairSourceError();
    }

    return assertSafeRepairSourcePath(
      path.resolve(repoRoot, sourceRelativePath),
      repoRoot
    );
  }

  if (!operation.sourcePath) {
    return null;
  }
  if (
    typeof operation.sourcePath !== 'string'
    || !path.isAbsolute(operation.sourcePath)
  ) {
    throw createUnsafeRepairSourceError();
  }
  return assertSafeRepairSourcePath(operation.sourcePath, repoRoot);
}

function areFilesEqual(leftPath, rightPath) {
  try {
    return readFileNoFollow(leftPath).equals(readFileNoFollow(rightPath));
  } catch (_error) {
    return false;
  }
}

function hasRecordedContentDigest(operation) {
  return /^[a-f0-9]{64}$/i.test(String(operation && operation.contentSha256 || ''));
}

function fileMatchesRecordedContent(filePath, operation) {
  if (!hasRecordedContentDigest(operation)) {
    return false;
  }

  try {
    return crypto.createHash('sha256')
      .update(readFileNoFollow(filePath))
      .digest('hex') === operation.contentSha256.toLowerCase();
  } catch (_error) {
    return false;
  }
}

function isMarkdownPath(filePath) {
  return /\.(md|mdx|markdown)$/i.test(String(filePath || ''));
}

function buildLinkIndexForOperations(operations, trustedRoot) {
  const mappings = (operations || [])
    .filter(operation => operation.kind === 'copy-file' && operation.sourceRelativePath)
    .map(operation => ({
      sourceRel: operation.sourceRelativePath,
      destRel: path.relative(trustedRoot, operation.destinationPath),
    }));
  return buildInstallIndex(mappings);
}

function getExpectedCopyFileContent(operation, content, linkIndex) {
  const transformed = transformInstallContent(operation, content);
  if (!linkIndex || !operation.sourceRelativePath || !isMarkdownPath(operation.destinationPath)) {
    return transformed;
  }
  return rewriteRelativeLinks(transformed, {
    sourceRel: operation.sourceRelativePath,
    index: linkIndex,
  });
}


function hydrateRecordedOperations(repoRoot, operations, trustedRoot) {
  return operations.map(operation => {
    if (operation.kind === 'update-claude-settings') {
      const sourcePath = resolveOperationSourcePath(repoRoot, operation);
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        throw new Error(
          `Missing source file for repair: ${sourcePath || operation.sourceRelativePath}`
        );
      }
      return {
        ...operation,
        sourcePath,
        previousManagedHooks: operation.managedHooks,
        managedHooks: materializeManagedHooks(
          readHooksConfigNoFollow(sourcePath),
          trustedRoot
        ),
      };
    }

    if (operation.kind !== 'copy-file') {
      return { ...operation };
    }

    return {
      ...operation,
      sourcePath: resolveOperationSourcePath(repoRoot, operation)
    };
  });
}

function buildRecordedStatePreview(state, context, operations) {
  return {
    ...state,
    operations: operations.map(operation => ({ ...operation })),
    source: {
      ...state.source,
      repoVersion: context.packageVersion,
      manifestVersion: context.manifestVersion
    },
    lastValidatedAt: new Date().toISOString()
  };
}

function shouldRepairFromRecordedOperations(state) {
  return getManagedOperations(state).some(operation => operation.kind !== 'copy-file');
}

function repairCopyFile(repoRoot, operation, trustedRoot, options) {
  const sourcePath = resolveOperationSourcePath(repoRoot, operation);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`Missing source file for repair: ${sourcePath || operation.sourceRelativePath}`);
  }

  if (operation.contentTransform || isMarkdownPath(operation.destinationPath)) {
    const source = readFileWithMetadataNoFollow(sourcePath, 'utf8');
    writeContainedFile(
      operation.destinationPath,
      getExpectedCopyFileContent(operation, source.content, options.linkIndex),
      trustedRoot,
      'repair',
      source.mode & 0o777,
      options.writeOptions
    );
  } else {
    copyContainedFile(sourcePath, operation.destinationPath, trustedRoot, 'repair');
  }
  return operation.destinationPath;
}

function repairRenderTemplate(operation, trustedRoot) {
  const renderedContent = getOperationTextContent(operation);
  if (renderedContent === null) {
    throw new Error(`Missing rendered content for repair: ${operation.destinationPath}`);
  }

  writeContainedFile(operation.destinationPath, renderedContent, trustedRoot, 'repair');
  return operation.destinationPath;
}

function repairMergeJson(operation, trustedRoot) {
  const payload = getOperationJsonPayload(operation);
  if (payload === undefined) {
    throw new Error(`Missing merge payload for repair: ${operation.destinationPath}`);
  }

  const existingDestination = getContainedExistingPath(operation.destinationPath, trustedRoot, 'repair');
  const currentValue = existingDestination
    ? readJsonNoFollow(
      getManagedDestination(existingDestination, trustedRoot, 'repair').managedPath
    )
    : {};
  const mergedValue = deepMergeJson(currentValue, payload);

  writeContainedFile(operation.destinationPath, formatJson(mergedValue), trustedRoot, 'repair');
  return operation.destinationPath;
}

function repairClaudeSettings(operation, trustedRoot, options) {
  assertClaudeSettingsDestination(operation, trustedRoot, options.target);
  const managedHooks = validateManagedHooks(operation.managedHooks);
  const previousManagedHooks = operation.previousManagedHooks
    ? validateManagedHooks(operation.previousManagedHooks, 'previous managed hooks')
    : null;
  const existingDestination = getContainedExistingPath(
    operation.destinationPath,
    trustedRoot,
    'repair'
  );
  const settingsPath = existingDestination
    ? getManagedDestination(existingDestination, trustedRoot, 'repair').managedPath
    : prepareContainedWriteDestination(operation.destinationPath, trustedRoot, 'repair');
  updateSettingsAtomic(
    settingsPath,
    currentSettings => repairManagedHooks(currentSettings, managedHooks, {
      previousManagedHooks,
    }),
    {
      lockHeld: options.settingsLockHeld,
      beforeCommit() {
        getManagedDestination(settingsPath, trustedRoot, 'repair');
      },
    }
  );
  return operation.destinationPath;
}

function repairRemove(operation, trustedRoot) {
  const removedPath = removeContainedPath(
    operation.destinationPath,
    trustedRoot,
    'repair',
    { recursive: true, force: true }
  );
  return removedPath ? operation.destinationPath : null;
}

/**
 * Apply one recorded operation to the install root. `options` carries
 * `linkIndex`, `target`, `settingsLockHeld`, and `writeOptions`.
 */
function executeRepairOperation(repoRoot, operation, trustedRoot, options = {}) {
  // Install-state is attacker-controllable; never write/delete outside the
  // adapter-derived trusted root, regardless of what the state file claims
  // (GHSA-hfpv-w6mp-5g95).
  const {
    linkIndex = null,
    target = null,
    settingsLockHeld = false,
    writeOptions = {},
  } = options;
  const resolved = { linkIndex, target, settingsLockHeld, writeOptions };

  switch (operation.kind) {
    case 'copy-file':
      return repairCopyFile(repoRoot, operation, trustedRoot, resolved);
    case 'render-template':
      return repairRenderTemplate(operation, trustedRoot);
    case 'merge-json':
      return repairMergeJson(operation, trustedRoot);
    case 'update-claude-settings':
      return repairClaudeSettings(operation, trustedRoot, resolved);
    case 'remove':
      return repairRemove(operation, trustedRoot);
    default:
      throw new Error(`Unsupported repair operation kind: ${operation.kind}`);
  }
}

function uninstallNoop() {
  return {
    removedPaths: [],
    cleanupTargets: []
  };
}

function uninstallRetained(operation) {
  return {
    removedPaths: [],
    cleanupTargets: [],
    retainedPaths: [operation.destinationPath]
  };
}

// Delete the managed destination and report it, or report nothing when it
// was already gone.
function uninstallRemovePath(operation, trustedRoot) {
  const removedPath = removeContainedPath(
    operation.destinationPath,
    trustedRoot,
    'uninstall',
    { force: true }
  );
  if (!removedPath) return uninstallNoop();

  return {
    removedPaths: [operation.destinationPath],
    cleanupTargets: [removedPath]
  };
}

// Restore the pre-install content when the operation recorded it. Returns
// null when nothing was recorded so the caller can fall through.
function restorePreviousContent(operation, trustedRoot) {
  const previousContent = getOperationPreviousContent(operation);
  if (previousContent !== null) {
    writeContainedFile(operation.destinationPath, previousContent, trustedRoot, 'uninstall');
    return uninstallNoop();
  }

  const previousJson = getOperationPreviousJson(operation);
  if (previousJson !== undefined) {
    writeContainedFile(operation.destinationPath, formatJson(previousJson), trustedRoot, 'uninstall');
    return uninstallNoop();
  }

  return null;
}

// Whether a drifted or symlinked copy must stay in place. Returns the
// uninstall result to report, or null when the copy may be removed.
function retainDriftedCopy(operation, trustedRoot) {
  const existingDestination = getContainedExistingPath(
    operation.destinationPath,
    trustedRoot,
    'uninstall',
    { allowFinalSymlink: true }
  );
  if (!existingDestination) return uninstallNoop();
  if (fs.lstatSync(existingDestination).isSymbolicLink()) return uninstallRetained(operation);

  const recordedDigest = operation.contentSha256;
  const currentDigest = /^[a-f0-9]{64}$/i.test(recordedDigest || '')
    ? crypto.createHash('sha256')
      .update(readFileNoFollow(existingDestination))
      .digest('hex')
    : null;
  if (!currentDigest || currentDigest !== recordedDigest.toLowerCase()) {
    return uninstallRetained(operation);
  }
  return null;
}

function uninstallCopyFile(operation, trustedRoot, options) {
  if (options.preserveDriftedCopies) {
    const retained = retainDriftedCopy(operation, trustedRoot);
    if (retained) return retained;
  }
  return uninstallRemovePath(operation, trustedRoot);
}

function uninstallRenderTemplate(operation, trustedRoot) {
  return restorePreviousContent(operation, trustedRoot) || uninstallRemovePath(operation, trustedRoot);
}

function uninstallMergeJson(operation, trustedRoot) {
  const restored = restorePreviousContent(operation, trustedRoot);
  if (restored) return restored;

  const existingDestination = getContainedExistingPath(
    operation.destinationPath,
    trustedRoot,
    'uninstall'
  );
  if (!existingDestination) return uninstallNoop();

  const payload = getOperationJsonPayload(operation);
  if (payload === undefined) {
    throw new Error(`Missing merge payload for uninstall: ${operation.destinationPath}`);
  }

  const currentValue = readJsonNoFollow(
    getManagedDestination(existingDestination, trustedRoot, 'uninstall').managedPath
  );
  const nextValue = deepRemoveJsonSubset(currentValue, payload);
  if (nextValue === JSON_REMOVE_SENTINEL) {
    const removedPath = removeContainedPath(
      operation.destinationPath,
      trustedRoot,
      'uninstall',
      { force: true }
    );
    return {
      removedPaths: removedPath ? [operation.destinationPath] : [],
      cleanupTargets: removedPath ? [removedPath] : []
    };
  }

  writeContainedFile(operation.destinationPath, formatJson(nextValue), trustedRoot, 'uninstall');
  return uninstallNoop();
}

function uninstallClaudeSettings(operation, trustedRoot, options) {
  assertClaudeSettingsDestination(operation, trustedRoot, options.target);
  const existingDestination = getContainedExistingPath(
    operation.destinationPath,
    trustedRoot,
    'uninstall'
  );
  if (!existingDestination) return uninstallNoop();

  const settingsPath = getManagedDestination(
    existingDestination,
    trustedRoot,
    'uninstall'
  ).managedPath;
  const uninstalled = updateSettingsAtomic(
    settingsPath,
    currentSettings => uninstallManagedHooks(currentSettings, operation.managedHooks),
    {
      lockHeld: Boolean(options.settingsLockHeld),
      beforeCommit() {
        getManagedDestination(settingsPath, trustedRoot, 'uninstall');
      },
    }
  );

  return {
    removedPaths: [],
    cleanupTargets: [],
    retainedPaths: uninstalled.retained.length > 0
      ? [operation.destinationPath]
      : []
  };
}

function uninstallRemoveOperation(operation, trustedRoot) {
  return restorePreviousContent(operation, trustedRoot) || uninstallNoop();
}

function executeUninstallOperation(operation, trustedRoot, options = {}) {
  // Confine deletes to the trusted install root (GHSA-hfpv-w6mp-5g95).
  switch (operation.kind) {
    case 'copy-file':
      return uninstallCopyFile(operation, trustedRoot, options);
    case 'render-template':
      return uninstallRenderTemplate(operation, trustedRoot);
    case 'merge-json':
      return uninstallMergeJson(operation, trustedRoot);
    case 'update-claude-settings':
      return uninstallClaudeSettings(operation, trustedRoot, options);
    case 'remove':
      return uninstallRemoveOperation(operation, trustedRoot);
    default:
      throw new Error(`Unsupported uninstall operation kind: ${operation.kind}`);
  }
}

function inspectionResult(status, operation, destinationPath, extra = {}) {
  return {
    status,
    operation,
    destinationPath,
    ...extra
  };
}

// Compare installed bytes with what the recorded copy operation should have
// written. Throws when either side cannot be read.
function copyFileContentMatches(operation, inspectedPath, copySourcePath, linkIndex) {
  // A deactivation transform changes the desired bytes. A historical
  // active-file digest proves ownership, not completion of that transition.
  const deactivatesOpenCode = operation.contentTransform === 'opencode-disable-ecc-hooks'
    || operation.contentTransform === 'opencode-disable-plugin-entrypoint';
  if (hasRecordedContentDigest(operation) && !deactivatesOpenCode) {
    return fileMatchesRecordedContent(inspectedPath, operation);
  }
  if (operation.contentTransform || isMarkdownPath(operation.destinationPath)) {
    return readFileNoFollow(inspectedPath, 'utf8') === getExpectedCopyFileContent(
      operation,
      readFileNoFollow(copySourcePath, 'utf8'),
      linkIndex
    );
  }
  return areFilesEqual(copySourcePath, inspectedPath);
}

function inspectCopyFileOperation(operation, inspectedPath, copySourcePath, linkIndex) {
  const { destinationPath } = operation;
  const sourcePath = copySourcePath;
  if (!copySourcePath || !fs.existsSync(copySourcePath)) {
    return inspectionResult('missing-source', operation, destinationPath, { sourcePath });
  }

  let contentMatches;
  try {
    contentMatches = copyFileContentMatches(operation, inspectedPath, copySourcePath, linkIndex);
  } catch (_error) {
    return inspectionResult('unverified', operation, destinationPath, { sourcePath });
  }

  return inspectionResult(contentMatches ? 'ok' : 'drifted', operation, destinationPath, { sourcePath });
}

function inspectRenderTemplateOperation(operation, inspectedPath) {
  const { destinationPath } = operation;
  const renderedContent = getOperationTextContent(operation);
  if (renderedContent === null) {
    return inspectionResult('unverified', operation, destinationPath);
  }

  try {
    if (readFileNoFollow(inspectedPath, 'utf8') !== renderedContent) {
      return inspectionResult('drifted', operation, destinationPath);
    }
  } catch {
    return inspectionResult('drifted', operation, destinationPath);
  }

  return inspectionResult('ok', operation, destinationPath);
}

function inspectMergeJsonOperation(operation, inspectedPath) {
  const { destinationPath } = operation;
  const payload = getOperationJsonPayload(operation);
  if (payload === undefined) {
    return inspectionResult('unverified', operation, destinationPath);
  }

  try {
    const currentValue = readJsonNoFollow(inspectedPath);
    if (!jsonContainsSubset(currentValue, payload)) {
      return inspectionResult('drifted', operation, destinationPath);
    }
  } catch (_error) {
    return inspectionResult('drifted', operation, destinationPath);
  }

  return inspectionResult('ok', operation, destinationPath);
}

function inspectClaudeSettingsOperation(operation, inspectedPath, trustedRoot, target) {
  const { destinationPath } = operation;
  try {
    assertClaudeSettingsDestination(operation, trustedRoot, target);
  } catch (_error) {
    return inspectionResult('unsafe-destination', operation, destinationPath, {
      reason: 'non-canonical-claude-settings'
    });
  }
  let managedHooks;
  try {
    managedHooks = validateManagedHooks(operation.managedHooks);
  } catch (_error) {
    return inspectionResult('unverified', operation, destinationPath);
  }

  try {
    const inspection = inspectManagedHooks(
      readJsonNoFollow(inspectedPath),
      managedHooks
    );
    return inspectionResult(inspection.status, operation, destinationPath, {
      managedHookInspection: inspection
    });
  } catch (error) {
    return inspectionResult('invalid-settings', operation, destinationPath, {
      error: `Failed to inspect Claude settings at ${destinationPath}: ${error.message}`
    });
  }
}

function inspectManagedOperation(repoRoot, trustedRoot, operation, linkIndex = null, target = null) {
  const destinationPath = operation.destinationPath;
  if (!destinationPath) {
    return {
      status: 'invalid-destination',
      operation
    };
  }

  let managedDestination;
  try {
    managedDestination = getManagedDestination(
      destinationPath,
      trustedRoot,
      'inspect managed operation',
      { allowFinalSymlink: operation.kind === 'remove' }
    );
  } catch (error) {
    return inspectionResult('unsafe-destination', operation, destinationPath, {
      reason: error && error.code === 'ECC_FINAL_DESTINATION_SYMLINK'
        ? 'final-symlink'
        : 'outside-root'
    });
  }

  const inspectedPath = managedDestination.managedPath;

  if (operation.kind === 'remove') {
    return inspectionResult(managedDestination.exists ? 'drifted' : 'ok', operation, destinationPath);
  }

  let copySourcePath = null;
  if (operation.kind === 'copy-file') {
    try {
      copySourcePath = resolveOperationSourcePath(repoRoot, operation);
    } catch {
      return inspectionResult('unsafe-source', operation, destinationPath);
    }
  }

  if (!managedDestination.exists) {
    return inspectionResult('missing', operation, destinationPath);
  }

  switch (operation.kind) {
    case 'copy-file':
      return inspectCopyFileOperation(operation, inspectedPath, copySourcePath, linkIndex);
    case 'render-template':
      return inspectRenderTemplateOperation(operation, inspectedPath);
    case 'merge-json':
      return inspectMergeJsonOperation(operation, inspectedPath);
    case 'update-claude-settings':
      return inspectClaudeSettingsOperation(operation, inspectedPath, trustedRoot, target);
    default:
      return inspectionResult('unverified', operation, destinationPath);
  }
}

function summarizeManagedOperationHealth(repoRoot, trustedRoot, operations, target = null) {
  const linkIndex = buildLinkIndexForOperations(operations, trustedRoot);
  return operations.reduce(
    (summary, operation) => {
      const inspection = inspectManagedOperation(
        repoRoot,
        trustedRoot,
        operation,
        linkIndex,
        target
      );
      if (inspection.status === 'missing') {
        summary.missing.push(inspection);
      } else if (inspection.status === 'drifted') {
        summary.drifted.push(inspection);
      } else if (inspection.status === 'missing-source') {
        summary.missingSource.push(inspection);
      } else if (inspection.status === 'unsafe-source') {
        summary.unsafeSource.push(inspection);
      } else if (inspection.status === 'unsafe-destination') {
        summary.unsafeDestination.push(inspection);
      } else if (inspection.status === 'invalid-settings') {
        summary.invalidSettings.push(inspection);
      } else if (inspection.status === 'unverified' || inspection.status === 'invalid-destination') {
        summary.unverified.push(inspection);
      }
      return summary;
    },
    {
      missing: [],
      drifted: [],
      missingSource: [],
      unsafeSource: [],
      unsafeDestination: [],
      invalidSettings: [],
      unverified: []
    }
  );
}

function getUnsafeManagedDestinationError(operationHealth) {
  const hasFinalSymlink = operationHealth.unsafeDestination.some(
    inspection => inspection.reason === 'final-symlink'
  );
  if (hasFinalSymlink) {
    return 'Refusing unsafe managed destination: final symlink detected.';
  }
  return 'Refusing unsafe managed destination outside adapter-derived install root.';
}

function getUnsafeOperationResult(record, operationHealth) {
  const error = operationHealth.unsafeDestination.length > 0
    ? getUnsafeManagedDestinationError(operationHealth)
    : operationHealth.unsafeSource.length > 0
      ? createUnsafeRepairSourceError().message
      : operationHealth.invalidSettings.length > 0
        ? operationHealth.invalidSettings[0].error
        : null;
  if (!error) {
    return null;
  }

  return {
    adapter: record.adapter,
    status: 'error',
    installStatePath: record.installStatePath,
    repairedPaths: [],
    plannedRepairs: [],
    stateRefreshed: false,
    error
  };
}

function buildDiscoveryRecord(adapter, context, location = null, knownState = null) {
  const installTargetInput = {
    homeDir: context.homeDir,
    projectRoot: context.projectRoot,
    repoRoot: context.projectRoot,
    env: context.env,
  };
  const targetRoot = location
    ? location.targetRoot
    : adapter.resolveRoot(installTargetInput);
  const installStatePath = location
    ? location.installStatePath
    : adapter.getInstallStatePath(installTargetInput);
  const exists = fs.existsSync(installStatePath);

  if (!exists) {
    return {
      adapter: {
        id: adapter.id,
        target: adapter.target,
        kind: adapter.kind
      },
      targetRoot,
      installStatePath,
      exists: false,
      state: null,
      error: null,
      legacy: Boolean(location),
      legacyLayout: location?.legacyLayout || null
    };
  }

  if (knownState) {
    return {
      adapter: {
        id: adapter.id,
        target: adapter.target,
        kind: adapter.kind
      },
      targetRoot,
      installStatePath,
      exists: true,
      state: knownState,
      error: null,
      legacy: Boolean(location),
      legacyLayout: location?.legacyLayout || null
    };
  }

  try {
    const state = readInstallState(installStatePath);
    return {
      adapter: {
        id: adapter.id,
        target: adapter.target,
        kind: adapter.kind
      },
      targetRoot,
      installStatePath,
      exists: true,
      state,
      error: null,
      legacy: Boolean(location),
      legacyLayout: location?.legacyLayout || null
    };
  } catch (error) {
    return {
      adapter: {
        id: adapter.id,
        target: adapter.target,
        kind: adapter.kind
      },
      targetRoot,
      installStatePath,
      exists: true,
      state: null,
      error: error.message,
      legacy: Boolean(location),
      legacyLayout: location?.legacyLayout || null
    };
  }
}

function discoverInstalledStates(options = {}) {
  const context = {
    homeDir: options.homeDir || process.env.HOME || os.homedir(),
    projectRoot: options.projectRoot || process.cwd(),
    env: resolveInvocationEnvironment(options),
  };
  const targets = normalizeTargets(options.targets);

  return targets.flatMap(target => {
    const adapter = getInstallTargetAdapter(target);
    const canonicalRecord = buildDiscoveryRecord(adapter, context);
    if (adapter.target === 'opencode') {
      const legacyLocation = getLegacyOpencodeLocation(context.homeDir);
      const legacyInspection = inspectLegacyOpencodeState(legacyLocation);
      if (
        path.resolve(legacyLocation.installStatePath) === path.resolve(canonicalRecord.installStatePath)
        || legacyInspection.status === 'absent'
        || legacyInspection.status === 'invalid'
      ) {
        return [canonicalRecord];
      }
      if (legacyInspection.status === 'unreadable') {
        return [canonicalRecord, {
          adapter: {
            id: adapter.id,
            target: adapter.target,
            kind: adapter.kind,
          },
          targetRoot: legacyLocation.targetRoot,
          installStatePath: legacyLocation.installStatePath,
          exists: true,
          state: null,
          error: legacyInspection.error,
          legacy: true,
          legacyLayout: 'opencode',
        }];
      }
      return [
        canonicalRecord,
        buildDiscoveryRecord(adapter, context, legacyLocation, legacyInspection.state),
      ];
    }

    if (adapter.target !== 'antigravity') {
      return [canonicalRecord];
    }

    const legacyLocation = {
      ...getLegacyAntigravityLocation(context.projectRoot),
      legacyLayout: 'antigravity',
    };
    const legacyInspection = inspectLegacyAntigravityState(legacyLocation);
    if (
      path.resolve(legacyLocation.installStatePath) === path.resolve(canonicalRecord.installStatePath)
      || legacyInspection.status === 'absent'
      || legacyInspection.status === 'invalid'
    ) {
      return [canonicalRecord];
    }

    if (legacyInspection.status === 'unreadable') {
      return [canonicalRecord, {
        adapter: {
          id: adapter.id,
          target: adapter.target,
          kind: adapter.kind,
        },
        targetRoot: legacyLocation.targetRoot,
        installStatePath: legacyLocation.installStatePath,
        exists: true,
        state: null,
          error: legacyInspection.error,
          legacy: true,
          legacyLayout: 'antigravity',
      }];
    }

    return [
      canonicalRecord,
      buildDiscoveryRecord(adapter, context, legacyLocation, legacyInspection.state),
    ];
  });
}

function buildIssue(severity, code, message, extra = {}) {
  return {
    severity,
    code,
    message,
    ...extra
  };
}

function determineStatus(issues) {
  if (issues.some(issue => issue.severity === 'error')) {
    return 'error';
  }

  if (issues.some(issue => issue.severity === 'warning')) {
    return 'warning';
  }

  return 'ok';
}

const LEGACY_LAYOUT_ISSUES = Object.freeze({
  antigravity: {
    code: 'legacy-antigravity-layout',
    message: 'Legacy Antigravity install-state remains under .agent. Review and move any preserved modified or unmanaged files out of .agent, then rerun the Antigravity install to finish migration.'
  },
  opencode: {
    code: 'legacy-opencode-layout',
    message: 'Legacy OpenCode install-state remains under ~/.opencode. Rerun the OpenCode install or repair command to migrate unchanged ECC-managed files to ~/.config/opencode; modified files are preserved for review.'
  }
});

function collectLegacyLayoutIssues(record, issues) {
  if (!Object.hasOwn(LEGACY_LAYOUT_ISSUES, record.legacyLayout)) return;
  const legacyIssue = LEGACY_LAYOUT_ISSUES[record.legacyLayout];
  issues.push(buildIssue('warning', legacyIssue.code, legacyIssue.message));
}

// Returns true when hook-deactivation planning itself failed, so the later
// resolution-drift check does not report the same failure twice.
function collectOpenCodeHookIssues(record, context, issues) {
  if (record.adapter.target !== 'opencode') return false;
  let checks;
  try {
    checks = prepareOpenCodeHookDeactivationChecks(record, context, { requireInactive: true });
  } catch (error) {
    issues.push(buildIssue('error', 'resolution-unavailable', error.message));
    return true;
  }
  try {
    for (const check of checks) assertOpenCodeRepairHookDeactivation(check.plan, check.options);
  } catch (error) {
    issues.push(buildIssue('error', 'opencode-hook-consent-violation', error.message));
  }
  return false;
}

function collectTargetPathIssues(record, state, issues) {
  if (!fs.existsSync(state.target.root)) {
    issues.push(buildIssue('error', 'missing-target-root', `Target root does not exist: ${state.target.root}`));
  }

  if (state.target.root !== record.targetRoot) {
    issues.push(
      buildIssue('warning', 'target-root-mismatch', `Recorded target root differs from current target root (${record.targetRoot})`, {
        recordedTargetRoot: state.target.root,
        currentTargetRoot: record.targetRoot
      })
    );
  }

  if (state.target.installStatePath !== record.installStatePath) {
    issues.push(
      buildIssue('warning', 'install-state-path-mismatch', `Recorded install-state path differs from current path (${record.installStatePath})`, {
        recordedInstallStatePath: state.target.installStatePath,
        currentInstallStatePath: record.installStatePath
      })
    );
  }
}

function collectOperationHealthIssues(record, context, state, issues) {
  const operationHealth = summarizeManagedOperationHealth(
    context.repoRoot,
    record.targetRoot,
    getManagedOperations(state),
    record.adapter.target
  );
  const destinationPaths = entries => entries.map(entry => entry.destinationPath);

  if (operationHealth.unsafeDestination.length > 0) {
    issues.push(
      buildIssue(
        'error',
        'unsafe-managed-destination',
        `${operationHealth.unsafeDestination.length} managed operation(s) target an unsafe destination`
      )
    );
  }

  if (operationHealth.unsafeSource.length > 0) {
    issues.push(
      buildIssue(
        'error',
        'unsafe-repair-source',
        `${operationHealth.unsafeSource.length} managed operation(s) reference unsafe repair source metadata`
      )
    );
  }

  if (operationHealth.invalidSettings.length > 0) {
    issues.push(
      buildIssue(
        'error',
        'invalid-claude-settings',
        operationHealth.invalidSettings[0].error,
        { paths: destinationPaths(operationHealth.invalidSettings) }
      )
    );
  }

  if (operationHealth.missing.length > 0) {
    issues.push(
      buildIssue('error', 'missing-managed-files', `${operationHealth.missing.length} managed file(s) are missing`, {
        paths: destinationPaths(operationHealth.missing)
      })
    );
  }

  if (operationHealth.drifted.length > 0) {
    issues.push(
      buildIssue('warning', 'drifted-managed-files', `${operationHealth.drifted.length} managed file(s) differ from the source repo`, {
        paths: destinationPaths(operationHealth.drifted)
      })
    );
  }

  if (operationHealth.missingSource.length > 0) {
    issues.push(
      buildIssue('error', 'missing-source-files', `${operationHealth.missingSource.length} source file(s) referenced by install-state are missing`, {
        paths: operationHealth.missingSource.map(entry => entry.sourcePath).filter(Boolean)
      })
    );
  }

  if (operationHealth.unverified.length > 0) {
    issues.push(
      buildIssue('warning', 'unverified-managed-operations', `${operationHealth.unverified.length} managed operation(s) could not be content-verified`, {
        paths: destinationPaths(operationHealth.unverified).filter(Boolean)
      })
    );
  }
}

function collectVersionIssues(context, state, issues) {
  if (state.source.manifestVersion !== context.manifestVersion) {
    issues.push(buildIssue('warning', 'manifest-version-mismatch', `Recorded manifest version ${state.source.manifestVersion} differs from current manifest version ${context.manifestVersion}`));
  }

  if (context.packageVersion && state.source.repoVersion && state.source.repoVersion !== context.packageVersion) {
    issues.push(buildIssue('warning', 'repo-version-mismatch', `Recorded repo version ${state.source.repoVersion} differs from current repo version ${context.packageVersion}`));
  }
}

function collectResolutionDriftIssues(record, context, state, issues) {
  try {
    const desiredPlan = resolveRecordedManifestPlan(record, context);

    if (!compareStringArrays(desiredPlan.selectedModuleIds, state.resolution.selectedModules) || !compareStringArrays(desiredPlan.skippedModuleIds, state.resolution.skippedModules)) {
      issues.push(
        buildIssue('warning', 'resolution-drift', 'Current manifest resolution differs from recorded install-state', {
          expectedSelectedModules: desiredPlan.selectedModuleIds,
          recordedSelectedModules: state.resolution.selectedModules,
          expectedSkippedModules: desiredPlan.skippedModuleIds,
          recordedSkippedModules: state.resolution.skippedModules
        })
      );
    }
  } catch (error) {
    issues.push(buildIssue('error', 'resolution-unavailable', error.message));
  }
}

function analyzeRecord(record, context) {
  const issues = [];
  collectLegacyLayoutIssues(record, issues);

  if (record.error) {
    issues.push(buildIssue('error', 'invalid-install-state', record.error));
    return {
      ...record,
      status: determineStatus(issues),
      issues
    };
  }

  const state = record.state;
  if (!state) {
    return {
      ...record,
      status: 'missing',
      issues
    };
  }

  const planningFailureReported = collectOpenCodeHookIssues(record, context, issues);
  collectTargetPathIssues(record, state, issues);
  collectOperationHealthIssues(record, context, state, issues);
  collectVersionIssues(context, state, issues);
  if (!state.request.legacyMode && !planningFailureReported) {
    collectResolutionDriftIssues(record, context, state, issues);
  }

  return {
    ...record,
    status: determineStatus(issues),
    issues
  };
}

function buildDoctorReport(options = {}) {
  const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : DEFAULT_REPO_ROOT;
  const manifests = loadInstallManifests({ repoRoot });
  const records = discoverInstalledStates({
    homeDir: options.homeDir,
    projectRoot: options.projectRoot,
    targets: options.targets,
    env: resolveInvocationEnvironment(options),
  }).filter(record => record.exists);
  const context = {
    repoRoot,
    homeDir: options.homeDir || process.env.HOME || os.homedir(),
    projectRoot: options.projectRoot || process.cwd(),
    env: resolveInvocationEnvironment(options),
    manifestVersion: manifests.modulesVersion,
    packageVersion: readPackageVersion(repoRoot)
  };
  const results = records.map(record => analyzeRecord(record, context));
  const summary = results.reduce(
    (accumulator, result) => {
      const errorCount = result.issues.filter(issue => issue.severity === 'error').length;
      const warningCount = result.issues.filter(issue => issue.severity === 'warning').length;

      return {
        checkedCount: accumulator.checkedCount + 1,
        okCount: accumulator.okCount + (result.status === 'ok' ? 1 : 0),
        errorCount: accumulator.errorCount + errorCount,
        warningCount: accumulator.warningCount + warningCount
      };
    },
    {
      checkedCount: 0,
      okCount: 0,
      errorCount: 0,
      warningCount: 0
    }
  );

  return {
    generatedAt: new Date().toISOString(),
    packageVersion: context.packageVersion,
    manifestVersion: context.manifestVersion,
    results,
    summary
  };
}

function createRepairPlanFromRecord(record, context, options = {}) {
  const state = record.state;
  if (!state) {
    throw new Error('No install-state available for repair');
  }

  if (
    record.legacyLayout !== 'opencode'
    && (state.request.legacyMode || shouldRepairFromRecordedOperations(state))
  ) {
    const operations = hydrateRecordedOperations(
      context.repoRoot,
      getManagedOperations(state),
      record.targetRoot
    );
    const statePreview = buildRecordedStatePreview(state, context, operations);

    const recordedPlan = {
      sourceRoot: context.repoRoot,
      mode: state.request.legacyMode ? 'legacy' : 'recorded',
      target: record.adapter.target,
      adapter: record.adapter,
      targetRoot: state.target.root,
      installRoot: state.target.root,
      installStatePath: state.target.installStatePath,
      warnings: [],
      languages: Array.isArray(state.request.legacyLanguages) ? [...state.request.legacyLanguages] : [],
      selectedModuleIds: [...(state.resolution.selectedModules || [])],
      operations,
      statePreview
    };
    return record.adapter.target === 'opencode'
      ? withHookConsent(recordedPlan, getRecordedHookConsent(state))
      : recordedPlan;
  }

  const desiredPlan = resolveRecordedManifestPlan(record, context, options);

  return {
    ...desiredPlan,
    statePreview: {
      ...desiredPlan.statePreview,
      installedAt: state.installedAt,
      lastValidatedAt: new Date().toISOString()
    }
  };
}

function buildAdapterDerivedStatePreview(statePreview, record) {
  return {
    ...statePreview,
    target: {
      ...statePreview.target,
      id: record.adapter.id,
      target: record.adapter.target,
      kind: record.adapter.kind,
      root: record.targetRoot,
      installStatePath: record.installStatePath
    }
  };
}

function assertValidInstallStateForWrite(state, label) {
  const validation = validateInstallState(state);
  if (validation.valid) {
    return;
  }

  const details = validation.errors
    .map(error => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
  throw new Error(`Invalid install-state (${label}): ${details}`);
}

function writeRefreshedInstallState(record, statePreview, writtenPaths = []) {
  const trustedStatePreview = buildAdapterDerivedStatePreview(statePreview, record);
  const stateWithCurrentDigests = {
    ...trustedStatePreview,
    operations: (trustedStatePreview.operations || []).map(operation => {
      if (!operation.destinationPath) {
        return { ...operation };
      }
      // Refreshing a ledger is not a file write. Keep the last installed digest
      // for untouched shared configs and OpenCode activations so a concurrent
      // user edit is never claimed, even by a partial repair checkpoint.
      if ((isCodexUserConfig(record, operation)
        || (record.adapter.target === 'opencode'
          && require('./install/apply').getOpenCodeActivationKind(record, operation)))
        && !writtenPaths.some(writtenPath => path.relative(writtenPath, operation.destinationPath) === '')) {
        const previousOperation = (record.state.operations || []).find(previous => (
          previous.destinationPath
          && path.relative(previous.destinationPath, operation.destinationPath) === ''
        ));
        const { contentSha256: _plannedDigest, ...operationWithoutDigest } = operation;
        return previousOperation && previousOperation.contentSha256
          ? { ...operationWithoutDigest, contentSha256: previousOperation.contentSha256 }
          : operationWithoutDigest;
      }
      try {
        const contentSha256 = crypto.createHash('sha256')
          .update(readFileNoFollow(operation.destinationPath))
          .digest('hex');
        return { ...operation, contentSha256 };
      } catch (_error) {
        const { contentSha256: _staleDigest, ...operationWithoutDigest } = operation;
        return operationWithoutDigest;
      }
    }),
  };
  assertValidInstallStateForWrite(stateWithCurrentDigests, record.installStatePath);
  return writeContainedFile(
    record.installStatePath,
    formatJson(stateWithCurrentDigests),
    record.targetRoot,
    'repair'
  );
}

function prepareRepairMigration(plan, record) {
  const trustedPlan = {
    ...plan,
    adapter: record.adapter,
    targetRoot: record.targetRoot,
    installRoot: record.targetRoot,
    installStatePath: record.installStatePath,
    statePreview: buildAdapterDerivedStatePreview(plan.statePreview, record),
  };
  const initialMigration = prepareClaudeSkillMigration(trustedPlan);
  // Repair normalizes recorded target metadata to the adapter-derived roots.
  // Preserve its recorded operations as the ownership evidence.
  const guardedMigration = prepareUserOwnedFileGuard(
    trustedPlan, initialMigration, buildAdapterDerivedStatePreview(record.state, record)
  );
  const migration = trustedPlan.target === 'opencode'
    ? require('./install/apply').prepareHookConsentMigration(trustedPlan, guardedMigration)
    : guardedMigration;
  return {
    migration,
    plan: {
      ...trustedPlan,
      operations: migration.finalState.operations,
      statePreview: migration.finalState,
      warnings: [
        ...(Array.isArray(plan.warnings) ? plan.warnings : []),
        ...migration.warnings,
      ],
    },
  };
}

function assertOpenCodeRepairHookDeactivation(plan, options = {}) {
  if (plan.target !== 'opencode') {
    return new Map();
  }
  // The installer imports lifecycle helpers. Resolve this shared read-only
  // guard lazily so both paths enforce the same discovery/ownership boundary.
  const { assertOpenCodeHookDeactivationReady } = require('./install/apply');
  return assertOpenCodeHookDeactivationReady(plan, options);
}

function prepareOpenCodeHookDeactivationChecks(record, context, options = {}) {
  if (record.adapter.target !== 'opencode') {
    return [];
  }
  const rawPlan = createRepairPlanFromRecord(record, context, {
    // Planning must reject unsafe existing activations before a repair build
    // writes compiled files. Missing payload is still validated/built later.
    exemptValidationCodes: [OPENCODE_PLUGIN_NOT_BUILT_CODE],
  });
  if (record.legacyLayout === 'opencode') {
    const state = record.state;
    const legacyPlan = withHookConsent({
      sourceRoot: context.repoRoot,
      target: 'opencode',
      adapter: record.adapter,
      targetRoot: record.targetRoot,
      installRoot: record.targetRoot,
      installStatePath: record.installStatePath,
      selectedModuleIds: [...(state.resolution.selectedModules || [])],
      operations: getManagedOperations(state),
      statePreview: buildAdapterDerivedStatePreview(state, record),
    }, getRecordedHookConsent(state));
    // Migration does not replay operations into the old root. Inspect existing
    // activations there, without treating historical merge-json records as new
    // writes; the canonical destination is validated separately below.
    return [
      { plan: { ...legacyPlan, operations: [] }, options: { allowVerifiedLegacyRemoval: true } },
      { plan: rawPlan, options },
    ];
  }
  const { plan } = prepareRepairMigration(rawPlan, record);
  return [{ plan, options }];
}

function preflightOpenCodeHookDeactivation(record, context, options = {}) {
  for (const check of prepareOpenCodeHookDeactivationChecks(record, context, options)) {
    assertOpenCodeRepairHookDeactivation(check.plan, check.options);
  }
}

function repairErrorResult(record, error) {
  return {
    adapter: record.adapter,
    status: 'error',
    installStatePath: record.installStatePath,
    repairedPaths: [],
    plannedRepairs: [],
    error
  };
}

function acquireRepairSettingsLock(record, options) {
  const settingsPathToLock = !options.dryRun
    && getManagedOperations(record.state || {}).some(
      operation => operation.kind === 'update-claude-settings'
    )
    ? getClaudeSettingsPath(record.targetRoot)
    : null;
  return settingsPathToLock ? acquireSettingsLock(settingsPathToLock) : null;
}

// Returns an error result when the OpenCode build fails, otherwise null.
function runOpencodeBuild(repair) {
  try {
    repair.buildOpencodeRunner(repair.context.repoRoot);
    return null;
  } catch (error) {
    return repairErrorResult(repair.record, formatBuildErrorMessage(error));
  }
}

// Legacy ~/.opencode layouts are migrated by applying the canonical plan
// rather than repairing files in place.
function repairLegacyOpencodeLayout(repair, build) {
  const { record, context, options, opencodeLease } = repair;
  const { needsOpencodeBuild, opencodeBuildRepairPath } = build;
  if (needsOpencodeBuild && !options.dryRun) {
    const buildFailure = runOpencodeBuild(repair);
    if (buildFailure) return buildFailure;
  }

  const canonicalPlan = createRepairPlanFromRecord(record, context, {
    exemptValidationCodes: options.dryRun && needsOpencodeBuild
      ? [OPENCODE_PLUGIN_NOT_BUILT_CODE]
      : [],
  });
  assertOpenCodeRepairHookDeactivation(canonicalPlan);
  const buildPaths = needsOpencodeBuild ? [opencodeBuildRepairPath] : [];
  const planPaths = canonicalPlan.operations.map(operation => operation.destinationPath);
  const plannedRepairs = [...new Set([
    ...buildPaths,
    ...planPaths,
    ...getManagedOperations(record.state).map(operation => operation.destinationPath),
    record.installStatePath,
  ])];

  if (options.dryRun) {
    return {
      adapter: record.adapter,
      status: 'planned',
      installStatePath: canonicalPlan.installStatePath,
      repairedPaths: [],
      plannedRepairs,
      stateRefreshed: false,
      warnings: canonicalPlan.warnings,
      error: null,
    };
  }

  // Load lazily to avoid a module cycle during install-lifecycle startup.
  const { applyInstallPlan } = require('./install/apply');
  const appliedPlan = applyInstallPlan(canonicalPlan, { opencodeLease });
  return {
    adapter: record.adapter,
    status: 'repaired',
    installStatePath: canonicalPlan.installStatePath,
    repairedPaths: [...buildPaths, ...planPaths],
    plannedRepairs: [],
    stateRefreshed: true,
    warnings: appliedPlan.warnings,
    error: null,
  };
}

// Dry run while the OpenCode plugin is not built: plan around the missing
// artifact instead of failing validation.
function planOpencodeBuildRepair(repair, build) {
  const { record, context } = repair;
  const rawPlan = createRepairPlanFromRecord(record, context, {
    exemptValidationCodes: [OPENCODE_PLUGIN_NOT_BUILT_CODE],
  });
  const { plan: desiredPlan } = prepareRepairMigration(rawPlan, record);
  const operationHealth = summarizeManagedOperationHealth(
    context.repoRoot,
    record.targetRoot,
    desiredPlan.operations,
    record.adapter.target
  );
  const unsafeOperationResult = getUnsafeOperationResult(record, operationHealth);
  if (unsafeOperationResult) return unsafeOperationResult;

  const repairOperations = [
    ...operationHealth.missing.map(entry => ({ ...entry.operation })),
    ...operationHealth.drifted.map(entry => ({ ...entry.operation })),
  ];
  const plannedRepairs = [
    build.opencodeBuildRepairPath,
    ...repairOperations.map(operation => operation.destinationPath),
  ];

  return {
    adapter: record.adapter,
    status: 'planned',
    installStatePath: record.installStatePath,
    repairedPaths: [],
    plannedRepairs,
    stateRefreshed: false,
    warnings: desiredPlan.warnings,
    error: null
  };
}

// Missing and drifted managed files, plus settings operations whose managed
// hooks changed since the previous install. Deduplicated by kind and path.
function collectRepairOperations(operationHealth, desiredPlan) {
  return [
    ...operationHealth.missing.map(entry => ({ ...entry.operation })),
    ...operationHealth.drifted.map(entry => ({ ...entry.operation })),
    ...desiredPlan.operations
      .filter(operation => (
        operation.kind === 'update-claude-settings'
        && operation.previousManagedHooks
        && !isDeepStrictEqual(operation.previousManagedHooks, operation.managedHooks)
      ))
      .map(operation => ({ ...operation })),
  ].filter((operation, index, items) => items.findIndex(candidate => (
    candidate.kind === operation.kind
    && candidate.destinationPath === operation.destinationPath
  )) === index);
}

function executeGuardedRepairOperation(repair, plan, operation, repairedPaths) {
  const { record, context, settingsLockHeld } = repair;
  const { desiredPlan, migration, activationSnapshot, repairLinkIndex } = plan;
  const apply = require('./install/apply');
  if (operation.sourceRelativePath === 'manifests/install-assets/commonjs-scripts-package.json') {
    apply.assertOpenCodeScriptBoundary(desiredPlan, new Set(repairedPaths));
  }
  if (desiredPlan.target === 'opencode') {
    apply.assertOpenCodeActivationUnchanged(desiredPlan, operation, activationSnapshot);
  }
  assertNoNewUserOwnedFile(migration, operation, desiredPlan);
  const repairedPath = executeRepairOperation(context.repoRoot, operation, record.targetRoot, {
    linkIndex: repairLinkIndex,
    target: record.adapter.target,
    settingsLockHeld,
    writeOptions: apply.getOpenCodeActivationWriteOptions(operation, activationSnapshot),
  });
  if (repairedPath) {
    repairedPaths.push(repairedPath);
  }
}

function removeLegacyMigrationPaths(record, migration, repairedPaths) {
  for (const operation of migration.legacyOperationsToRemove) {
    const removedPath = removeContainedPath(
      operation.destinationPath,
      record.targetRoot,
      'migrate managed Claude skill',
      { force: true }
    );
    if (removedPath) {
      repairedPaths.push(removedPath);
    }
  }
}

function applyRecordRepairs(repair, build, plan) {
  const { record } = repair;
  const { needsOpencodeBuild, opencodeBuildRepairPath } = build;
  const { desiredPlan, migration, activationSnapshot, repairOperations } = plan;
  const hasLegacyMigration = migration.legacyOperationsToRemove.length > 0;
  const repairedPaths = needsOpencodeBuild ? [opencodeBuildRepairPath] : [];
  if (desiredPlan.target === 'opencode') {
    const { assertOpenCodeActivationUnchanged } = require('./install/apply');
    // Health inspection must not let a changed activation become owned by
    // a bridge checkpoint before the per-write check can reject it.
    for (const destinationPath of activationSnapshot.keys()) {
      assertOpenCodeActivationUnchanged(desiredPlan, { destinationPath }, activationSnapshot);
    }
  }
  if (migration.requiresBridgeState && (repairOperations.length > 0 || hasLegacyMigration)) {
    writeRefreshedInstallState(record, migration.bridgeState);
  }

  for (const operation of repairOperations) {
    executeGuardedRepairOperation(repair, plan, operation, repairedPaths);
  }
  if (hasLegacyMigration) {
    removeLegacyMigrationPaths(record, migration, repairedPaths);
  }

  const changedInstalledBytes = repairOperations.length > 0
    || needsOpencodeBuild
    || hasLegacyMigration;
  const statePreviewToWrite = changedInstalledBytes
    ? desiredPlan.statePreview
    : {
        ...desiredPlan.statePreview,
        installedAt: record.state.installedAt,
        source: { ...record.state.source },
      };
  assertOpenCodeRepairHookDeactivation(desiredPlan, { requireInactive: true });
  writeRefreshedInstallState(record, statePreviewToWrite, repairedPaths);

  return {
    adapter: record.adapter,
    status: changedInstalledBytes ? 'repaired' : 'ok',
    installStatePath: record.installStatePath,
    repairedPaths,
    plannedRepairs: [],
    stateRefreshed: true,
    warnings: desiredPlan.warnings,
    error: null
  };
}

function repairManagedRecord(repair, build) {
  const { record, context, options } = repair;
  const { needsOpencodeBuild, opencodeBuildRepairPath } = build;
  const rawPlan = createRepairPlanFromRecord(record, context);
  require('./install/apply').assertOpenCodeScriptBoundary(rawPlan);
  const {
    migration,
    plan: desiredPlan,
  } = prepareRepairMigration(rawPlan, record);
  const activationSnapshot = assertOpenCodeRepairHookDeactivation(desiredPlan);
  const operationHealth = summarizeManagedOperationHealth(
    context.repoRoot,
    record.targetRoot,
    desiredPlan.operations,
    record.adapter.target
  );

  const unsafeOperationResult = getUnsafeOperationResult(record, operationHealth);
  if (unsafeOperationResult) return unsafeOperationResult;

  if (operationHealth.missingSource.length > 0) {
    return {
      adapter: record.adapter,
      status: 'error',
      installStatePath: record.installStatePath,
      repairedPaths: [],
      plannedRepairs: [],
      warnings: desiredPlan.warnings,
      error: `Missing source file(s): ${operationHealth.missingSource.map(entry => entry.sourcePath).join(', ')}`
    };
  }

  const repairOperations = collectRepairOperations(operationHealth, desiredPlan);
  const repairLinkIndex = buildLinkIndexForOperations(desiredPlan.operations, record.targetRoot);
  const legacyMigrationPaths = migration.legacyOperationsToRemove.map(
    operation => operation.destinationPath
  );
  const plannedRepairs = [...new Set([
    ...(needsOpencodeBuild ? [opencodeBuildRepairPath] : []),
    ...repairOperations.map(operation => operation.destinationPath),
    ...legacyMigrationPaths,
  ])];

  if (options.dryRun) {
    return {
      adapter: record.adapter,
      status: plannedRepairs.length > 0 ? 'planned' : 'ok',
      installStatePath: record.installStatePath,
      repairedPaths: [],
      plannedRepairs,
      stateRefreshed: plannedRepairs.length === 0,
      warnings: desiredPlan.warnings,
      error: null
    };
  }

  return applyRecordRepairs(repair, build, {
    desiredPlan,
    migration,
    activationSnapshot,
    repairOperations,
    repairLinkIndex,
  });
}

// Repair one discovered record. `repair` carries the record, lifecycle
// context, caller options, the OpenCode build runner, an optional OpenCode
// lease, and whether the Claude settings lock is already held.
function runRecordRepair(repair) {
  const { record, context, options } = repair;
  const needsOpencodeBuild = record.adapter.target === 'opencode'
    && hasOpencodeBuildError(getOpencodeBuildValidationIssues(context));
  const build = {
    needsOpencodeBuild,
    opencodeBuildRepairPath: path.join(context.repoRoot, OPENCODE_BUILD_ARTIFACT),
  };

  if (record.legacyLayout === 'opencode') return repairLegacyOpencodeLayout(repair, build);
  if (needsOpencodeBuild && options.dryRun) return planOpencodeBuildRepair(repair, build);
  if (needsOpencodeBuild) {
    const buildFailure = runOpencodeBuild(repair);
    if (buildFailure) return buildFailure;
  }
  return repairManagedRecord(repair, build);
}

function repairInstalledStates(options = {}) {
  const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : DEFAULT_REPO_ROOT;
  const manifests = loadInstallManifests({ repoRoot });
  const context = {
    repoRoot,
    homeDir: options.homeDir || process.env.HOME || os.homedir(),
    projectRoot: options.projectRoot || process.cwd(),
    env: resolveInvocationEnvironment(options),
    manifestVersion: manifests.modulesVersion,
    packageVersion: readPackageVersion(repoRoot)
  };
  const buildOpencodeRunner = typeof options.buildOpencodePayload === 'function'
    ? options.buildOpencodePayload
    : buildOpencodePayload;
  const records = discoverInstalledStates({
    homeDir: context.homeDir,
    projectRoot: context.projectRoot,
    targets: options.targets,
    env: context.env,
  }).filter(record => (
    record.exists
    && (!record.legacy || record.legacyLayout === 'opencode')
  ));

  const results = records.map(initialRecord => {
    let record = initialRecord;
    const performRepair = (opencodeLease) => {
      if (record.error) return repairErrorResult(record, record.error);

      let releaseSettingsLock = null;
      try {
        preflightOpenCodeHookDeactivation(record, context);
        releaseSettingsLock = acquireRepairSettingsLock(record, options);
        return runRecordRepair({
          record,
          context,
          options,
          buildOpencodeRunner,
          opencodeLease,
          settingsLockHeld: Boolean(releaseSettingsLock),
        });
      } catch (error) {
        return repairErrorResult(record, error.message);
      } finally {
        if (releaseSettingsLock) releaseSettingsLock();
      }
    };
    if (record.adapter.target !== 'opencode' || options.dryRun) return performRepair();
    let repairResult;
    try {
      const adapter = getInstallTargetAdapter('opencode');
      const targetRoot = adapter.resolveRoot({
        homeDir: context.homeDir, projectRoot: context.projectRoot,
        repoRoot: context.projectRoot, env: context.env,
      });
      const { getOpenCodeInstallRoots, assertOpenCodeLeaseCoverage } = require('./install/apply');
      const roots = getOpenCodeInstallRoots({ adapter, targetRoot, homeDir: context.homeDir });
      return withOpenCodeInstallLocks(roots, lease => {
        assertOpenCodeLeaseCoverage({ adapter, targetRoot, homeDir: context.homeDir }, lease);
        // Discovery precedes acquisition. Never repair from that stale state.
        record = buildDiscoveryRecord(adapter, context, record.legacyLayout === 'opencode'
          ? getLegacyOpencodeLocation(context.homeDir) : null);
        if (!record.exists || record.error) {
          throw new Error(record.error || 'OpenCode install-state disappeared before repair.');
        }
        repairResult = performRepair(lease);
        return repairResult;
      });
    } catch (error) {
      if (repairResult?.status === 'error') {
        return { ...repairResult, releaseError: error.message };
      }
      return { adapter: record.adapter, status: 'error', installStatePath: record.installStatePath,
        repairedPaths: repairResult?.repairedPaths || [], plannedRepairs: [], error: error.message };
    }
  });

  const summary = results.reduce(
    (accumulator, result) => ({
      checkedCount: accumulator.checkedCount + 1,
      repairedCount: accumulator.repairedCount + (result.status === 'repaired' ? 1 : 0),
      plannedRepairCount: accumulator.plannedRepairCount + (result.status === 'planned' ? 1 : 0),
      errorCount: accumulator.errorCount + (result.status === 'error' ? 1 : 0)
    }),
    {
      checkedCount: 0,
      repairedCount: 0,
      plannedRepairCount: 0,
      errorCount: 0
    }
  );

  return {
    dryRun: Boolean(options.dryRun),
    generatedAt: new Date().toISOString(),
    results,
    summary
  };
}


function uninstallInstalledStates(options = {}) {
  const records = discoverInstalledStates({
    homeDir: options.homeDir,
    projectRoot: options.projectRoot,
    targets: options.targets,
    env: resolveInvocationEnvironment(options),
  }).filter(record => record.exists);

  const results = records.map(record => {
    if (record.error || !record.state) {
      return {
        adapter: record.adapter,
        status: 'error',
        installStatePath: record.installStatePath,
        removedPaths: [],
        plannedRemovals: [],
        error: record.error || 'No valid install-state available'
      };
    }

    const state = record.state;
    const managedOperations = getManagedOperations(state);
    if (record.legacyLayout === 'antigravity' && managedOperations.length > 0) {
      return {
        adapter: record.adapter,
        status: 'partial',
        installStatePath: record.installStatePath,
        removedPaths: [],
        plannedRemovals: [],
        retainedPaths: managedOperations.map(operation => operation.destinationPath),
        warning: 'Legacy Antigravity files were preserved because their provenance cannot be revalidated during uninstall. Rerun the Antigravity installer to migrate verified files, then review .agent manually.',
        error: null
      };
    }
    const plannedRemovals = Array.from(new Set([
      ...managedOperations.map(operation => operation.destinationPath),
      record.installStatePath
    ]));

    if (options.dryRun) {
      return {
        adapter: record.adapter,
        status: 'planned',
        installStatePath: record.installStatePath,
        removedPaths: [],
        plannedRemovals,
        error: null
      };
    }

    let releaseSettingsLock = null;
    try {
      const removedPaths = [];
      const cleanupTargets = [];
      const retainedPaths = [];
      const operations = getManagedOperations(state);
      if (operations.some(operation => operation.kind === 'update-claude-settings')) {
        releaseSettingsLock = acquireSettingsLock(
          getClaudeSettingsPath(record.targetRoot)
        );
      }

      const { isScriptBoundary, retainScriptBoundary } = require('./install/opencode-script-boundary');
      // Remove owned script bodies first. Keep their CommonJS scope while any
      // retained or user-created JavaScript still relies on that boundary.
      const orderedOperations = [
        ...operations.filter(operation => !isScriptBoundary(operation, record.targetRoot)),
        ...operations.filter(operation => isScriptBoundary(operation, record.targetRoot)),
      ];
      for (const operation of orderedOperations) {
        if (retainScriptBoundary(operation, record.targetRoot)) {
          retainedPaths.push(operation.destinationPath);
          continue;
        }
        const outcome = executeUninstallOperation(operation, record.targetRoot, {
          preserveDriftedCopies: true,
          target: record.adapter.target,
          settingsLockHeld: Boolean(releaseSettingsLock),
        });
        removedPaths.push(...outcome.removedPaths);
        cleanupTargets.push(...outcome.cleanupTargets);
        retainedPaths.push(...(outcome.retainedPaths || []));
      }

      if (retainedPaths.length === 0) {
        const removedStatePath = removeContainedPath(
          record.installStatePath,
          record.targetRoot,
          'uninstall',
          { force: true }
        );
        if (removedStatePath) {
          removedPaths.push(record.installStatePath);
          cleanupTargets.push(removedStatePath);
        }
      }

      for (const cleanupTarget of cleanupTargets) {
        cleanupEmptyParentDirs(cleanupTarget, record.targetRoot);
      }

      return {
        adapter: record.adapter,
        status: retainedPaths.length > 0 ? 'partial' : 'uninstalled',
        installStatePath: record.installStatePath,
        removedPaths,
        retainedPaths: [...new Set(retainedPaths)].sort(),
        plannedRemovals: [],
        warning: retainedPaths.length > 0
          ? 'Modified or unverifiable managed files were preserved together with install-state for review.'
          : null,
        error: null
      };
    } catch (error) {
      return {
        adapter: record.adapter,
        status: 'error',
        installStatePath: record.installStatePath,
        removedPaths: [],
        plannedRemovals,
        error: error.message
      };
    } finally {
      if (releaseSettingsLock) releaseSettingsLock();
    }
  });

  const summary = results.reduce(
    (accumulator, result) => ({
      checkedCount: accumulator.checkedCount + 1,
      uninstalledCount: accumulator.uninstalledCount + (result.status === 'uninstalled' ? 1 : 0),
      plannedRemovalCount: accumulator.plannedRemovalCount + (result.status === 'planned' ? 1 : 0),
      partialCount: accumulator.partialCount + (result.status === 'partial' ? 1 : 0),
      errorCount: accumulator.errorCount + (result.status === 'error' ? 1 : 0)
    }),
    {
      checkedCount: 0,
      uninstalledCount: 0,
      plannedRemovalCount: 0,
      partialCount: 0,
      errorCount: 0
    }
  );

  return {
    dryRun: Boolean(options.dryRun),
    generatedAt: new Date().toISOString(),
    results,
    summary
  };
}

module.exports = {
  DEFAULT_REPO_ROOT,
  buildDoctorReport,
  discoverInstalledStates,
  normalizeTargets,
  repairInstalledStates,
  uninstallInstalledStates
};
