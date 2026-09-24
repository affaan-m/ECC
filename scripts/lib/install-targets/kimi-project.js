const fs = require('fs');
const path = require('path');

const {
  createInstallTargetAdapter,
  createManagedOperation,
  isForeignPlatformPath,
} = require('./helpers');

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

function createMcpMergeOperation(moduleId, repoRoot, targetRoot) {
  if (!repoRoot) {
    throw new Error('repoRoot is required to plan Kimi MCP configuration');
  }

  const sourceRelativePath = '.mcp.json';
  const sourcePath = path.join(repoRoot, sourceRelativePath);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    return null;
  }

  return createManagedOperation({
    kind: 'merge-json',
    moduleId,
    sourceRelativePath,
    destinationPath: path.join(targetRoot, 'mcp.json'),
    strategy: 'merge-json',
    scaffoldOnly: false,
    mergePayload: readJsonObject(sourcePath, sourceRelativePath),
  });
}

module.exports = createInstallTargetAdapter({
  id: 'kimi-project',
  target: 'kimi',
  kind: 'project',
  rootSegments: ['.kimi-code'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.kimi-code',
  planOperations(input, adapter) {
    const modules = Array.isArray(input.modules)
      ? input.modules
      : (input.module ? [input.module] : []);
    const planningInput = {
      repoRoot: input.repoRoot,
      projectRoot: input.projectRoot,
      homeDir: input.homeDir,
    };
    const targetRoot = adapter.resolveRoot(planningInput);

    return modules.flatMap(module => {
      const paths = Array.isArray(module.paths) ? module.paths : [];

      return paths
        .filter(sourceRelativePath => !isForeignPlatformPath(sourceRelativePath, adapter.target))
        .flatMap(sourceRelativePath => {
          if (sourceRelativePath === '.kimi') {
            // The repository's compatibility documentation still lives in
            // .kimi/. Sync its children into the current native root without
            // creating that obsolete directory in the destination project.
            return [createManagedOperation({
              moduleId: module.id,
              sourceRelativePath,
              destinationPath: targetRoot,
              strategy: 'sync-root-children',
            })];
          }

          if (sourceRelativePath === '.agents') {
            const skillsSourcePath = path.join(input.repoRoot || '', '.agents', 'skills');
            if (!input.repoRoot || !fs.existsSync(skillsSourcePath)) {
              return [];
            }

            return [createManagedOperation({
              moduleId: module.id,
              sourceRelativePath: '.agents/skills',
              destinationPath: path.join(targetRoot, 'skills'),
              strategy: 'preserve-relative-path',
            })];
          }

          if (sourceRelativePath === 'mcp-configs') {
            const mcpMergeOperation = createMcpMergeOperation(module.id, input.repoRoot, targetRoot);
            return [
              adapter.createScaffoldOperation(module.id, sourceRelativePath, planningInput),
              ...(mcpMergeOperation ? [mcpMergeOperation] : []),
            ];
          }

          return [adapter.createScaffoldOperation(module.id, sourceRelativePath, planningInput)];
        });
    });
  },
});
