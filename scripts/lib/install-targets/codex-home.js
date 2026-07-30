const {
  createInstallTargetAdapter,
  isForeignPlatformPath,
} = require('./helpers');

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
    const includeActivePlatformConfig = modules.some(module => (
      module.id === 'hooks-runtime' || module.id === 'mcp-catalog'
    ));

    return modules.flatMap(module => (
      (Array.isArray(module.paths) ? module.paths : [])
        .filter(sourceRelativePath => !isForeignPlatformPath(sourceRelativePath, adapter.target))
        .filter(sourceRelativePath => (
          sourceRelativePath !== '.codex' || includeActivePlatformConfig
        ))
        .map(sourceRelativePath => (
          adapter.createScaffoldOperation(module.id, sourceRelativePath, input)
        ))
    ));
  },
});
