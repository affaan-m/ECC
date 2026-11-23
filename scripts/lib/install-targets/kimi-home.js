const fs = require('fs');
const path = require('path');
const {
  createInstallTargetAdapter,
  createManagedOperation,
  isForeignPlatformPath,
} = require('./helpers');

module.exports = createInstallTargetAdapter({
  id: 'kimi-home',
  target: 'kimi-home',
  kind: 'home',
  rootSegments: ['.kimi-code'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.kimi-code',
  planOperations(input, adapter) {
    const modules = Array.isArray(input.modules) ? input.modules : (input.module ? [input.module] : []);
    const planningInput = {
      repoRoot: input.repoRoot,
      projectRoot: input.projectRoot,
      homeDir: input.homeDir,
    };
    const targetRoot = adapter.resolveRoot(planningInput);

    return modules.flatMap(module => {
      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths
        .filter(sourceRelativePath => sourceRelativePath === '.kimi'
          || sourceRelativePath === '.kimi-code'
          || !isForeignPlatformPath(sourceRelativePath, adapter.target))
        .flatMap(sourceRelativePath => {
          if (sourceRelativePath === 'mcp-configs') return [];
          if (sourceRelativePath === '.kimi') {
            return [createManagedOperation({
              moduleId: module.id,
              sourceRelativePath,
              destinationPath: targetRoot,
              strategy: 'sync-root-children',
            })];
          }
          if (sourceRelativePath === '.agents') {
            const skillsSourcePath = path.join(input.repoRoot || '', '.agents', 'skills');
            if (!input.repoRoot || !fs.existsSync(skillsSourcePath)) return [];
            return [createManagedOperation({
              moduleId: module.id,
              sourceRelativePath: '.agents/skills',
              destinationPath: path.join(targetRoot, 'skills'),
              strategy: 'preserve-relative-path',
            })];
          }
          return [adapter.createScaffoldOperation(module.id, sourceRelativePath, planningInput)];
        });
    });
  },
});
