'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { resolveInstallPlan } = require('../install-manifests');
const { getInstallTargetAdapter } = require('../install-targets/registry');
const { resolveInvocationEnvironment } = require('../invocation-environment');

const EXCLUDED_GENERATED_SOURCE_SUFFIXES = ['/ecc-install-state.json', '/ecc/install-state.json'];
const IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  '.pytest_cache',
]);
const IGNORED_FILE_EXTENSIONS = new Set(['.pyc', '.pyo', '.pyd']);

function getSourceRoot() {
  return path.join(__dirname, '../../..');
}

function getPackageVersion(sourceRoot) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'));
    return packageJson.version || null;
  } catch (_error) {
    return null;
  }
}

function getManifestVersion(sourceRoot) {
  try {
    const modulesManifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'manifests', 'install-modules.json'), 'utf8'));
    return modulesManifest.version || 1;
  } catch (_error) {
    return 1;
  }
}

function getRepoCommit(sourceRoot) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: sourceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000
    }).trim();
  } catch (_error) {
    return null;
  }
}

function listFilesRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }
      const childFiles = listFilesRecursive(absolutePath);
      for (const childFile of childFiles) {
        files.push(path.join(entry.name, childFile));
      }
    } else if (entry.isFile()) {
      if (IGNORED_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      files.push(entry.name);
    }
  }

  return files.sort();
}

function isGeneratedRuntimeSourcePath(sourceRelativePath) {
  const normalizedPath = String(sourceRelativePath || '').replace(/\\/g, '/');
  return EXCLUDED_GENERATED_SOURCE_SUFFIXES.some(suffix => normalizedPath.endsWith(suffix));
}

function createStatePreview(options) {
  const { createInstallState } = require('../install-state');
  return createInstallState(options);
}

function buildCopyFileOperation({
  moduleId,
  sourcePath,
  sourceRelativePath,
  destinationPath,
  strategy,
  contentTransform,
}) {
  return {
    kind: 'copy-file',
    moduleId,
    sourcePath,
    sourceRelativePath,
    destinationPath,
    strategy,
    ownership: 'managed',
    scaffoldOnly: false,
    ...(contentTransform ? { contentTransform } : {}),
  };
}

