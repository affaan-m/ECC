const fs = require('fs');
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');

const { resolveInstallPlan, loadInstallManifests } = require('./install-manifests');
const { readInstallState, writeInstallState } = require('./install-state');
const { assertWithinTrustedRoot } = require('./path-safety');
const { createManifestInstallPlan } = require('./install-executor');
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

function getOpencodeBuildValidationIssues(context) {
  return getInstallTargetAdapter('opencode').validate({
    homeDir: context.homeDir,
    repoRoot: context.repoRoot,
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

function resolveOperationSourcePath(repoRoot, operation) {
  if (operation.sourceRelativePath) {
    return path.join(repoRoot, operation.sourceRelativePath);
  }

  return operation.sourcePath || null;
}

function areFilesEqual(leftPath, rightPath) {
  try {
    const leftStat = fs.statSync(leftPath);
    const rightStat = fs.statSync(rightPath);
    if (!leftStat.isFile() || !rightStat.isFile()) {
      return false;
    }

    return fs.readFileSync(leftPath).equals(fs.readFileSync(rightPath));
  } catch (_error) {
    return false;
  }
}

function readFileUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
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

function readJsonFile(filePath) {
  return JSON.parse(readFileUtf8(filePath));
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
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
  assertWithinTrustedRoot(operation.destinationPath, trustedRoot, 'repair');

  if (operation.kind === 'copy-file') {
    const sourcePath = resolveOperationSourcePath(repoRoot, operation);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error(`Missing source file for repair: ${sourcePath || operation.sourceRelativePath}`);
    }

    ensureParentDir(operation.destinationPath);
    fs.copyFileSync(sourcePath, operation.destinationPath);
    return;
  }

  if (operation.kind === 'render-template') {
    const renderedContent = getOperationTextContent(operation);
    if (renderedContent === null) {
      throw new Error(`Missing rendered content for repair: ${operation.destinationPath}`);
    }

    ensureParentDir(operation.destinationPath);
    fs.writeFileSync(operation.destinationPath, renderedContent);
    return;
  }

  if (operation.kind === 'merge-json') {
    const payload = getOperationJsonPayload(operation);
    if (payload === undefined) {
      throw new Error(`Missing merge payload for repair: ${operation.destinationPath}`);
    }

    const currentValue = fs.existsSync(operation.destinationPath) ? readJsonFile(operation.destinationPath) : {};
    const mergedValue = deepMergeJson(currentValue, payload);

    ensureParentDir(operation.destinationPath);
    fs.writeFileSync(operation.destinationPath, formatJson(mergedValue));
    return;
  }

  if (operation.kind === 'remove') {
    if (!fs.existsSync(operation.destinationPath)) {
      return;
    }

    fs.rmSync(operation.destinationPath, { recursive: true, force: true });
    return;
  }

  throw new Error(`Unsupported repair operation kind: ${operation.kind}`);
}

function executeUninstallOperation(operation, trustedRoot) {
  // Confine deletes to the trusted install root (GHSA-hfpv-w6mp-5g95).
  assertWithinTrustedRoot(operation.destinationPath, trustedRoot, 'uninstall');

  if (operation.kind === 'copy-file') {
    if (!fs.existsSync(operation.destinationPath)) {
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

    fs.rmSync(operation.destinationPath, { force: true });
    return {
      removedPaths: [operation.destinationPath],
      cleanupTargets: [operation.destinationPath]
    };
  }

  if (operation.kind === 'render-template') {
    const previousContent = getOperationPreviousContent(operation);
    if (previousContent !== null) {
      ensureParentDir(operation.destinationPath);
      fs.writeFileSync(operation.destinationPath, previousContent);
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

    const previousJson = getOperationPreviousJson(operation);
    if (previousJson !== undefined) {
      ensureParentDir(operation.destinationPath);
      fs.writeFileSync(operation.destinationPath, formatJson(previousJson));
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

    if (!fs.existsSync(operation.destinationPath)) {
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

    fs.rmSync(operation.destinationPath, { force: true });
    return {
      removedPaths: [operation.destinationPath],
      cleanupTargets: [operation.destinationPath]
    };
  }

  if (operation.kind === 'merge-json') {
    const previousContent = getOperationPreviousContent(operation);
    if (previousContent !== null) {
      ensureParentDir(operation.destinationPath);
      fs.writeFileSync(operation.destinationPath, previousContent);
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

    const previousJson = getOperationPreviousJson(operation);
    if (previousJson !== undefined) {
      ensureParentDir(operation.destinationPath);
      fs.writeFileSync(operation.destinationPath, formatJson(previousJson));
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

    if (!fs.existsSync(operation.destinationPath)) {
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

    const payload = getOperationJsonPayload(operation);
    if (payload === undefined) {
      throw new Error(`Missing merge payload for uninstall: ${operation.destinationPath}`);
    }

    const currentValue = readJsonFile(operation.destinationPath);
    const nextValue = deepRemoveJsonSubset(currentValue, payload);
    if (nextValue === JSON_REMOVE_SENTINEL) {
      fs.rmSync(operation.destinationPath, { force: true });
      return {
        removedPaths: [operation.destinationPath],
        cleanupTargets: [operation.destinationPath]
      };
    }

    ensureParentDir(operation.destinationPath);
    fs.writeFileSync(operation.destinationPath, formatJson(nextValue));
    return {
      removedPaths: [],
      cleanupTargets: []
    };
  }

  if (operation.kind === 'remove') {
    const previousContent = getOperationPreviousContent(operation);
    if (previousContent !== null) {
      ensureParentDir(operation.destinationPath);
      fs.writeFileSync(operation.destinationPath, previousContent);
      return {
        removedPaths: [],
        cleanupTargets: []
      };
    }

    const previousJson = getOperationPreviousJson(operation);
    if (previousJson !== undefined) {
      ensureParentDir(operation.destinationPath);
      fs.writeFileSync(operation.destinationPath, formatJson(previousJson));
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

function inspectManagedOperation(repoRoot, operation) {
  const destinationPath = operation.destinationPath;
  if (!destinationPath) {
    return {
      status: 'invalid-destination',
      operation
    };
  }

  if (operation.kind === 'remove') {
    if (fs.existsSync(destinationPath)) {
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

  if (!fs.existsSync(destinationPath)) {
    return {
      status: 'missing',
      operation,
      destinationPath
    };
  }

  if (operation.kind === 'copy-file') {
    const sourcePath = resolveOperationSourcePath(repoRoot, operation);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return {
        status: 'missing-source',
        operation,
        destinationPath,
        sourcePath
      };
    }

    if (!areFilesEqual(sourcePath, destinationPath)) {
      return {
        status: 'drifted',
        operation,
        destinationPath,
        sourcePath
      };
    }

    return {
      status: 'ok',
      operation,
      destinationPath,
      sourcePath
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

    if (readFileUtf8(destinationPath) !== renderedContent) {
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
      const currentValue = readJsonFile(destinationPath);
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

function summarizeManagedOperationHealth(repoRoot, operations) {
  return operations.reduce(
    (summary, operation) => {
      const inspection = inspectManagedOperation(repoRoot, operation);
      if (inspection.status === 'missing') {
        summary.missing.push(inspection);
      } else if (inspection.status === 'drifted') {
        summary.drifted.push(inspection);
      } else if (inspection.status === 'missing-source') {
        summary.missingSource.push(inspection);
      } else if (inspection.status === 'unverified' || inspection.status === 'invalid-destination') {
        summary.unverified.push(inspection);
      }
      return summary;
    },
    {
      missing: [],
      drifted: [],
      missingSource: [],
      unverified: []
    }
  );
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
  const operationHealth = summarizeManagedOperationHealth(context.repoRoot, managedOperations);
  const missingManagedOperations = operationHealth.missing;

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
        excludeComponentIds: state.request.excludeComponents || []
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
      const needsOpencodeBuild = record.adapter.target === 'opencode'
        && hasOpencodeBuildError(getOpencodeBuildValidationIssues(context));
      const opencodeBuildRepairPath = path.join(context.repoRoot, OPENCODE_BUILD_ARTIFACT);

      if (needsOpencodeBuild && options.dryRun) {
        const desiredPlan = createRepairPlanFromRecord(record, context, {
          exemptValidationCodes: [OPENCODE_PLUGIN_NOT_BUILT_CODE],
        });
        const operationHealth = summarizeManagedOperationHealth(context.repoRoot, desiredPlan.operations);
        const repairOperations = [...operationHealth.missing.map(entry => ({ ...entry.operation })), ...operationHealth.drifted.map(entry => ({ ...entry.operation }))];
        const plannedRepairs = [opencodeBuildRepairPath, ...repairOperations.map(operation => operation.destinationPath)];

        return {
          adapter: record.adapter,
          status: 'planned',
          installStatePath: record.installStatePath,
          repairedPaths: [],
          plannedRepairs,
          stateRefreshed: false,
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

      const desiredPlan = createRepairPlanFromRecord(record, context);
      const operationHealth = summarizeManagedOperationHealth(context.repoRoot, desiredPlan.operations);

      if (operationHealth.missingSource.length > 0) {
        return {
          adapter: record.adapter,
          status: 'error',
          installStatePath: record.installStatePath,
          repairedPaths: [],
          plannedRepairs: [],
          error: `Missing source file(s): ${operationHealth.missingSource.map(entry => entry.sourcePath).join(', ')}`
        };
      }

      const repairOperations = [...operationHealth.missing.map(entry => ({ ...entry.operation })), ...operationHealth.drifted.map(entry => ({ ...entry.operation }))];
      const plannedRepairs = needsOpencodeBuild
        ? [opencodeBuildRepairPath, ...repairOperations.map(operation => operation.destinationPath)]
        : repairOperations.map(operation => operation.destinationPath);

      if (options.dryRun) {
        return {
          adapter: record.adapter,
          status: plannedRepairs.length > 0 ? 'planned' : 'ok',
          installStatePath: record.installStatePath,
          repairedPaths: [],
          plannedRepairs,
          stateRefreshed: plannedRepairs.length === 0,
          error: null
        };
      }

      if (repairOperations.length > 0) {
        for (const operation of repairOperations) {
          executeRepairOperation(context.repoRoot, operation, record.targetRoot);
        }
        writeInstallState(desiredPlan.installStatePath, desiredPlan.statePreview);
      } else {
        writeInstallState(desiredPlan.installStatePath, desiredPlan.statePreview);
      }

      return {
        adapter: record.adapter,
        status: (repairOperations.length > 0 || needsOpencodeBuild) ? 'repaired' : 'ok',
        installStatePath: record.installStatePath,
        repairedPaths: plannedRepairs,
        plannedRepairs: [],
        stateRefreshed: true,
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
  let currentPath = path.dirname(filePath);
  const normalizedStopAt = path.resolve(stopAt);

  while (currentPath && path.resolve(currentPath).startsWith(normalizedStopAt) && path.resolve(currentPath) !== normalizedStopAt) {
    if (!fs.existsSync(currentPath)) {
      currentPath = path.dirname(currentPath);
      continue;
    }

    const stat = fs.lstatSync(currentPath);
    if (!stat.isDirectory() || fs.readdirSync(currentPath).length > 0) {
      break;
    }

    fs.rmdirSync(currentPath);
    currentPath = path.dirname(currentPath);
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
    const plannedRemovals = Array.from(new Set([...getManagedOperations(state).map(operation => operation.destinationPath), state.target.installStatePath]));

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

      if (fs.existsSync(state.target.installStatePath)) {
        assertWithinTrustedRoot(state.target.installStatePath, record.targetRoot, 'uninstall');
        fs.rmSync(state.target.installStatePath, { force: true });
        removedPaths.push(state.target.installStatePath);
        cleanupTargets.push(state.target.installStatePath);
      }

      for (const cleanupTarget of cleanupTargets) {
        cleanupEmptyParentDirs(cleanupTarget, state.target.root);
      }

      return {
        adapter: record.adapter,
        status: 'uninstalled',
        installStatePath: record.installStatePath,
        removedPaths,
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
