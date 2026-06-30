const { createInstallTargetAdapter, isForeignPlatformPath } = require('./helpers');

module.exports = createInstallTargetAdapter({
  id: 'codex-home',
  target: 'codex',
  kind: 'home',
  rootSegments: ['.codex'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.codex',
  planOperations(input, adapter) {
    const modules = Array.isArray(input.modules)
      ? input.modules
      : (input.module ? [input.module] : []);
    const planningInput = {
      repoRoot: input.repoRoot,
      projectRoot: input.projectRoot,
      homeDir: input.homeDir,
    };

    return modules.flatMap(module => {
      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths
        .filter(p => !isForeignPlatformPath(p, adapter.target))
        .filter(sourceRelativePath => !(
          module.id === 'agents-core'
          && sourceRelativePath === 'AGENTS.md'
        ))
        .map(sourceRelativePath => adapter.createScaffoldOperation(
          module.id,
          sourceRelativePath,
          planningInput
        ));
    });
  },
});
