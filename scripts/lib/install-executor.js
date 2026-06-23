const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { toCursorAgentRelativePath } = require('./cursor-agent-names');
const { LEGACY_INSTALL_TARGETS, parseInstallArgs } = require('./install/request');
const { SUPPORTED_INSTALL_TARGETS, listLegacyCompatibilityLanguages, resolveLegacyCompatibilitySelection, resolveInstallPlan } = require('./install-manifests');
const { getInstallTargetAdapter } = require('./install-targets/registry');

const LANGUAGE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const CLAUDE_ECC_NAMESPACE = 'ecc';
const EXCLUDED_GENERATED_SOURCE_SUFFIXES = ['/ecc-install-state.json', '/ecc/install-state.json'];

function getSourceRoot() {
  return path.join(__dirname, '../..');
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

function readDirectoryNames(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function listAvailableLanguages(sourceRoot = getSourceRoot()) {
  return [...new Set([...listLegacyCompatibilityLanguages(), ...readDirectoryNames(path.join(sourceRoot, 'rules')).filter(name => name !== 'common')])].sort();
}

function validateLegacyTarget(target) {
  if (LEGACY_INSTALL_TARGETS.includes(target)) {
    return;
  }
  // A target can be fully supported yet not installable via the bare-language
  // positional syntax (which is legacy-only). Guide the user to the right mode
  // instead of implying the target is unknown (#2282).
  if (SUPPORTED_INSTALL_TARGETS.includes(target)) {
    throw new Error(
      `Target '${target}' is supported, but the bare-language install syntax only accepts ${LEGACY_INSTALL_TARGETS.join(', ')}. ` +
        `Install '${target}' with a component selection instead, e.g. \`install.sh --target ${target} --profile full\` ` +
        `(or --modules <id,...> / --skills <id,...>).`
    );
  }
  throw new Error(`Unknown install target: ${target}. Expected one of ${SUPPORTED_INSTALL_TARGETS.join(', ')}`);
}

const IGNORED_DIRECTORY_NAMES = new Set(['node_modules', '.git']);

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
  const { createInstallState } = require('./install-state');
  return createInstallState(options);
}

function applyInstallPlan(plan) {
  const { applyInstallPlan: applyPlan } = require('./install/apply');
  return applyPlan(plan);
}

function buildCopyFileOperation({ moduleId, sourcePath, sourceRelativePath, destinationPath, strategy }) {
  return {
    kind: 'copy-file',
    moduleId,
    sourcePath,
    sourceRelativePath,
    destinationPath,
    strategy,
    ownership: 'managed',
    scaffoldOnly: false
  };
}

function addRecursiveCopyOperations(operations, options) {
  const sourceDir = path.join(options.sourceRoot, options.sourceRelativeDir);
  if (!fs.existsSync(sourceDir)) {
    return 0;
  }

  const relativeFiles = listFilesRecursive(sourceDir);

  for (const relativeFile of relativeFiles) {
    const sourceRelativePath = path.join(options.sourceRelativeDir, relativeFile);
    const sourcePath = path.join(options.sourceRoot, sourceRelativePath);
    const destinationRelativePath = typeof options.destinationRelativePathTransform === 'function' ? options.destinationRelativePathTransform(relativeFile, sourceRelativePath) : relativeFile;
    if (!destinationRelativePath) {
      continue;
    }
    const destinationPath = path.join(options.destinationDir, destinationRelativePath);
    operations.push(
      buildCopyFileOperation({
        moduleId: options.moduleId,
        sourcePath,
        sourceRelativePath,
        destinationPath,
        strategy: options.strategy || 'preserve-relative-path'
      })
    );
  }

  return relativeFiles.length;
}

function addFileCopyOperation(operations, options) {
  const sourcePath = path.join(options.sourceRoot, options.sourceRelativePath);
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  operations.push(
    buildCopyFileOperation({
      moduleId: options.moduleId,
      sourcePath,
      sourceRelativePath: options.sourceRelativePath,
      destinationPath: options.destinationPath,
      strategy: options.strategy || 'preserve-relative-path'
    })
  );

  return true;
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

function addCursorAgentDataScaffoldOperations(operations, options) {
  const scaffoldRoot = path.join(options.sourceRoot, 'scaffolds', 'cursor');
  if (!fs.existsSync(scaffoldRoot)) {
    return;
  }

  addFileCopyOperation(operations, {
    moduleId: options.moduleId,
    sourceRoot: options.sourceRoot,
    sourceRelativePath: path.join('scaffolds', 'cursor', 'ecc-agent-data.json'),
    destinationPath: path.join(options.targetRoot, 'ecc-agent-data.json'),
    strategy: 'preserve-relative-path'
  });

  addFileCopyOperation(operations, {
    moduleId: options.moduleId,
    sourceRoot: options.sourceRoot,
    sourceRelativePath: path.join('scaffolds', 'cursor', 'rules', 'ecc-agent-data-home.mdc'),
    destinationPath: path.join(options.targetRoot, 'rules', 'ecc-agent-data-home.mdc'),
    strategy: 'preserve-relative-path'
  });

  addJsonMergeOperation(operations, {
    moduleId: options.moduleId,
    sourceRoot: options.sourceRoot,
    sourceRelativePath: path.join('scaffolds', 'cursor', 'hooks.json'),
    destinationPath: path.join(options.targetRoot, 'hooks.json')
  });

  const cursorSessionHookDeps = [path.join('scripts', 'hooks', 'cursor-session-env.js'), path.join('scripts', 'lib', 'agent-data-home.js'), path.join('scripts', 'lib', 'utils.js')];

  for (const sourceRelativePath of cursorSessionHookDeps) {
    addFileCopyOperation(operations, {
      moduleId: options.moduleId,
      sourceRoot: options.sourceRoot,
      sourceRelativePath,
      destinationPath: path.join(options.targetRoot, sourceRelativePath),
      strategy: 'preserve-relative-path'
    });
  }
}

function addJsonMergeOperation(operations, options) {
  const sourcePath = path.join(options.sourceRoot, options.sourceRelativePath);
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  operations.push({
    kind: 'merge-json',
    moduleId: options.moduleId,
    sourceRelativePath: options.sourceRelativePath,
    destinationPath: options.destinationPath,
    strategy: 'merge-json',
    ownership: 'managed',
    scaffoldOnly: false,
    mergePayload: readJsonObject(sourcePath, options.sourceRelativePath)
  });

  return true;
}

function addMatchingRuleOperations(operations, options) {
  const sourceDir = path.join(options.sourceRoot, options.sourceRelativeDir);
  if (!fs.existsSync(sourceDir)) {
    return 0;
  }

  const files = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && options.matcher(entry.name))
    .map(entry => entry.name)
    .sort();

  for (const fileName of files) {
    const sourceRelativePath = path.join(options.sourceRelativeDir, fileName);
    const sourcePath = path.join(options.sourceRoot, sourceRelativePath);
    const destinationPath = path.join(options.destinationDir, options.rename ? options.rename(fileName) : fileName);

    operations.push(
      buildCopyFileOperation({
        moduleId: options.moduleId,
        sourcePath,
        sourceRelativePath,
        destinationPath,
        strategy: options.strategy || 'flatten-copy'
      })
    );
  }

  return files.length;
}

function isDirectoryNonEmpty(dirPath) {
  return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory() && fs.readdirSync(dirPath).length > 0;
}

function planClaudeStyleLegacyInstall(context, { adapterId, adapterRootInput, rulesDir: rulesDirOverride }) {
  const adapter = getInstallTargetAdapter(adapterId);
  const targetRoot = adapter.resolveRoot(adapterRootInput);
  const rulesDir = rulesDirOverride || path.join(targetRoot, 'rules', CLAUDE_ECC_NAMESPACE);
  const installStatePath = adapter.getInstallStatePath(adapterRootInput);
  const operations = [];
  const warnings = [];

  if (isDirectoryNonEmpty(rulesDir)) {
    warnings.push(`Destination ${rulesDir}/ already exists and files may be overwritten`);
  }

  addRecursiveCopyOperations(operations, {
    moduleId: 'legacy-claude-rules',
    sourceRoot: context.sourceRoot,
    sourceRelativeDir: path.join('rules', 'common'),
    destinationDir: path.join(rulesDir, 'common')
  });

  for (const language of context.languages) {
    if (!LANGUAGE_NAME_PATTERN.test(language)) {
      warnings.push(`Invalid language name '${language}'. Only alphanumeric, dash, and underscore are allowed`);
      continue;
    }

    const sourceDir = path.join(context.sourceRoot, 'rules', language);
    if (!fs.existsSync(sourceDir)) {
      warnings.push(`rules/${language}/ does not exist, skipping`);
      continue;
    }

    addRecursiveCopyOperations(operations, {
      moduleId: 'legacy-claude-rules',
      sourceRoot: context.sourceRoot,
      sourceRelativeDir: path.join('rules', language),
      destinationDir: path.join(rulesDir, language)
    });
  }

  return {
    mode: 'legacy',
    adapter,
    target: adapterId,
    targetRoot,
    installRoot: rulesDir,
    installStatePath,
    operations,
    warnings,
    selectedModules: ['legacy-claude-rules']
  };
}

function planClaudeLegacyInstall(context) {
  return planClaudeStyleLegacyInstall(context, {
    adapterId: 'claude',
    adapterRootInput: { homeDir: context.homeDir },
    rulesDir: context.claudeRulesDir || null
  });
}

function planClaudeProjectLegacyInstall(context) {
  return planClaudeStyleLegacyInstall(context, {
    adapterId: 'claude-project',
    adapterRootInput: { repoRoot: context.projectRoot },
    rulesDir: null
  });
}

function planCursorLegacyInstall(context) {
  const adapter = getInstallTargetAdapter('cursor');
  const targetRoot = adapter.resolveRoot({ repoRoot: context.projectRoot });
  const installStatePath = adapter.getInstallStatePath({ repoRoot: context.projectRoot });
  const operations = [];
  const warnings = [];

  addMatchingRuleOperations(operations, {
    moduleId: 'legacy-cursor-install',
    sourceRoot: context.sourceRoot,
    sourceRelativeDir: path.join('.cursor', 'rules'),
    destinationDir: path.join(targetRoot, 'rules'),
    matcher: fileName => /^common-.*\.md$/.test(fileName)
  });

  for (const language of context.languages) {
    if (!LANGUAGE_NAME_PATTERN.test(language)) {
      warnings.push(`Invalid language name '${language}'. Only alphanumeric, dash, and underscore are allowed`);
      continue;
    }

    const matches = addMatchingRuleOperations(operations, {
      moduleId: 'legacy-cursor-install',
      sourceRoot: context.sourceRoot,
      sourceRelativeDir: path.join('.cursor', 'rules'),
      destinationDir: path.join(targetRoot, 'rules'),
      matcher: fileName => fileName.startsWith(`${language}-`) && fileName.endsWith('.md')
    });

    if (matches === 0) {
      warnings.push(`No Cursor rules for '${language}' found, skipping`);
    }
  }

  addRecursiveCopyOperations(operations, {
    moduleId: 'legacy-cursor-install',
    sourceRoot: context.sourceRoot,
    sourceRelativeDir: path.join('.cursor', 'agents'),
    destinationDir: path.join(targetRoot, 'agents'),
    destinationRelativePathTransform: toCursorAgentRelativePath
  });
  addRecursiveCopyOperations(operations, {
    moduleId: 'legacy-cursor-install',
    sourceRoot: context.sourceRoot,
    sourceRelativeDir: path.join('.cursor', 'skills'),
    destinationDir: path.join(targetRoot, 'skills')
  });
  addRecursiveCopyOperations(operations, {
    moduleId: 'legacy-cursor-install',
    sourceRoot: context.sourceRoot,
    sourceRelativeDir: path.join('.cursor', 'commands'),
    destinationDir: path.join(targetRoot, 'commands')
  });
  addRecursiveCopyOperations(operations, {
    moduleId: 'legacy-cursor-install',
    sourceRoot: context.sourceRoot,
    sourceRelativeDir: path.join('.cursor', 'hooks'),
    destinationDir: path.join(targetRoot, 'hooks')
  });

  addFileCopyOperation(operations, {
    moduleId: 'legacy-cursor-install',
    sourceRoot: context.sourceRoot,
    sourceRelativePath: path.join('.cursor', 'hooks.json'),
    destinationPath: path.join(targetRoot, 'hooks.json')
  });
  addJsonMergeOperation(operations, {
    moduleId: 'legacy-cursor-install',
    sourceRoot: context.sourceRoot,
    sourceRelativePath: '.mcp.json',
    destinationPath: path.join(targetRoot, 'mcp.json')
  });

  addCursorAgentDataScaffoldOperations(operations, {
    moduleId: 'legacy-cursor-install',
    sourceRoot: context.sourceRoot,
    targetRoot
  });

  return {
    mode: 'legacy',
    adapter,
    target: 'cursor',
    targetRoot,
    installRoot: targetRoot,
    installStatePath,
    operations,
    warnings,
    selectedModules: ['legacy-cursor-install']
  };
}

function planAntigravityLegacyInstall(context) {
  const adapter = getInstallTargetAdapter('antigravity');
  const targetRoot = adapter.resolveRoot({ repoRoot: context.projectRoot });
  const installStatePath = adapter.getInstallStatePath({ repoRoot: context.projectRoot });
  const operations = [];
  const warnings = [];

  if (isDirectoryNonEmpty(path.join(targetRoot, 'rules'))) {
    warnings.push(`Destination ${path.join(targetRoot, 'rules')}/ already exists and files may be overwritten`);
  }

  addMatchingRuleOperations(operations, {
    moduleId: 'legacy-antigravity-install',
    sourceRoot: context.sourceRoot,
    sourceRelativeDir: path.join('rules', 'common'),
    destinationDir: path.join(targetRoot, 'rules'),
    matcher: fileName => fileName.endsWith('.md'),
    rename: fileName => `common-${fileName}`
  });

  for (const language of context.languages) {
    if (!LANGUAGE_NAME_PATTERN.test(language)) {
      warnings.push(`Invalid language name '${language}'. Only alphanumeric, dash, and underscore are allowed`);
      continue;
    }

    const sourceDir = path.join(context.sourceRoot, 'rules', language);
    if (!fs.existsSync(sourceDir)) {
      warnings.push(`rules/${language}/ does not exist, skipping`);
      continue;
    }

    addMatchingRuleOperations(operations, {
      moduleId: 'legacy-antigravity-install',
      sourceRoot: context.sourceRoot,
      sourceRelativeDir: path.join('rules', language),
      destinationDir: path.join(targetRoot, 'rules'),
      matcher: fileName => fileName.endsWith('.md'),
      rename: fileName => `${language}-${fileName}`
    });
  }

  addRecursiveCopyOperations(operations, {
    moduleId: 'legacy-antigravity-install',
    sourceRoot: context.sourceRoot,
    sourceRelativeDir: 'commands',
    destinationDir: path.join(targetRoot, 'workflows')
  });
  addRecursiveCopyOperations(operations, {
    moduleId: 'legacy-antigravity-install',
    sourceRoot: context.sourceRoot,
    sourceRelativeDir: 'agents',
    destinationDir: path.join(targetRoot, 'skills')
  });
  addRecursiveCopyOperations(operations, {
    moduleId: 'legacy-antigravity-install',
    sourceRoot: context.sourceRoot,
    sourceRelativeDir: 'skills',
    destinationDir: path.join(targetRoot, 'skills')
  });

  return {
    mode: 'legacy',
    adapter,
    target: 'antigravity',
    targetRoot,
    installRoot: targetRoot,
    installStatePath,
    operations,
    warnings,
    selectedModules: ['legacy-antigravity-install']
  };
}

function createLegacyInstallPlan(options = {}) {
  const sourceRoot = options.sourceRoot || getSourceRoot();
  const projectRoot = options.projectRoot || process.cwd();
  const homeDir = options.homeDir || process.env.HOME || os.homedir();
  const target = options.target || 'claude';

  validateLegacyTarget(target);

  const context = {
    sourceRoot,
    projectRoot,
    homeDir,
    languages: Array.isArray(options.languages) ? options.languages : [],
    claudeRulesDir: options.claudeRulesDir || process.env.CLAUDE_RULES_DIR || null
  };

  let plan;
  if (target === 'claude') {
    plan = planClaudeLegacyInstall(context);
  } else if (target === 'claude-project') {
    plan = planClaudeProjectLegacyInstall(context);
  } else if (target === 'cursor') {
    plan = planCursorLegacyInstall(context);
  } else {
    plan = planAntigravityLegacyInstall(context);
  }

  const source = {
    repoVersion: getPackageVersion(sourceRoot),
    repoCommit: getRepoCommit(sourceRoot),
    manifestVersion: getManifestVersion(sourceRoot)
  };

  const statePreview = createStatePreview({
    adapter: plan.adapter,
    targetRoot: plan.targetRoot,
    installStatePath: plan.installStatePath,
    request: {
      profile: null,
      modules: [],
      legacyLanguages: context.languages,
      legacyMode: true
    },
    resolution: {
      selectedModules: plan.selectedModules,
      skippedModules: []
    },
    operations: plan.operations,
    source
  });

  return {
    mode: 'legacy',
    target: plan.target,
    adapter: {
      id: plan.adapter.id,
      target: plan.adapter.target,
      kind: plan.adapter.kind
    },
    targetRoot: plan.targetRoot,
    installRoot: plan.installRoot,
    installStatePath: plan.installStatePath,
    warnings: plan.warnings,
    languages: context.languages,
    operations: plan.operations,
    statePreview
  };
}

function createLegacyCompatInstallPlan(options = {}) {
  const sourceRoot = options.sourceRoot || getSourceRoot();
  const projectRoot = options.projectRoot || process.cwd();
  const target = options.target || 'claude';
  const includeComponentIds = Array.isArray(options.includeComponentIds) ? [...options.includeComponentIds] : [];
  const excludeComponentIds = Array.isArray(options.excludeComponentIds) ? [...options.excludeComponentIds] : [];

  validateLegacyTarget(target);

  const selection = resolveLegacyCompatibilitySelection({
    repoRoot: sourceRoot,
    target,
    legacyLanguages: options.legacyLanguages || []
  });

  return createManifestInstallPlan({
    sourceRoot,
    projectRoot,
    homeDir: options.homeDir,
    target,
    profileId: null,
    moduleIds: selection.moduleIds,
    includeComponentIds,
    excludeComponentIds,
    legacyLanguages: selection.legacyLanguages,
    legacyMode: true,
    requestProfileId: null,
    requestModuleIds: [],
    requestIncludeComponentIds: includeComponentIds,
    requestExcludeComponentIds: excludeComponentIds,
    mode: 'legacy-compat'
  });
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
        strategy: operation.strategy
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
      strategy: operation.strategy
    });
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
    profileId: options.profileId || null,
    moduleIds: options.moduleIds || [],
    includeComponentIds: options.includeComponentIds || [],
    excludeComponentIds: options.excludeComponentIds || [],
    target
  });
  const adapter = getInstallTargetAdapter(target);
  const operations = plan.operations.flatMap(operation => materializeScaffoldOperation(sourceRoot, operation));
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
    target,
    adapter: {
      id: adapter.id,
      target: adapter.target,
      kind: adapter.kind
    },
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
  SUPPORTED_INSTALL_TARGETS,
  LEGACY_INSTALL_TARGETS,
  applyInstallPlan,
  createLegacyCompatInstallPlan,
  createManifestInstallPlan,
  createLegacyInstallPlan,
  getSourceRoot,
  listAvailableLanguages,
  parseInstallArgs
};
