const fs = require('fs');
const path = require('path');

const {
  createFlatRuleOperations,
  createInstallTargetAdapter,
  createManagedOperation,
  createManagedScaffoldOperation,
  normalizeRelativePath,
} = require('./helpers');
const {
  ANTIGRAVITY_HOOK_RUNTIME_SOURCE_PATHS,
  getAntigravityRuntimePath,
} = require('../install/antigravity-hooks');

const SUPPORTED_SOURCE_PREFIXES = ['rules', 'commands', 'agents', 'skills'];
const ANTIGRAVITY_HOOK_CONFIG_SOURCE = 'scripts/hooks/antigravity-hooks.json';

function supportsAntigravitySourcePath(sourceRelativePath) {
  const normalizedPath = normalizeRelativePath(sourceRelativePath);
  return SUPPORTED_SOURCE_PREFIXES.some(prefix => (
    normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
  ));
}

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

function readHookConfig(repoRoot) {
  if (!repoRoot) {
    throw new Error(`Missing Antigravity hook config source: ${ANTIGRAVITY_HOOK_CONFIG_SOURCE}`);
  }
  const sourcePath = path.join(repoRoot, ANTIGRAVITY_HOOK_CONFIG_SOURCE);
  return readJsonObject(sourcePath, 'Antigravity hooks');
}

function createHookOperations(moduleId, repoRoot, targetRoot) {
  const managedHookGroups = readHookConfig(repoRoot);
  const destinationPath = path.join(targetRoot, 'hooks.json');
  const configOperation = createManagedOperation({
    kind: 'update-antigravity-hooks',
    moduleId,
    sourceRelativePath: ANTIGRAVITY_HOOK_CONFIG_SOURCE,
    destinationPath,
    strategy: 'merge-hook-groups',
    scaffoldOnly: false,
    managedHookGroups,
  });
  const runtimeOperations = ANTIGRAVITY_HOOK_RUNTIME_SOURCE_PATHS.map(sourceRelativePath => {
    const sourcePath = path.join(repoRoot || '', sourceRelativePath);
    if (!repoRoot || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(`Missing Antigravity hook runtime dependency: ${sourcePath}`);
    }
    return createManagedOperation({
      moduleId,
      sourceRelativePath,
      destinationPath: getAntigravityRuntimePath(targetRoot, sourceRelativePath),
      strategy: 'preserve-relative-path',
    });
  });
  // Runtime files must exist before Antigravity can discover the registration.
  return [...runtimeOperations, configOperation];
}

module.exports = createInstallTargetAdapter({
  id: 'antigravity-project',
  target: 'antigravity',
  kind: 'project',
  rootSegments: ['.agents'],
  installStatePathSegments: ['ecc-install-state.json'],
  supportsModule(module) {
    const paths = Array.isArray(module && module.paths) ? module.paths : [];
    return paths.length > 0;
  },
  planOperations(input, adapter) {
    const modules = Array.isArray(input.modules)
      ? input.modules
      : (input.module ? [input.module] : []);
    const {
      repoRoot,
      projectRoot,
      homeDir,
    } = input;
    const planningInput = {
      repoRoot,
      projectRoot,
      homeDir,
    };
    const targetRoot = adapter.resolveRoot(planningInput);

    const operations = modules.flatMap(module => {
      if (module.id === 'hooks-runtime') {
        return createHookOperations(module.id, repoRoot, targetRoot);
      }

      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths
        .filter(supportsAntigravitySourcePath)
        .flatMap(sourceRelativePath => {
          const normalizedSourcePath = normalizeRelativePath(sourceRelativePath);

          if (
            normalizedSourcePath === 'rules'
            || normalizedSourcePath.startsWith('rules/')
          ) {
            return createFlatRuleOperations({
              moduleId: module.id,
              repoRoot,
              sourceRelativePath: normalizedSourcePath,
              destinationDir: path.join(targetRoot, 'rules'),
            });
          }

          if (
            normalizedSourcePath === 'commands'
            || normalizedSourcePath.startsWith('commands/')
          ) {
            const commandRelativePath = normalizedSourcePath === 'commands'
              ? ''
              : normalizedSourcePath.slice('commands/'.length);
            return [
              createManagedScaffoldOperation(
                module.id,
                normalizedSourcePath,
                path.join(targetRoot, 'workflows', commandRelativePath),
                'preserve-relative-path'
              ),
            ];
          }

          if (
            normalizedSourcePath === 'agents'
            || normalizedSourcePath.startsWith('agents/')
          ) {
            const agentRelativePath = normalizedSourcePath === 'agents'
              ? ''
              : normalizedSourcePath.slice('agents/'.length);
            return [
              createManagedOperation({
                moduleId: module.id,
                sourceRelativePath: normalizedSourcePath,
                destinationPath: path.join(targetRoot, 'agents', agentRelativePath),
                strategy: 'preserve-relative-path',
                contentTransform: 'antigravity-agent-frontmatter',
              }),
            ];
          }

          if (
            normalizedSourcePath === 'skills'
            || normalizedSourcePath.startsWith('skills/')
          ) {
            const skillRelativePath = normalizedSourcePath === 'skills'
              ? ''
              : normalizedSourcePath.slice('skills/'.length);
            return [
              createManagedScaffoldOperation(
                module.id,
                normalizedSourcePath,
                path.join(targetRoot, 'skills', skillRelativePath),
                'preserve-relative-path'
              ),
            ];
          }

          return [];
        });
    });
    const registrations = operations.filter(operation => (
      operation.kind === 'update-antigravity-hooks'
    ));
    return [
      ...operations.filter(operation => operation.kind !== 'update-antigravity-hooks'),
      ...registrations,
    ];
  },
});
