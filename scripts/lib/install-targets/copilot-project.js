const path = require('path');

const {
  createInstallTargetAdapter,
  createManagedOperation,
  createManagedScaffoldOperation,
  normalizeRelativePath,
} = require('./helpers');

// GitHub Copilot CLI discovers skills from `.github/skills/` and custom agents
// from `.github/agents/`. Those two directories are the entire supported
// surface for this target: ECC's hooks target Claude Code's event model, and
// commands rely on slash-command argument substitution Copilot does not
// provide, so neither is installed here.
const SUPPORTED_SOURCE_PREFIXES = ['agents', 'skills'];

function hasPrefix(normalizedPath, prefix) {
  return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
}

function supportsCopilotSourcePath(sourceRelativePath) {
  const normalizedPath = normalizeRelativePath(sourceRelativePath);
  return SUPPORTED_SOURCE_PREFIXES.some(prefix => hasPrefix(normalizedPath, prefix));
}

function stripPrefix(normalizedPath, prefix) {
  return normalizedPath === prefix ? '' : normalizedPath.slice(`${prefix}/`.length);
}

function planSourcePathOperations(module, sourceRelativePath, targetRoot) {
  const normalizedSourcePath = normalizeRelativePath(sourceRelativePath);

  if (hasPrefix(normalizedSourcePath, 'agents')) {
    return [
      createManagedOperation({
        moduleId: module.id,
        sourceRelativePath: normalizedSourcePath,
        destinationPath: path.join(
          targetRoot,
          'agents',
          stripPrefix(normalizedSourcePath, 'agents')
        ),
        strategy: 'preserve-relative-path',
        contentTransform: 'copilot-agent-frontmatter',
      }),
    ];
  }

  if (hasPrefix(normalizedSourcePath, 'skills')) {
    return [
      createManagedScaffoldOperation(
        module.id,
        normalizedSourcePath,
        path.join(targetRoot, 'skills', stripPrefix(normalizedSourcePath, 'skills')),
        'preserve-relative-path'
      ),
    ];
  }

  return [];
}

module.exports = createInstallTargetAdapter({
  id: 'copilot-project',
  target: 'copilot',
  kind: 'project',
  rootSegments: ['.github'],
  installStatePathSegments: ['ecc-install-state.json'],
  supportsModule(module) {
    // Selection gating stays permissive so modules that only act as dependency
    // anchors (rules-core, commands-core, platform-configs) still resolve.
    // planOperations() is what narrows the install to agents and skills, so an
    // unsupported path contributes zero operations rather than skipping the
    // module and every module that depends on it.
    const paths = Array.isArray(module && module.paths) ? module.paths : [];
    return paths.length > 0;
  },
  planOperations(input, adapter) {
    const modules = Array.isArray(input.modules)
      ? input.modules
      : (input.module ? [input.module] : []);
    const { repoRoot, projectRoot, homeDir } = input;
    const targetRoot = adapter.resolveRoot({ repoRoot, projectRoot, homeDir });

    return modules.flatMap(module => {
      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths
        .filter(supportsCopilotSourcePath)
        .flatMap(sourceRelativePath => planSourcePathOperations(
          module,
          sourceRelativePath,
          targetRoot
        ));
    });
  },
});
