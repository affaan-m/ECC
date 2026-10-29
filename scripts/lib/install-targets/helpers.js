const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CLAUDE_HOOKS_CONFIG_PATH,
  getClaudeSettingsPath,
} = require('../install/claude-settings');
const { METADATA_FILENAME } = require('../hooks-config');

// Memoized WSL detection (avoids repeated /proc/version reads)
let _isWSL = null;
function isWSL() {
  if (_isWSL !== null) return _isWSL;
  if (process.platform !== 'linux') {
    _isWSL = false;
    return false;
  }
  try {
    _isWSL = fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
  } catch {
    _isWSL = false;
  }
  return _isWSL;
}

// Reset WSL detection memoization (for testing only)
function resetWSLDetection() {
  _isWSL = null;
}

// Set WSL detection for testing (for testing only)
function setWSLForTesting(value) {
  _isWSL = value;
}

// Windows path pattern: drive letter followed by :\ or :/
const WINDOWS_PATH_PATTERN = /^[A-Za-z]:[\\/]/;

// Compact WSL conversion snippet for inline resolvers embedded in commands and hooks.
// Uses 8 backslashes in regex source so it preserves shell escaping when inlined into `node -e "..."`.
const INLINE_WSL_CONVERSION = `try{if(o.platform()==='linux'){var v=f.readFileSync('/proc/version','utf8').toLowerCase();if(v.includes('microsoft')){var m=d.match(/^([A-Za-z]):[\\\\\\\\/]/);if(m){var dl=m[1].toLowerCase();d='/mnt/'+dl+d.slice(2).replace(/\\\\\\\\/g,'/')}}}}catch(_){}`;

/**
 * Convert a Windows path to a WSL path.
 * Example: "C:\Users\name" -> "/mnt/c/Users/name"
 * Example: "D:/Projects" -> "/mnt/d/Projects"
 * Returns the original path if it's not a Windows path or not on WSL.
 */
function convertWindowsPathToWSL(windowsPath) {
  if (!isWSL()) return windowsPath;
  if (typeof windowsPath !== 'string') return windowsPath;
  const trimmed = windowsPath.trim();
  if (!WINDOWS_PATH_PATTERN.test(trimmed)) return trimmed;
  const driveLetter = trimmed[0].toLowerCase();
  const rest = trimmed.slice(2).replace(/\\/g, '/');
  return `/mnt/${driveLetter}${rest}`;
}

const PLATFORM_SOURCE_PATH_OWNERS = Object.freeze({
  '.claude-plugin': 'claude',
  '.codex': 'codex',
  '.cursor': 'cursor',
  '.gemini': 'gemini',
  '.hermes': 'hermes',
  '.kimi': 'kimi',
  '.kimi-code': 'kimi',
  '.joycode': 'joycode',
  '.opencode': 'opencode',
  '.openclaw': 'openclaw',
  // Pi loads ECC through `pi install`, not install-apply, so `.pi` is
  // foreign to every install target.
  '.pi': 'pi',
  '.codebuddy': 'codebuddy',
  '.qwen': 'qwen',
  '.zed': 'zed',
  '.adal': 'adal',
});

// Source paths that home installs must never copy into a harness home
// directory. `.agents` is ECC's repo-local skills/plugins staging area:
// project targets such as kimi and antigravity consume it, but neither
// Claude Code nor Codex reads a `.agents` directory under ~/.claude or
// ~/.codex, so copying it there produces unread files that doctor flags as
// drift and repair keeps restoring.
const HOME_INSTALL_EXCLUDED_SOURCE_PATHS = Object.freeze(['.agents']);

function normalizeRelativePath(relativePath) {
  return String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
}

function isForeignPlatformPath(sourceRelativePath, adapterTarget) {
  const normalizedPath = normalizeRelativePath(sourceRelativePath);

  for (const [prefix, ownerTarget] of Object.entries(PLATFORM_SOURCE_PATH_OWNERS)) {
    if (normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)) {
      return ownerTarget !== adapterTarget;
    }
  }

  return false;
}

