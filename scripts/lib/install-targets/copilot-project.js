const fs = require('fs');
const path = require('path');
const { COPILOT_HOOK_RUNTIME_PATHS, COPILOT_SESSION_RUNTIME_PATHS } = require('../copilot-hooks');
const { copilotCommandName } = require('../install/copilot-command-capabilities');

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
// The hooks-runtime module projects an audited subset into a dedicated native
// hooks file and a closed script dependency set. Legacy commands project into
// skills with explicit capability status; canonical same-name skills win.
const SUPPORTED_SOURCE_PREFIXES = ['agents', 'skills', 'rules', 'commands'];
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

function planCopilotCommandOperations(module, sourceRelativePath, targetRoot, repoRoot, selectedSkills) {
  if (!repoRoot) return [];
  const sourceRoot = path.join(repoRoot, sourceRelativePath);
  if (!fs.existsSync(sourceRoot)) return [];
  const files = fs.statSync(sourceRoot).isDirectory()
    ? listRelativeFiles(sourceRoot).map(file => `${sourceRelativePath}/${file}`)
    : [sourceRelativePath];
  return files.filter(file => /^commands\/[a-z][a-z0-9-]*\.md$/.test(file)).flatMap(file => {
    const name = path.basename(file, '.md');
    const canonical = `skills/${name}`;
    if (fs.existsSync(path.join(repoRoot, canonical, 'SKILL.md'))) {
      if (selectedSkills.has(canonical) || selectedSkills.has(`${canonical}/SKILL.md`) || selectedSkills.has('skills')) return [];
      return [createManagedOperation({
        moduleId: module.id, sourceRelativePath: canonical,
        destinationPath: path.join(targetRoot, 'skills', name),
        contentTransform: 'copilot-workflow-paths',
      })];
    }
    return [createManagedOperation({
      moduleId: module.id, sourceRelativePath: file,
      destinationPath: path.join(targetRoot, 'skills', copilotCommandName(name), 'SKILL.md'),
      contentTransform: 'copilot-command',
    })];
  });
}

function planSourcePathOperations(module, sourceRelativePath, targetRoot, repoRoot, selectedSkills) {
  const normalizedSourcePath = normalizeRelativePath(sourceRelativePath);

  if (hasPrefix(normalizedSourcePath, 'commands')) {
    return planCopilotCommandOperations(module, normalizedSourcePath, targetRoot, repoRoot, selectedSkills);
  }

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

function planHookOperations(module, targetRoot, hasCommands) {
  return [
    createManagedOperation({
      moduleId: module.id, sourceRelativePath: 'hooks/hooks.json',
      destinationPath: path.join(targetRoot, 'hooks', 'ecc.json'),
      contentTransform: 'copilot-hooks',
    }),
    ...COPILOT_HOOK_RUNTIME_PATHS.filter(source => !hasCommands || !COPILOT_SESSION_RUNTIME_PATHS.includes(source)).map(sourceRelativePath => createManagedOperation({
      moduleId: module.id, sourceRelativePath,
      destinationPath: path.join(targetRoot, 'ecc', sourceRelativePath),
    })),
  ];
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

    const selectedSkills = new Set(modules.flatMap(module => module.paths || [])
      .map(normalizeRelativePath).filter(source => hasPrefix(source, 'skills')));
    return modules.flatMap(module => {
      if (module.id === 'hooks-runtime') return planHookOperations(module, targetRoot, modules.some(candidate => candidate.id === 'commands-core'));
      const paths = Array.isArray(module.paths) ? module.paths : [];
      const operations = paths
        .filter(supportsCopilotSourcePath)
        .flatMap(sourceRelativePath => planSourcePathOperations(
          module,
          sourceRelativePath,
          targetRoot,
          repoRoot,
          selectedSkills
        ));
      if (module.id === 'commands-core') {
        return [...operations, ...COPILOT_SESSION_RUNTIME_PATHS.map(sourceRelativePath => createManagedOperation({
          moduleId: module.id, sourceRelativePath,
          destinationPath: path.join(targetRoot, 'ecc', sourceRelativePath),
        }))];
      }
      return operations;
    });
  },
});
