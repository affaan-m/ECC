const fs = require('fs');
const path = require('path');

const {
  createInstallTargetAdapter,
  createManagedOperation,
  createRemappedOperation,
  isForeignPlatformPath,
  listRelativeFiles,
  normalizeRelativePath,
} = require('./helpers');

const CLAUDE_ECC_NAMESPACE = 'ecc';

function planLocalOverlay(repoRoot, projectRoot) {
  const operations = [];
  const localDir = path.join(repoRoot || '', 'local');

  if (!repoRoot || !fs.existsSync(localDir) || !fs.statSync(localDir).isDirectory()) {
    return operations;
  }

  const effectiveProjectRoot = projectRoot || repoRoot;
  const targetRoot = path.join(effectiveProjectRoot, '.claude');

  const rulesFiles = listRelativeFiles(path.join(localDir, 'rules'));
  for (const file of rulesFiles) {
    operations.push(createManagedOperation({
      moduleId: 'local-overlay',
      sourceRelativePath: normalizeRelativePath(path.join('local', 'rules', file)),
      destinationPath: path.join(targetRoot, 'rules', file),
      strategy: 'preserve-relative-path',
    }));
  }

  const commandsFiles = listRelativeFiles(path.join(localDir, 'commands'));
  for (const file of commandsFiles) {
    operations.push(createManagedOperation({
      moduleId: 'local-overlay',
      sourceRelativePath: normalizeRelativePath(path.join('local', 'commands', file)),
      destinationPath: path.join(targetRoot, 'commands', file),
      strategy: 'preserve-relative-path',
    }));
  }

  return operations;
}

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

module.exports = createInstallTargetAdapter({
  id: 'claude-project',
  target: 'claude-project',
  kind: 'project',
  rootSegments: ['.claude'],
  installStatePathSegments: ['ecc', 'install-state.json'],
  nativeRootRelativePath: '.claude-plugin',
  planOperations(input, adapter) {
    const modules = Array.isArray(input.modules)
      ? input.modules
      : (input.module ? [input.module] : []);
    const planningInput = {
      repoRoot: input.repoRoot,
      projectRoot: input.projectRoot,
      homeDir: input.homeDir,
    };

    const baseOperations = modules.flatMap(module => {
      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths
        .filter(p => !isForeignPlatformPath(p, 'claude'))
        .map(sourceRelativePath => {
          const managedDestinationPath = getClaudeManagedDestinationPath(
            adapter,
            sourceRelativePath,
            planningInput
          );

          if (managedDestinationPath) {
            return createRemappedOperation(
              adapter,
              module.id,
              sourceRelativePath,
              managedDestinationPath,
              { strategy: 'preserve-relative-path' }
            );
          }

          return adapter.createScaffoldOperation(module.id, sourceRelativePath, planningInput);
        });
    });

    const overlayOperations = planLocalOverlay(input.repoRoot, input.projectRoot);
    return [...baseOperations, ...overlayOperations];
  },
});