function readJsonObject(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse ${label} at ${filePath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid ${label} at ${filePath}: expected a JSON object`);
  }

  return parsed;
}

function materializeScaffoldOperation(sourceRoot, operation) {
  if (operation.kind === 'merge-json') {
    return [
      {
        kind: 'merge-json',
        moduleId: operation.moduleId,
        sourceRelativePath: operation.sourceRelativePath,
        destinationPath: operation.destinationPath,
        strategy: operation.strategy || 'merge-json',
        ownership: operation.ownership || 'managed',
        scaffoldOnly: Object.hasOwn(operation, 'scaffoldOnly') ? operation.scaffoldOnly : false,
        mergePayload: readJsonObject(path.join(sourceRoot, operation.sourceRelativePath), operation.sourceRelativePath)
      }
    ];
  }

  const sourcePath = path.join(sourceRoot, operation.sourceRelativePath);
  if (!fs.existsSync(sourcePath)) {
    return [];
  }

  if (isGeneratedRuntimeSourcePath(operation.sourceRelativePath)) {
    return [];
  }

  const stat = fs.statSync(sourcePath);
  if (stat.isFile()) {
    return [
      buildCopyFileOperation({
        moduleId: operation.moduleId,
        sourcePath,
        sourceRelativePath: operation.sourceRelativePath,
        destinationPath: operation.destinationPath,
        strategy: operation.strategy,
        contentTransform: operation.contentTransform,
      })
    ];
  }

  const relativeFiles = listFilesRecursive(sourcePath).filter(relativeFile => {
    const sourceRelativePath = path.join(operation.sourceRelativePath, relativeFile);
    return !isGeneratedRuntimeSourcePath(sourceRelativePath);
  });
  return relativeFiles.map(relativeFile => {
    const sourceRelativePath = path.join(operation.sourceRelativePath, relativeFile);
    return buildCopyFileOperation({
      moduleId: operation.moduleId,
      sourcePath: path.join(sourcePath, relativeFile),
      sourceRelativePath,
      destinationPath: path.join(operation.destinationPath, relativeFile),
      strategy: operation.strategy,
      contentTransform: operation.contentTransform,
    });
  });
}

function isSelectedAntigravityLegacyRule(operation, ruleLanguages) {
  const normalizedSourcePath = String(operation.sourceRelativePath || '').replace(/\\/g, '/');
  if (!normalizedSourcePath.startsWith('rules/')) {
    return true;
  }

  const namespace = normalizedSourcePath.split('/')[1];
  return namespace === 'common' || ruleLanguages.includes(namespace);
}

function dedupeCopyFileOperations(operations) {
  // A `copy-file` operation fully overwrites its destination, so when several
  // of them target the same path (e.g. a generic `commands/<name>.md` shadowed
  // by an OpenCode `.opencode/commands/<name>.md` override) only the last one
  // actually determines the installed content. Recording the shadowed earlier
  // writes in install-state makes `doctor` report perpetual drift and drives
  // `repair` to clobber the override with the generic source (issue #2414).
  // Keep only the last `copy-file` per destination - matching the sequential
  // apply order in applyInstallPlan - and leave every other operation kind
  // (e.g. accumulating `merge-json` writes into a shared config) untouched and
  // in order.
  const lastCopyIndexByDestination = new Map();
  operations.forEach((operation, index) => {
    if (operation.kind === 'copy-file' && operation.destinationPath) {
      lastCopyIndexByDestination.set(operation.destinationPath, index);
    }
  });

  return operations.filter((operation, index) => {
    if (operation.kind !== 'copy-file' || !operation.destinationPath) {
      return true;
    }
    return lastCopyIndexByDestination.get(operation.destinationPath) === index;
  });
}

function createManifestInstallPlan(options = {}) {
  const sourceRoot = options.sourceRoot || getSourceRoot();
  const projectRoot = options.projectRoot || process.cwd();
  const target = options.target || 'claude';
  const legacyLanguages = Array.isArray(options.legacyLanguages) ? [...options.legacyLanguages] : [];
  const requestProfileId = Object.hasOwn(options, 'requestProfileId') ? options.requestProfileId : options.profileId || null;
  const requestModuleIds = Object.hasOwn(options, 'requestModuleIds') ? [...options.requestModuleIds] : Array.isArray(options.moduleIds) ? [...options.moduleIds] : [];
  const requestIncludeComponentIds = Object.hasOwn(options, 'requestIncludeComponentIds')
    ? [...options.requestIncludeComponentIds]
    : Array.isArray(options.includeComponentIds)
      ? [...options.includeComponentIds]
      : [];
  const requestExcludeComponentIds = Object.hasOwn(options, 'requestExcludeComponentIds')
    ? [...options.requestExcludeComponentIds]
    : Array.isArray(options.excludeComponentIds)
      ? [...options.excludeComponentIds]
      : [];
  const plan = resolveInstallPlan({
    repoRoot: sourceRoot,
    projectRoot,
    homeDir: options.homeDir,
    env: resolveInvocationEnvironment(options),
    profileId: options.profileId || null,
    moduleIds: options.moduleIds || [],
    includeComponentIds: options.includeComponentIds || [],
    excludeComponentIds: options.excludeComponentIds || [],
    target,
    exemptValidationCodes: options.exemptValidationCodes || [],
  });
  const adapter = getInstallTargetAdapter(target);
  const materializedOperations = plan.operations.flatMap(operation => (
    materializeScaffoldOperation(sourceRoot, operation)
  ));
  const ruleLanguages = Array.isArray(options.ruleLanguages) ? [...options.ruleLanguages] : [];
  const operations = dedupeCopyFileOperations(
    options.legacyMode && target === 'antigravity'
      ? materializedOperations.filter(operation => (
        isSelectedAntigravityLegacyRule(operation, ruleLanguages)
      ))
      : materializedOperations
  );
  const source = {
    repoVersion: getPackageVersion(sourceRoot),
    repoCommit: getRepoCommit(sourceRoot),
    manifestVersion: getManifestVersion(sourceRoot)
  };
  const statePreview = createStatePreview({
    adapter,
    targetRoot: plan.targetRoot,
    installStatePath: plan.installStatePath,
    request: {
      profile: requestProfileId,
      modules: requestModuleIds,
      includeComponents: requestIncludeComponentIds,
      excludeComponents: requestExcludeComponentIds,
      legacyLanguages,
      legacyMode: Boolean(options.legacyMode)
    },
    resolution: {
      selectedModules: plan.selectedModuleIds,
      skippedModules: plan.skippedModuleIds
    },
    operations,
    source
  });

  return {
    mode: options.mode || 'manifest',
    sourceRoot,
    target,
    adapter: {
      id: adapter.id,
      target: adapter.target,
      kind: adapter.kind
    },
    homeDir: plan.homeDir,
    targetRoot: plan.targetRoot,
    installRoot: plan.targetRoot,
    installStatePath: plan.installStatePath,
    warnings: Array.isArray(options.warnings) ? [...options.warnings] : [],
    languages: legacyLanguages,
    legacyLanguages,
    profileId: plan.profileId,
    requestedModuleIds: plan.requestedModuleIds,
    explicitModuleIds: plan.explicitModuleIds,
    includedComponentIds: plan.includedComponentIds,
    excludedComponentIds: plan.excludedComponentIds,
    selectedModuleIds: plan.selectedModuleIds,
    skippedModuleIds: plan.skippedModuleIds,
    excludedModuleIds: plan.excludedModuleIds,
    operations,
    statePreview
  };
}

module.exports = {
  buildCopyFileOperation,
  createManifestInstallPlan,
  createStatePreview,
  dedupeCopyFileOperations,
  getManifestVersion,
  getPackageVersion,
  getRepoCommit,
  getSourceRoot,
  listFilesRecursive,
  readJsonObject,
};
