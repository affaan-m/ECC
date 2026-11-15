const os = require('os');
const path = require('path');
const { resolveInvocationEnvironment } = require('../invocation-environment');

const {
  HOME_INSTALL_EXCLUDED_SOURCE_PATHS,
  createInstallTargetAdapter,
  createRemappedOperation,
  isForeignPlatformPath,
  normalizeRelativePath,
  planClaudeHooksOperations,
  convertWindowsPathToWSL,
} = require('./helpers');

const CLAUDE_ECC_NAMESPACE = 'ecc';

function getClaudeManagedDestinationPath(adapter, sourceRelativePath, input) {
  const normalizedSourcePath = normalizeRelativePath(sourceRelativePath);
  const targetRoot = adapter.resolveRoot(input);

  if (normalizedSourcePath === 'rules') {
    return path.join(targetRoot, 'rules', CLAUDE_ECC_NAMESPACE);
  }

  if (normalizedSourcePath.startsWith('rules/')) {
    return path.join(
      targetRoot,
      'rules',
      CLAUDE_ECC_NAMESPACE,
      normalizedSourcePath.slice('rules/'.length)
    );
  }

  if (normalizedSourcePath === 'skills') {
    return path.join(targetRoot, 'skills');
  }

  if (normalizedSourcePath.startsWith('skills/')) {
    return path.join(
      targetRoot,
      'skills',
      normalizedSourcePath.slice('skills/'.length)
    );
  }

  if (normalizedSourcePath === 'docs' || normalizedSourcePath.startsWith('docs/')) {
    return path.join(targetRoot, normalizedSourcePath);
  }

  return null;
}

/**
 * Expand leading ~, ~/, ~\ against the home directory.
 * Mirrors the expansion in resolveEccRoot to keep install and runtime roots in sync.
 */
function expandTilde(inputPath, homeDir) {
  if (typeof inputPath !== 'string') return inputPath;
  const trimmed = inputPath.trim();
  if (trimmed === '~') return homeDir;
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(homeDir, trimmed.slice(2));
  }
  return trimmed;
}

// Claude Code loads its user-level config from CLAUDE_CONFIG_DIR when set,
// otherwise ~/.claude. Resolve the install root the same way the runtime does
// (see resolveClaudePaths/inventory and getDefaultClaudeAgentDataHome) so an
// install lands where Claude Code will actually read it; without this, ECC
// writes to ~/.claude and "installs, but nothing loads" whenever CLAUDE_CONFIG_DIR
// redirects the config root (common on WSL / dev-container / dotfile setups).
// On WSL, convert Windows paths (e.g., C:\Users\name\.claude) to WSL paths
// (/mnt/c/Users/name/.claude) so the installer writes to the correct location.
function resolveClaudeConfigRoot(options = {}) {
  const environment = resolveInvocationEnvironment(options);
  const configured = environment && environment.CLAUDE_CONFIG_DIR;
  const homeDir = path.resolve(options.homeDir || os.homedir());
  if (typeof configured === 'string' && configured.trim() !== '') {
    const normalized = configured.trim();
    const converted = convertWindowsPathToWSL(normalized);
    // After WSL conversion, a blank result means the config dir was invalid.
    // Fall back to the default Claude directory just like the runtime adapter does.
    const expanded = expandTilde(converted, homeDir);
    if (typeof expanded === 'string' && expanded.trim() === '') {
      return path.join(homeDir, '.claude');
    }
    return path.resolve(expanded);
  }
  return path.join(homeDir, '.claude');
}

module.exports = createInstallTargetAdapter({
  id: 'claude-home',
  target: 'claude',
  kind: 'home',
  rootSegments: ['.claude'],
  resolveRoot: resolveClaudeConfigRoot,
  installStatePathSegments: ['ecc', 'install-state.json'],
  excludedSourcePaths: HOME_INSTALL_EXCLUDED_SOURCE_PATHS,
  nativeRootRelativePath: '.claude-plugin',
  planOperations(input, adapter) {
    const modules = Array.isArray(input.modules)
      ? input.modules
      : (input.module ? [input.module] : []);
    const planningInput = {
      repoRoot: input.repoRoot,
      projectRoot: input.projectRoot,
      homeDir: input.homeDir,
      env: input.env,
    };

    const operations = modules.flatMap(module => {
      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths
        .filter(p => !isForeignPlatformPath(p, adapter.target) && !adapter.excludesSourcePath(p))
        .flatMap(sourceRelativePath => {
          if (
            module.id === 'hooks-runtime'
            && normalizeRelativePath(sourceRelativePath) === 'hooks'
          ) {
            return planClaudeHooksOperations(adapter, module, planningInput);
          }

          const managedDestinationPath = getClaudeManagedDestinationPath(
            adapter,
            sourceRelativePath,
            planningInput
          );

          if (managedDestinationPath) {
            return [createRemappedOperation(
              adapter,
              module.id,
              sourceRelativePath,
              managedDestinationPath,
              { strategy: 'preserve-relative-path' }
            )];
          }

          return [adapter.createScaffoldOperation(module.id, sourceRelativePath, planningInput)];
        });
    });
    if (!operations.some(operation => operation.moduleId === 'commands-core'
      && normalizeRelativePath(operation.sourceRelativePath).startsWith('scripts/'))) return operations;
    return [...operations, createRemappedOperation(
      adapter,
      'commands-core',
      'manifests/install-assets/commonjs-scripts-package.json',
      path.join(adapter.resolveRoot(planningInput), 'scripts', 'package.json'),
      { strategy: 'preserve-relative-path' }
    )];
  },
});
