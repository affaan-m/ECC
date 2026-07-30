const fs = require('fs');
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');

const { resolveInstallPlan, loadInstallManifests } = require('./install-manifests');
const { readInstallState, validateInstallState } = require('./install-state');
const { assertWithinTrustedRoot } = require('./path-safety');
const { createManifestInstallPlan } = require('./install-executor');
const {
  prepareClaudeSkillMigration,
} = require('./install/claude-skill-migration');
const {
  assertHookAuthorizationReady,
  buildHookMaterializationAuthorization,
} = require('./install/hook-authorizations');
const { getInstallTargetAdapter, listInstallTargetAdapters } = require('./install-targets/registry');
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

function hasOpencodeBuildError(issues) {
  return Array.isArray(issues) && issues.some(issue => issue.code === OPENCODE_PLUGIN_NOT_BUILT_CODE);
}

function getOpencodeBuildValidationIssues(context, state) {
  const selectedModuleIds = Array.isArray(state?.resolution?.selectedModules)
    ? state.resolution.selectedModules
    : [];
  return getInstallTargetAdapter('opencode').validate({
    homeDir: context.homeDir,
    repoRoot: context.repoRoot,
    modules: selectedModuleIds.map(id => ({ id })),
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

function assertRecordedHookAuthorizationReady(state, operations = getManagedOperations(state)) {
  assertHookAuthorizationReady({
    selectedModuleIds: state?.resolution?.selectedModules || [],
    operations,
    hookAuthorization: buildHookMaterializationAuthorization(
      state?.request?.hookAuthorizations || {}
    ),
  });
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function parseJsonLikeValue(value, label) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid ${label}: ${error.message}`);
    }
  }

  if (value === null || Array.isArray(value) || isPlainObject(value) || typeof value === 'number' || typeof value === 'boolean') {
    return cloneJsonValue(value);
  }

  throw new Error(`Invalid ${label}: expected JSON-compatible data`);
}

function getOperationTextContent(operation) {
  const candidateKeys = ['renderedContent', 'content', 'managedContent', 'expectedContent', 'templateOutput'];

  for (const key of candidateKeys) {
    if (typeof operation[key] === 'string') {
      return operation[key];
    }
  }

  return null;
}

function getOperationJsonPayload(operation) {
  const candidateKeys = ['mergePayload', 'managedPayload', 'payload', 'value', 'expectedValue'];

  for (const key of candidateKeys) {
    if (operation[key] !== undefined) {
      return parseJsonLikeValue(operation[key], `${operation.kind}.${key}`);
    }
  }

  return undefined;
}

function getOperationPreviousContent(operation) {
  const candidateKeys = ['previousContent', 'originalContent', 'backupContent'];

  for (const key of candidateKeys) {
    if (typeof operation[key] === 'string') {
      return operation[key];
    }
  }

  return null;
}

function getOperationPreviousJson(operation) {
  const candidateKeys = ['previousValue', 'previousJson', 'originalValue'];

  for (const key of candidateKeys) {
    if (operation[key] !== undefined) {
      return parseJsonLikeValue(operation[key], `${operation.kind}.${key}`);
    }
  }

  return undefined;
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function getManagedDestination(
  destinationPath,
  trustedRoot,
  action,
  { allowFinalSymlink = false } = {}
) {
  if (!destinationPath || typeof destinationPath !== 'string') {
    throw new Error(`Refusing to ${action}: missing destination path.`);
  }

  const canonicalRoot = assertWithinTrustedRoot(trustedRoot, trustedRoot, action);
  const resolvedDestination = path.resolve(destinationPath);
  const canonicalParent = assertWithinTrustedRoot(
    path.dirname(resolvedDestination),
    canonicalRoot,
    action
  );
  const managedPath = path.join(canonicalParent, path.basename(resolvedDestination));
  let stat = null;

  try {
    stat = fs.lstatSync(managedPath);
  } catch (error) {
    if (!error || (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')) {
      throw error;
    }
  }

  if (stat && stat.isSymbolicLink() && !allowFinalSymlink) {
    const error = new Error(
      `Refusing to ${action}: managed destination is a final symlink.`
    );
    error.code = 'ECC_FINAL_DESTINATION_SYMLINK';
    throw error;
  }

  return {
    canonicalRoot,
    exists: stat !== null,
    isFinalSymlink: Boolean(stat && stat.isSymbolicLink()),
    managedPath
  };
}

function ensureContainedParentDir(destinationPath, trustedRoot, action) {
  const initialDestination = getManagedDestination(
    destinationPath,
    trustedRoot,
    action
  );
  const { canonicalRoot, managedPath } = initialDestination;
  const canonicalParent = path.dirname(managedPath);
  const relativeParent = path.relative(canonicalRoot, canonicalParent);
  const pathSegments = relativeParent
    ? relativeParent.split(path.sep).filter(Boolean)
    : [];
  let currentPath = canonicalRoot;

  for (const segment of pathSegments) {
    const validatedParent = assertWithinTrustedRoot(currentPath, canonicalRoot, action);
    const nextPath = path.join(validatedParent, segment);
    try {
      fs.mkdirSync(nextPath);
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw error;
      }
    }

    const validatedNext = assertWithinTrustedRoot(nextPath, canonicalRoot, action);
    const nextStat = fs.lstatSync(validatedNext);
    if (!nextStat.isDirectory() || nextStat.isSymbolicLink()) {
      throw new Error(`Refusing to ${action}: destination parent is not a trusted directory.`);
    }
    currentPath = validatedNext;
  }

  return getManagedDestination(managedPath, canonicalRoot, action).managedPath;
}

function prepareContainedWriteDestination(destinationPath, trustedRoot, action) {
  return ensureContainedParentDir(destinationPath, trustedRoot, action);
}

function getContainedExistingPath(
  destinationPath,
  trustedRoot,
  action,
  { allowFinalSymlink = false } = {}
) {
  const initialDestination = getManagedDestination(
    destinationPath,
    trustedRoot,
    action,
    { allowFinalSymlink }
  );
  const followsToExistingPath = fs.existsSync(initialDestination.managedPath);
  if (!followsToExistingPath && !initialDestination.isFinalSymlink) {
    return null;
  }

  const finalDestination = getManagedDestination(
    initialDestination.managedPath,
    trustedRoot,
    action,
    { allowFinalSymlink }
  );
  return finalDestination.exists ? finalDestination.managedPath : null;
}

function hasSameFileIdentity(leftStat, rightStat) {
  return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
}

function createChangedDestinationError(action) {
  return new Error(
    `Refusing to ${action}: managed destination changed during the write.`
  );
}

function getStableParentStat(filePath, action) {
  const parentStat = fs.lstatSync(path.dirname(filePath));
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw createChangedDestinationError(action);
  }
  return parentStat;
}

function assertPinnedWriteDestination(
  filePath,
  fileDescriptor,
  expectedParentStat,
  trustedRoot,
  action
) {
  const liveDestination = getManagedDestination(filePath, trustedRoot, action);
  if (path.resolve(liveDestination.managedPath) !== path.resolve(filePath)) {
    throw createChangedDestinationError(action);
  }

  const liveParentStat = getStableParentStat(filePath, action);
  if (!hasSameFileIdentity(expectedParentStat, liveParentStat)) {
    throw createChangedDestinationError(action);
  }

  const descriptorStat = fs.fstatSync(fileDescriptor);
  const livePathStat = fs.lstatSync(liveDestination.managedPath);
  if (
    !descriptorStat.isFile()
    || !livePathStat.isFile()
    || livePathStat.isSymbolicLink()
    || !hasSameFileIdentity(descriptorStat, livePathStat)
  ) {
    throw createChangedDestinationError(action);
  }
}

function writeFileNoFollow(filePath, content, mode, trustedRoot, action) {
  const expectedParentStat = getStableParentStat(filePath, action);
  const flags = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | (fs.constants.O_NOFOLLOW || 0);
  const fileDescriptor = fs.openSync(filePath, flags, mode);

  try {
    assertPinnedWriteDestination(
      filePath,
      fileDescriptor,
      expectedParentStat,
      trustedRoot,
      action
    );
    fs.ftruncateSync(fileDescriptor, 0);
    fs.writeFileSync(fileDescriptor, content);
    if (mode !== undefined) {
      fs.fchmodSync(fileDescriptor, mode);
    }
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

function readFileWithMetadataNoFollow(filePath, encoding) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const fileDescriptor = fs.openSync(filePath, flags);

  try {
    const stat = fs.fstatSync(fileDescriptor);
    if (!stat.isFile()) {
      throw new Error(`Refusing to read non-file path: ${filePath}`);
    }
    return {
      content: fs.readFileSync(fileDescriptor, encoding),
      mode: stat.mode,
    };
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

function readFileNoFollow(filePath, encoding) {
  return readFileWithMetadataNoFollow(filePath, encoding).content;
}

function readJsonNoFollow(filePath) {
  return JSON.parse(readFileNoFollow(filePath, 'utf8'));
}

function writeContainedFile(destinationPath, content, trustedRoot, action, mode) {
  const preparedDestination = prepareContainedWriteDestination(destinationPath, trustedRoot, action);
  const finalDestination = getManagedDestination(
    preparedDestination,
    trustedRoot,
    action
  ).managedPath;
  writeFileNoFollow(
    finalDestination,
    content,
    mode,
    trustedRoot,
    action
  );
  return finalDestination;
}

function copyContainedFile(sourcePath, destinationPath, trustedRoot, action) {
  const source = readFileWithMetadataNoFollow(sourcePath);
  return writeContainedFile(
    destinationPath,
    source.content,
    trustedRoot,
    action,
    source.mode & 0o777
  );
}

function removeContainedPath(destinationPath, trustedRoot, action, options = {}) {
  const existingDestination = getContainedExistingPath(
    destinationPath,
    trustedRoot,
    action,
    { allowFinalSymlink: true }
  );
  if (!existingDestination) {
    return null;
  }

  const finalDestination = getManagedDestination(
    existingDestination,
    trustedRoot,
    action,
    { allowFinalSymlink: true }
  ).managedPath;
  fs.rmSync(finalDestination, options);
  return finalDestination;
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

function jsonContainsSubset(actualValue, expectedValue) {
  if (isPlainObject(expectedValue)) {
    if (!isPlainObject(actualValue)) {
      return false;
    }

    return Object.entries(expectedValue).every(([key, value]) => Object.prototype.hasOwnProperty.call(actualValue, key) && jsonContainsSubset(actualValue[key], value));
  }

  if (Array.isArray(expectedValue)) {
    if (!Array.isArray(actualValue) || actualValue.length !== expectedValue.length) {
      return false;
    }

    return expectedValue.every((item, index) => jsonContainsSubset(actualValue[index], item));
  }

  return actualValue === expectedValue;
}

const JSON_REMOVE_SENTINEL = Symbol('json-remove');

function deepRemoveJsonSubset(currentValue, managedValue) {
  if (isPlainObject(managedValue)) {
    if (!isPlainObject(currentValue)) {
      return currentValue;
    }

    const nextValue = { ...currentValue };
    for (const [key, value] of Object.entries(managedValue)) {
      if (!Object.prototype.hasOwnProperty.call(nextValue, key)) {
        continue;
      }

      if (isPlainObject(value)) {
        const nestedValue = deepRemoveJsonSubset(nextValue[key], value);
        if (nestedValue === JSON_REMOVE_SENTINEL) {
          delete nextValue[key];
        } else {
          nextValue[key] = nestedValue;
        }
        continue;
      }

      if (Array.isArray(value)) {
        if (Array.isArray(nextValue[key]) && jsonContainsSubset(nextValue[key], value)) {
          delete nextValue[key];
        }
        continue;
      }

      if (nextValue[key] === value) {
        delete nextValue[key];
      }
    }

    return Object.keys(nextValue).length === 0 ? JSON_REMOVE_SENTINEL : nextValue;
  }

  if (Array.isArray(managedValue)) {
    return jsonContainsSubset(currentValue, managedValue) ? JSON_REMOVE_SENTINEL : currentValue;
  }

  return currentValue === managedValue ? JSON_REMOVE_SENTINEL : currentValue;
}

function hydrateRecordedOperations(repoRoot, operations) {
  return operations.map(operation => {
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

function executeRepairOperation(repoRoot, operation, trustedRoot) {
  // Install-state is attacker-controllable; never write/delete outside the
  // adapter-derived trusted root, regardless of what the state file claims
  // (GHSA-hfpv-w6mp-5g95).
  if (operation.kind === 'copy-file') {
    const sourcePath = resolveOperationSourcePath(repoRoot, operation);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error(`Missing source file for repair: ${sourcePath || operation.sourceRelativePath}`);
    }

    copyContainedFile(sourcePath, operation.destinationPath, trustedRoot, 'repair');
    return operation.destinationPath;
  }

  if (operation.kind === 'render-template') {
    const renderedContent = getOperationTextContent(operation);
    if (renderedContent === null) {
      throw new Error(`Missing rendered content for repair: ${operation.destinationPath}`);
    }

    writeContainedFile(operation.destinationPath, renderedContent, trustedRoot, 'repair');
    return operation.destinationPath;
  }

  if (operation.kind === 'merge-json') {
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

  if (operation.kind === 'remove') {
    const removedPath = removeContainedPath(
      operation.destinationPath,
      trustedRoot,
      'repair',
      { recursive: true, force: true }
    );
    return removedPath ? operation.destinationPath : null;
  }

  throw new Error(`Unsupported repair operation kind: ${operation.kind}`);
}

function executeUninstallOperation(operation, trustedRoot) {
  // Confine deletes to the trusted install root (GHSA-hfpv-w6mp-5g95).
  if (operation.kind === 'copy-file') {
    const removedPath = removeContainedPath(
      operation.destinationPath,
      trustedRoot,
      'uninstall',
      { force: true }
    );
    if (!removedPath) {
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

    return {
      removedPaths: [operation.destinationPath],
      cleanupTargets: [removedPath]
    };
  }

  if (operation.kind === 'render-template') {
    const previousContent = getOperationPreviousContent(operation);
    if (previousContent !== null) {
      writeContainedFile(operation.destinationPath, previousContent, trustedRoot, 'uninstall');
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

    const previousJson = getOperationPreviousJson(operation);
    if (previousJson !== undefined) {
      writeContainedFile(operation.destinationPath, formatJson(previousJson), trustedRoot, 'uninstall');
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

    const removedPath = removeContainedPath(
      operation.destinationPath,
      trustedRoot,
      'uninstall',
      { force: true }
    );
    if (!removedPath) {
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

    return {
      removedPaths: [operation.destinationPath],
      cleanupTargets: [removedPath]
    };
  }

  if (operation.kind === 'merge-json') {
    const previousContent = getOperationPreviousContent(operation);
    if (previousContent !== null) {
      writeContainedFile(operation.destinationPath, previousContent, trustedRoot, 'uninstall');
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

    const previousJson = getOperationPreviousJson(operation);
    if (previousJson !== undefined) {
      writeContainedFile(operation.destinationPath, formatJson(previousJson), trustedRoot, 'uninstall');
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

    const existingDestination = getContainedExistingPath(
      operation.destinationPath,
      trustedRoot,
      'uninstall'
    );
    if (!existingDestination) {
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

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
    return {
      removedPaths: [],
      cleanupTargets: []
    };
  }

  if (operation.kind === 'remove') {
    const previousContent = getOperationPreviousContent(operation);
    if (previousContent !== null) {
      writeContainedFile(operation.destinationPath, previousContent, trustedRoot, 'uninstall');
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

    const previousJson = getOperationPreviousJson(operation);
    if (previousJson !== undefined) {
      writeContainedFile(operation.destinationPath, formatJson(previousJson), trustedRoot, 'uninstall');
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

    return {
      removedPaths: [],
      cleanupTargets: []
    };
  }

  throw new Error(`Unsupported uninstall operation kind: ${operation.kind}`);
}

function inspectManagedOperation(repoRoot, trustedRoot, operation) {
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
    return {
      status: 'unsafe-destination',
      operation,
      destinationPath,
      reason: error && error.code === 'ECC_FINAL_DESTINATION_SYMLINK'
        ? 'final-symlink'
        : 'outside-root'
    };
  }

  const inspectedPath = managedDestination.managedPath;

  if (operation.kind === 'remove') {
    if (managedDestination.exists) {
      return {
        status: 'drifted',
        operation,
        destinationPath
      };
    }

    return {
      status: 'ok',
      operation,
      destinationPath
    };
  }

  let copySourcePath = null;
  if (operation.kind === 'copy-file') {
    try {
      copySourcePath = resolveOperationSourcePath(repoRoot, operation);
    } catch {
      return {
        status: 'unsafe-source',
        operation,
        destinationPath
      };
    }
  }

  if (!managedDestination.exists) {
    return {
      status: 'missing',
      operation,
      destinationPath
    };
  }

  if (operation.kind === 'copy-file') {
    if (!copySourcePath || !fs.existsSync(copySourcePath)) {
      return {
        status: 'missing-source',
        operation,
        destinationPath,
        sourcePath: copySourcePath
      };
    }

    if (!areFilesEqual(copySourcePath, inspectedPath)) {
      return {
        status: 'drifted',
        operation,
        destinationPath,
        sourcePath: copySourcePath
      };
    }

    return {
      status: 'ok',
      operation,
      destinationPath,
      sourcePath: copySourcePath
    };
  }

  if (operation.kind === 'render-template') {
    const renderedContent = getOperationTextContent(operation);
    if (renderedContent === null) {
      return {
        status: 'unverified',
        operation,
        destinationPath
      };
    }

    try {
      if (readFileNoFollow(inspectedPath, 'utf8') !== renderedContent) {
        return {
          status: 'drifted',
          operation,
          destinationPath
        };
      }
    } catch {
      return {
        status: 'drifted',
        operation,
        destinationPath
      };
    }

    return {
      status: 'ok',
      operation,
      destinationPath
    };
  }

  if (operation.kind === 'merge-json') {
    const payload = getOperationJsonPayload(operation);
    if (payload === undefined) {
      return {
        status: 'unverified',
        operation,
        destinationPath
      };
    }

    try {
      const currentValue = readJsonNoFollow(inspectedPath);
      if (!jsonContainsSubset(currentValue, payload)) {
        return {
          status: 'drifted',
          operation,
          destinationPath
        };
      }
    } catch (_error) {
      return {
        status: 'drifted',
        operation,
        destinationPath
      };
    }

    return {
      status: 'ok',
      operation,
      destinationPath
    };
  }

  return {
    status: 'unverified',
    operation,
    destinationPath
  };
}

function summarizeManagedOperationHealth(repoRoot, trustedRoot, operations) {
  return operations.reduce(
    (summary, operation) => {
      const inspection = inspectManagedOperation(repoRoot, trustedRoot, operation);
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

function buildDiscoveryRecord(adapter, context) {
  const installTargetInput = {
    homeDir: context.homeDir,
    projectRoot: context.projectRoot,
    repoRoot: context.projectRoot
  };
  const targetRoot = adapter.resolveRoot(installTargetInput);
  const installStatePath = adapter.getInstallStatePath(installTargetInput);
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
      error: null
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
      error: null
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
      error: error.message
    };
  }
}

function discoverInstalledStates(options = {}) {
  const context = {
    homeDir: options.homeDir || process.env.HOME || os.homedir(),
    projectRoot: options.projectRoot || process.cwd()
  };
  const targets = normalizeTargets(options.targets);

  return targets.map(target => {
    const adapter = getInstallTargetAdapter(target);
    return buildDiscoveryRecord(adapter, context);
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

function analyzeRecord(record, context) {
  const issues = [];

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

  const managedOperations = getManagedOperations(state);
  try {
    assertRecordedHookAuthorizationReady(state, managedOperations);
  } catch (error) {
    issues.push(buildIssue('warning', 'hook-authorization-held', error.message));
  }
  const operationHealth = summarizeManagedOperationHealth(
    context.repoRoot,
    record.targetRoot,
    managedOperations
  );
  const missingManagedOperations = operationHealth.missing;

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

  if (missingManagedOperations.length > 0) {
    issues.push(
      buildIssue('error', 'missing-managed-files', `${missingManagedOperations.length} managed file(s) are missing`, {
        paths: missingManagedOperations.map(entry => entry.destinationPath)
      })
    );
  }

  if (operationHealth.drifted.length > 0) {
    issues.push(
      buildIssue('warning', 'drifted-managed-files', `${operationHealth.drifted.length} managed file(s) differ from the source repo`, {
        paths: operationHealth.drifted.map(entry => entry.destinationPath)
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
        paths: operationHealth.unverified.map(entry => entry.destinationPath).filter(Boolean)
      })
    );
  }

  if (state.source.manifestVersion !== context.manifestVersion) {
    issues.push(buildIssue('warning', 'manifest-version-mismatch', `Recorded manifest version ${state.source.manifestVersion} differs from current manifest version ${context.manifestVersion}`));
  }

  if (context.packageVersion && state.source.repoVersion && state.source.repoVersion !== context.packageVersion) {
    issues.push(buildIssue('warning', 'repo-version-mismatch', `Recorded repo version ${state.source.repoVersion} differs from current repo version ${context.packageVersion}`));
  }

  if (!state.request.legacyMode) {
    try {
      const desiredPlan = resolveInstallPlan({
        repoRoot: context.repoRoot,
        projectRoot: context.projectRoot,
        homeDir: context.homeDir,
        target: record.adapter.target,
        profileId: state.request.profile || null,
        moduleIds: state.request.modules || [],
        includeComponentIds: state.request.includeComponents || [],
        excludeComponentIds: state.request.excludeComponents || [],
        hookAuthorizations: state.request.hookAuthorizations || {}
      });

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

  return {
    ...record,
    status: determineStatus(issues),
    issues
  };
}

function buildDoctorReport(options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const manifests = loadInstallManifests({ repoRoot });
  const records = discoverInstalledStates({
    homeDir: options.homeDir,
    projectRoot: options.projectRoot,
    targets: options.targets
  }).filter(record => record.exists);
  const context = {
    repoRoot,
    homeDir: options.homeDir || process.env.HOME || os.homedir(),
    projectRoot: options.projectRoot || process.cwd(),
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

  if (state.request.legacyMode || shouldRepairFromRecordedOperations(state)) {
    const operations = hydrateRecordedOperations(context.repoRoot, getManagedOperations(state));
    const statePreview = buildRecordedStatePreview(state, context, operations);

    return {
      mode: state.request.legacyMode ? 'legacy' : 'recorded',
      target: record.adapter.target,
      adapter: record.adapter,
      targetRoot: state.target.root,
      installRoot: state.target.root,
      installStatePath: state.target.installStatePath,
      warnings: [],
      languages: Array.isArray(state.request.legacyLanguages) ? [...state.request.legacyLanguages] : [],
      operations,
      statePreview
    };
  }

  const desiredPlan = createManifestInstallPlan({
    sourceRoot: context.repoRoot,
    target: record.adapter.target,
    profileId: state.request.profile || null,
    moduleIds: state.request.modules || [],
    includeComponentIds: state.request.includeComponents || [],
    excludeComponentIds: state.request.excludeComponents || [],
    hookAuthorizations: state.request.hookAuthorizations || {},
    projectRoot: context.projectRoot,
    homeDir: context.homeDir,
    exemptValidationCodes: options.exemptValidationCodes || [],
  });

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

function writeRefreshedInstallState(record, statePreview) {
  const trustedStatePreview = buildAdapterDerivedStatePreview(statePreview, record);
  assertValidInstallStateForWrite(trustedStatePreview, record.installStatePath);
  return writeContainedFile(
    record.installStatePath,
    formatJson(trustedStatePreview),
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
  const migration = prepareClaudeSkillMigration(trustedPlan);
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

function repairInstalledStates(options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const manifests = loadInstallManifests({ repoRoot });
  const context = {
    repoRoot,
    homeDir: options.homeDir || process.env.HOME || os.homedir(),
    projectRoot: options.projectRoot || process.cwd(),
    manifestVersion: manifests.modulesVersion,
    packageVersion: readPackageVersion(repoRoot)
  };
  const buildOpencodeRunner = typeof options.buildOpencodePayload === 'function'
    ? options.buildOpencodePayload
    : buildOpencodePayload;
  const records = discoverInstalledStates({
    homeDir: context.homeDir,
    projectRoot: context.projectRoot,
    targets: options.targets
  }).filter(record => record.exists);

  const results = records.map(record => {
    if (record.error) {
      return {
        adapter: record.adapter,
        status: 'error',
        installStatePath: record.installStatePath,
        repairedPaths: [],
        plannedRepairs: [],
        error: record.error
      };
    }

    try {
      assertRecordedHookAuthorizationReady(record.state);
      const needsOpencodeBuild = record.adapter.target === 'opencode'
        && hasOpencodeBuildError(getOpencodeBuildValidationIssues(context, record.state));
      const opencodeBuildRepairPath = path.join(context.repoRoot, OPENCODE_BUILD_ARTIFACT);

      if (needsOpencodeBuild && options.dryRun) {
        const rawPlan = createRepairPlanFromRecord(record, context, {
          exemptValidationCodes: [OPENCODE_PLUGIN_NOT_BUILT_CODE],
        });
        const { plan: desiredPlan } = prepareRepairMigration(rawPlan, record);
        const operationHealth = summarizeManagedOperationHealth(
          context.repoRoot,
          record.targetRoot,
          desiredPlan.operations
        );
        const unsafeOperationResult = getUnsafeOperationResult(
          record,
          operationHealth
        );
        if (unsafeOperationResult) {
          return unsafeOperationResult;
        }
        const repairOperations = [...operationHealth.missing.map(entry => ({ ...entry.operation })), ...operationHealth.drifted.map(entry => ({ ...entry.operation }))];
        const plannedRepairs = [opencodeBuildRepairPath, ...repairOperations.map(operation => operation.destinationPath)];

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

      if (needsOpencodeBuild) {
        try {
          buildOpencodeRunner(context.repoRoot);
        } catch (error) {
          return {
            adapter: record.adapter,
            status: 'error',
            installStatePath: record.installStatePath,
            repairedPaths: [],
            plannedRepairs: [],
            error: formatBuildErrorMessage(error)
          };
        }
      }

      const rawPlan = createRepairPlanFromRecord(record, context);
      const {
        migration,
        plan: desiredPlan,
      } = prepareRepairMigration(rawPlan, record);
      const operationHealth = summarizeManagedOperationHealth(
        context.repoRoot,
        record.targetRoot,
        desiredPlan.operations
      );

      const unsafeOperationResult = getUnsafeOperationResult(
        record,
        operationHealth
      );
      if (unsafeOperationResult) {
        return unsafeOperationResult;
      }

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

      const repairOperations = [...operationHealth.missing.map(entry => ({ ...entry.operation })), ...operationHealth.drifted.map(entry => ({ ...entry.operation }))];
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

      const hasLegacyMigration = migration.legacyOperationsToRemove.length > 0;
      const repairedPaths = needsOpencodeBuild ? [opencodeBuildRepairPath] : [];
      if (migration.requiresBridgeState && (repairOperations.length > 0 || hasLegacyMigration)) {
        writeRefreshedInstallState(record, migration.bridgeState);
      }

      for (const operation of repairOperations) {
        const repairedPath = executeRepairOperation(
          context.repoRoot,
          operation,
          record.targetRoot
        );
        if (repairedPath) {
          repairedPaths.push(repairedPath);
        }
      }
      if (hasLegacyMigration) {
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
      writeRefreshedInstallState(record, desiredPlan.statePreview);

      return {
        adapter: record.adapter,
        status: (repairOperations.length > 0 || needsOpencodeBuild || hasLegacyMigration)
          ? 'repaired'
          : 'ok',
        installStatePath: record.installStatePath,
        repairedPaths,
        plannedRepairs: [],
        stateRefreshed: true,
        warnings: desiredPlan.warnings,
        error: null
      };
    } catch (error) {
      return {
        adapter: record.adapter,
        status: 'error',
        installStatePath: record.installStatePath,
        repairedPaths: [],
        plannedRepairs: [],
        error: error.message
      };
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

function cleanupEmptyParentDirs(filePath, stopAt) {
  const trustedStopAt = assertWithinTrustedRoot(stopAt, stopAt, 'clean up');
  const trustedFilePath = assertWithinTrustedRoot(filePath, trustedStopAt, 'clean up');
  let currentPath = path.dirname(trustedFilePath);

  while (currentPath) {
    const relativePath = path.relative(trustedStopAt, currentPath);
    const isContained = relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath);
    if (!isContained || relativePath === '') {
      break;
    }

    let validatedPath = assertWithinTrustedRoot(currentPath, trustedStopAt, 'clean up');
    if (!fs.existsSync(validatedPath)) {
      currentPath = path.dirname(validatedPath);
      continue;
    }

    validatedPath = assertWithinTrustedRoot(validatedPath, trustedStopAt, 'clean up');
    const stat = fs.lstatSync(validatedPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      break;
    }

    validatedPath = assertWithinTrustedRoot(validatedPath, trustedStopAt, 'clean up');
    if (fs.readdirSync(validatedPath).length > 0) {
      break;
    }

    const finalPath = assertWithinTrustedRoot(validatedPath, trustedStopAt, 'clean up');
    fs.rmdirSync(finalPath);
    currentPath = path.dirname(finalPath);
  }
}

function uninstallInstalledStates(options = {}) {
  const records = discoverInstalledStates({
    homeDir: options.homeDir,
    projectRoot: options.projectRoot,
    targets: options.targets
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
    const plannedRemovals = Array.from(new Set([
      ...getManagedOperations(state).map(operation => operation.destinationPath),
      record.installStatePath,
      ...(state.target.rootExistedBeforeInstall === false ? [record.targetRoot] : [])
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

    try {
      const removedPaths = [];
      const cleanupTargets = [];
      const operations = getManagedOperations(state);

      for (const operation of operations) {
        const outcome = executeUninstallOperation(operation, record.targetRoot);
        removedPaths.push(...outcome.removedPaths);
        cleanupTargets.push(...outcome.cleanupTargets);
      }

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

      for (const cleanupTarget of cleanupTargets) {
        cleanupEmptyParentDirs(cleanupTarget, record.targetRoot);
      }
      let removedTargetRoot = false;
      if (
        state.target.rootExistedBeforeInstall === false
        && fs.existsSync(record.targetRoot)
      ) {
        const rootStat = fs.lstatSync(record.targetRoot);
        if (
          rootStat.isDirectory()
          && !rootStat.isSymbolicLink()
          && fs.readdirSync(record.targetRoot).length === 0
        ) {
          fs.rmdirSync(record.targetRoot);
          removedPaths.push(record.targetRoot);
          removedTargetRoot = true;
        }
      }

      return {
        adapter: record.adapter,
        status: 'uninstalled',
        installStatePath: record.installStatePath,
        removedPaths,
        removedTargetRoot,
        plannedRemovals: [],
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
    }
  });

  const summary = results.reduce(
    (accumulator, result) => ({
      checkedCount: accumulator.checkedCount + 1,
      uninstalledCount: accumulator.uninstalledCount + (result.status === 'uninstalled' ? 1 : 0),
      plannedRemovalCount: accumulator.plannedRemovalCount + (result.status === 'planned' ? 1 : 0),
      errorCount: accumulator.errorCount + (result.status === 'error' ? 1 : 0)
    }),
    {
      checkedCount: 0,
      uninstalledCount: 0,
      plannedRemovalCount: 0,
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
