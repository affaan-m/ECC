const fs = require('fs');
const path = require('path');

const {
  createInstallTargetAdapter,
  createManagedOperation,
  listRelativeFiles,
  normalizeRelativePath,
} = require('./helpers');

// GitHub Copilot CLI discovers skills from `.github/skills/`, custom agents
// from `.github/agents/`, and path-specific instructions from
// `.github/instructions/**/*.instructions.md`. Rules are installed under
// `instructions/ecc/` with their Claude-style `paths:` frontmatter converted
// to Copilot's `applyTo:` glob list. Explicitly declared package-manager
// helpers live in `.github/ecc/scripts/`, outside Copilot's discovery roots.
// ECC's hooks target Claude Code's event model, and commands rely on
// slash-command argument substitution Copilot does not provide, so neither is
// installed here.
const SUPPORTED_SOURCE_PREFIXES = ['agents', 'skills', 'rules'];
const COPILOT_HELPER_PATHS = new Set([
  'scripts/setup-package-manager.js',
  'scripts/lib/package-manager.js',
  'scripts/lib/utils.js',
  'scripts/lib/agent-data-home.js',
  'scripts/lib/path-safety.js',
]);

function hasPrefix(normalizedPath, prefix) {
  return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
}

function supportsCopilotSourcePath(sourceRelativePath) {
  const normalizedPath = normalizeRelativePath(sourceRelativePath);
  if (normalizedPath.split('/').includes('..')) return false;
  return COPILOT_HELPER_PATHS.has(normalizedPath)
    || SUPPORTED_SOURCE_PREFIXES.some(prefix => hasPrefix(normalizedPath, prefix));
}

function stripPrefix(normalizedPath, prefix) {
  return normalizedPath === prefix ? '' : normalizedPath.slice(`${prefix}/`.length);
}

// Rules expand to per-file operations because the destination renames each
// Markdown file to `.instructions.md`, which a directory-level copy cannot
// express. `rules/README.md` documents the rule set and is not installed.
function planCopilotRuleOperations(module, normalizedSourcePath, targetRoot, repoRoot) {
  const sourceRoot = path.join(repoRoot || '', normalizedSourcePath);
  if (!repoRoot || !fs.existsSync(sourceRoot)) {
    return [];
  }

  const prefix = stripPrefix(normalizedSourcePath, 'rules');
  const sourceFiles = fs.statSync(sourceRoot).isDirectory()
    ? listRelativeFiles(sourceRoot).map(file => ({ source: `${normalizedSourcePath}/${file}`, relative: prefix ? `${prefix}/${file}` : file }))
    : [{ source: normalizedSourcePath, relative: prefix }];

  return sourceFiles
    .filter(({ relative }) => /\.md$/i.test(relative) && !/(^|\/)README\.md$/i.test(relative))
    .map(({ source, relative }) => createManagedOperation({
      moduleId: module.id,
      sourceRelativePath: source,
      destinationPath: path.join(
        targetRoot,
        'instructions',
        'ecc',
        relative.replace(/\.md$/i, '.instructions.md')
      ),
      contentTransform: 'copilot-rule-frontmatter',
    }));
}

function planSourcePathOperations(module, sourceRelativePath, targetRoot, repoRoot) {
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
      createManagedOperation({
        moduleId: module.id,
        sourceRelativePath: normalizedSourcePath,
        destinationPath: path.join(targetRoot, 'skills', stripPrefix(normalizedSourcePath, 'skills')),
        contentTransform: 'copilot-workflow-paths',
      }),
    ];
  }

  if (hasPrefix(normalizedSourcePath, 'rules')) {
    return planCopilotRuleOperations(module, normalizedSourcePath, targetRoot, repoRoot);
  }

  if (COPILOT_HELPER_PATHS.has(normalizedSourcePath)) {
    return [createManagedOperation({
      moduleId: module.id,
      sourceRelativePath: normalizedSourcePath,
      destinationPath: path.join(targetRoot, 'ecc', normalizedSourcePath),
    })];
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
    // planOperations() narrows the install to agents, skills, rules and declared helpers. An
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
          targetRoot,
          repoRoot
        ));
    });
  },
});