function isExcludedSourcePath(sourceRelativePath, excludedSourcePaths = []) {
  const normalizedPath = normalizeRelativePath(sourceRelativePath);
  return excludedSourcePaths.some(excluded => {
    const prefix = normalizeRelativePath(excluded);
    return prefix !== '' && (normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`));
  });
}

function resolveBaseRoot(scope, input = {}) {
  if (scope === 'home') {
    return input.homeDir || os.homedir();
  }

  if (scope === 'project') {
    const projectRoot = input.projectRoot || input.repoRoot;
    if (!projectRoot) {
      throw new Error('projectRoot or repoRoot is required for project install targets');
    }
    return projectRoot;
  }

  throw new Error(`Unsupported install target scope: ${scope}`);
}

function buildValidationIssue(severity, code, message, extra = {}) {
  return {
    severity,
    code,
    message,
    ...extra,
  };
}

function listRelativeFiles(dirPath, prefix = '') {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true }).sort((left, right) => (
    left.name.localeCompare(right.name)
  ));
  const files = [];

  for (const entry of entries) {
    const entryPrefix = prefix ? path.join(prefix, entry.name) : entry.name;
    const absolutePath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...listRelativeFiles(absolutePath, entryPrefix));
    } else if (entry.isFile()) {
      files.push(normalizeRelativePath(entryPrefix));
    }
  }

  return files;
}

function createManagedOperation({
  kind = 'copy-path',
  moduleId,
  sourceRelativePath,
  destinationPath,
  strategy = 'preserve-relative-path',
  ownership = 'managed',
  scaffoldOnly = true,
  ...rest
}) {
  return {
    kind,
    moduleId,
    sourceRelativePath: normalizeRelativePath(sourceRelativePath),
    destinationPath,
    strategy,
    ownership,
    scaffoldOnly,
    ...rest,
  };
}

function defaultValidateAdapterInput(config, input = {}) {
  if (config.kind === 'project' && !input.projectRoot && !input.repoRoot) {
    return [
      buildValidationIssue(
        'error',
        'missing-project-root',
        'projectRoot or repoRoot is required for project install targets'
      ),
    ];
  }

  if (config.kind === 'home' && !input.homeDir && !os.homedir()) {
    return [
      buildValidationIssue(
        'error',
        'missing-home-dir',
        'homeDir is required for home install targets'
      ),
    ];
  }

  return [];
}

function createRemappedOperation(adapter, moduleId, sourceRelativePath, destinationPath, options = {}) {
  return createManagedOperation({
    kind: options.kind || 'copy-path',
    moduleId,
    sourceRelativePath,
    destinationPath,
    strategy: options.strategy || 'preserve-relative-path',
    ownership: options.ownership || 'managed',
    scaffoldOnly: Object.hasOwn(options, 'scaffoldOnly') ? options.scaffoldOnly : true,
    ...options.extra,
  });
}

function planClaudeHooksOperations(adapter, module, input) {
  const operations = [
    createRemappedOperation(
      adapter,
      module.id,
      CLAUDE_HOOKS_CONFIG_PATH,
      getClaudeSettingsPath(adapter.resolveRoot(input)),
      {
        kind: 'update-claude-settings',
        strategy: 'merge-hook-ids',
      }
    ),
  ];

  if (!input.repoRoot) {
    return operations;
  }

  const sourceHooksRoot = path.join(input.repoRoot, 'hooks');
  if (!fs.existsSync(sourceHooksRoot)) {
    return operations;
  }

  return [
    ...operations,
    ...fs.readdirSync(sourceHooksRoot, { withFileTypes: true })
      // hooks.json is merged into settings.json above, and its metadata sidecar
      // is consumed with it, so neither is scaffolded into the target hooks dir.
      .filter(entry => entry.name !== 'hooks.json' && entry.name !== METADATA_FILENAME)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(entry => adapter.createScaffoldOperation(
        module.id,
        path.join('hooks', entry.name),
        input
      )),
  ];
}

function createNamespacedFlatRuleOperations(adapter, moduleId, sourceRelativePath, input = {}) {
  const normalizedSourcePath = normalizeRelativePath(sourceRelativePath);
  const sourceRoot = path.join(input.repoRoot || '', normalizedSourcePath);

  if (!input.repoRoot || !fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    return [];
  }

  const targetRulesDir = path.join(adapter.resolveRoot(input), 'rules');
  const operations = [];
  const entries = fs.readdirSync(sourceRoot, { withFileTypes: true }).sort((left, right) => (
    left.name.localeCompare(right.name)
  ));

  for (const entry of entries) {
    const namespace = entry.name;
    const entryPath = path.join(sourceRoot, entry.name);

    if (entry.isDirectory()) {
      const relativeFiles = listRelativeFiles(entryPath);
      for (const relativeFile of relativeFiles) {
        const flattenedFileName = `${namespace}-${normalizeRelativePath(relativeFile).replace(/\//g, '-')}`;
        const sourceRelativeFile = path.join(normalizedSourcePath, namespace, relativeFile);
        operations.push(createManagedOperation({
          moduleId,
          sourceRelativePath: sourceRelativeFile,
          destinationPath: path.join(targetRulesDir, flattenedFileName),
          strategy: 'flatten-copy',
        }));
      }
    } else if (entry.isFile()) {
      operations.push(createManagedOperation({
        moduleId,
        sourceRelativePath: path.join(normalizedSourcePath, entry.name),
        destinationPath: path.join(targetRulesDir, entry.name),
        strategy: 'flatten-copy',
      }));
    }
  }

  return operations;
}

function createFlatFileOperations({
  moduleId,
  repoRoot,
  sourceRelativePath,
  destinationDir,
  destinationNameTransform,
}) {
  const normalizedSourcePath = normalizeRelativePath(sourceRelativePath);
  const sourceRoot = path.join(repoRoot || '', normalizedSourcePath);

  if (!repoRoot || !fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    return [];
  }

  const operations = [];
  const entries = fs.readdirSync(sourceRoot, { withFileTypes: true }).sort((left, right) => (
    left.name.localeCompare(right.name)
  ));

  for (const entry of entries) {
    const namespace = entry.name;
    const entryPath = path.join(sourceRoot, entry.name);

    if (entry.isDirectory()) {
      const relativeFiles = listRelativeFiles(entryPath);
      for (const relativeFile of relativeFiles) {
        const defaultFileName = `${namespace}-${normalizeRelativePath(relativeFile).replace(/\//g, '-')}`;
        const sourceRelativeFile = path.join(normalizedSourcePath, namespace, relativeFile);
        const flattenedFileName = typeof destinationNameTransform === 'function'
          ? destinationNameTransform(defaultFileName, sourceRelativeFile)
          : defaultFileName;
        if (!flattenedFileName) {
          continue;
        }
        operations.push(createManagedOperation({
          moduleId,
          sourceRelativePath: sourceRelativeFile,
          destinationPath: path.join(destinationDir, flattenedFileName),
          strategy: 'flatten-copy',
        }));
      }
    } else if (entry.isFile()) {
      const sourceRelativeFile = path.join(normalizedSourcePath, entry.name);
      const destinationFileName = typeof destinationNameTransform === 'function'
        ? destinationNameTransform(entry.name, sourceRelativeFile)
        : entry.name;
      if (!destinationFileName) {
        continue;
      }
      operations.push(createManagedOperation({
        moduleId,
        sourceRelativePath: sourceRelativeFile,
        destinationPath: path.join(destinationDir, destinationFileName),
        strategy: 'flatten-copy',
      }));
    }
  }

  return operations;
}

function createFlatRuleOperations(options) {
  return createFlatFileOperations(options);
}

function createInstallTargetAdapter(config) {
  const adapter = {
    id: config.id,
    target: config.target,
    kind: config.kind,
    nativeRootRelativePath: config.nativeRootRelativePath || null,
    supports(target) {
      return target === config.target || target === config.id;
    },
    resolveRoot(input = {}) {
      const baseRoot = resolveBaseRoot(config.kind, input);
      if (typeof config.resolveRoot === 'function') {
        return config.resolveRoot(input, baseRoot);
      }
      return path.join(baseRoot, ...config.rootSegments);
    },
    getInstallStatePath(input = {}) {
      const root = adapter.resolveRoot(input);
      return path.join(root, ...config.installStatePathSegments);
    },
    resolveDestinationPath(sourceRelativePath, input = {}) {
      const normalizedSourcePath = normalizeRelativePath(sourceRelativePath);
      const targetRoot = adapter.resolveRoot(input);

      if (
        config.nativeRootRelativePath
        && normalizedSourcePath === normalizeRelativePath(config.nativeRootRelativePath)
      ) {
        return targetRoot;
      }

      return path.join(targetRoot, normalizedSourcePath);
    },
    determineStrategy(sourceRelativePath) {
      const normalizedSourcePath = normalizeRelativePath(sourceRelativePath);

      if (
        config.nativeRootRelativePath
        && normalizedSourcePath === normalizeRelativePath(config.nativeRootRelativePath)
      ) {
        return 'sync-root-children';
      }

      return 'preserve-relative-path';
    },
    createScaffoldOperation(moduleId, sourceRelativePath, input = {}) {
      const normalizedSourcePath = normalizeRelativePath(sourceRelativePath);
      return createManagedOperation({
        moduleId,
        sourceRelativePath: normalizedSourcePath,
        destinationPath: adapter.resolveDestinationPath(normalizedSourcePath, input),
        strategy: adapter.determineStrategy(normalizedSourcePath),
      });
    },
    excludesSourcePath(sourceRelativePath) {
      return isExcludedSourcePath(sourceRelativePath, config.excludedSourcePaths);
    },
    planOperations(input = {}) {
      if (typeof config.planOperations === 'function') {
        return config.planOperations(input, adapter);
      }

      if (Array.isArray(input.modules)) {
        return input.modules.flatMap(module => {
          const paths = Array.isArray(module.paths) ? module.paths : [];
          return paths
            .filter(p => !isForeignPlatformPath(p, config.target) && !adapter.excludesSourcePath(p))
            .map(sourceRelativePath => adapter.createScaffoldOperation(
              module.id,
              sourceRelativePath,
              input
            ));
        });
      }

      const module = input.module || {};
      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths
        .filter(p => !isForeignPlatformPath(p, config.target) && !adapter.excludesSourcePath(p))
        .map(sourceRelativePath => adapter.createScaffoldOperation(
          module.id,
          sourceRelativePath,
          input
        ));
    },
    supportsModule(module, input = {}) {
      if (typeof config.supportsModule === 'function') {
        return config.supportsModule(module, input, adapter);
      }

      return true;
    },
    validate(input = {}) {
      if (typeof config.validate === 'function') {
        return config.validate(input, adapter);
      }

      return defaultValidateAdapterInput(config, input);
    },
  };

  return Object.freeze(adapter);
}

module.exports = {
  HOME_INSTALL_EXCLUDED_SOURCE_PATHS,
  isExcludedSourcePath,
  buildValidationIssue,
  createFlatFileOperations,
  createFlatRuleOperations,
  createInstallTargetAdapter,
  createManagedOperation,
  createManagedScaffoldOperation: (moduleId, sourceRelativePath, destinationPath, strategy) => (
    createManagedOperation({
      moduleId,
      sourceRelativePath,
      destinationPath,
      strategy,
    })
  ),
  createNamespacedFlatRuleOperations,
  createRemappedOperation,
  isForeignPlatformPath,
  normalizeRelativePath,
  planClaudeHooksOperations,
  isWSL,
  resetWSLDetection,
  setWSLForTesting,
  convertWindowsPathToWSL,
  INLINE_WSL_CONVERSION,
};
