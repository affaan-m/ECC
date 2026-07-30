const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildValidationIssue,
  createInstallTargetAdapter,
  createManagedOperation,
  isForeignPlatformPath,
} = require('./helpers');

const COMPILED_PLUGIN_DIST_DIR = path.join('.opencode', 'dist');
const REQUIRED_COMPILED_ARTEFACTS = Object.freeze([
  { relativePath: path.join(COMPILED_PLUGIN_DIST_DIR, 'index.js'), expectedType: 'file' },
  { relativePath: path.join(COMPILED_PLUGIN_DIST_DIR, 'plugins'), expectedType: 'directory' },
  { relativePath: path.join(COMPILED_PLUGIN_DIST_DIR, 'tools'), expectedType: 'directory' },
]);
const BUILD_COMMAND_HINT = 'node scripts/build-opencode.js (or: npm run build:opencode)';

// Errors that mean "this artefact does not exist at the expected path / type".
// Anything else (EACCES, EIO, ...) is a genuine system fault we surface to the
// caller rather than masking as a missing artefact.
const MISSING_ARTEFACT_ERROR_CODES = new Set(['ENOENT', 'ENOTDIR']);

function isExpectedType(absolutePath, expectedType) {
  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch (error) {
    if (error && MISSING_ARTEFACT_ERROR_CODES.has(error.code)) {
      return false;
    }
    throw error;
  }
  return expectedType === 'file' ? stat.isFile() : stat.isDirectory();
}

function defaultValidateOpencodeHome(input = {}) {
  if (!input.homeDir && !os.homedir()) {
    return [
      buildValidationIssue(
        'error',
        'missing-home-dir',
        'homeDir is required for home install targets'
      ),
    ];
  }

  if (!input.repoRoot) {
    return [];
  }
  const modules = Array.isArray(input.modules)
    ? input.modules
    : (input.module ? [input.module] : []);
  const hasExplicitModuleSelection = input.modules !== undefined || input.module !== undefined;
  if (
    hasExplicitModuleSelection
    && !modules.some(module => module.id === 'hooks-runtime')
  ) {
    return [];
  }

  const missingPaths = REQUIRED_COMPILED_ARTEFACTS
    .map(artefact => ({
      relativePath: artefact.relativePath,
      absolutePath: path.join(input.repoRoot, artefact.relativePath),
      expectedType: artefact.expectedType,
    }))
    .filter(entry => !isExpectedType(entry.absolutePath, entry.expectedType));

  if (missingPaths.length > 0) {
    const missingList = missingPaths.map(entry => entry.relativePath).join(', ');
    return [
      buildValidationIssue(
        'error',
        'opencode-plugin-not-built',
        'OpenCode install requires the compiled plugin payload under '
          + `${COMPILED_PLUGIN_DIST_DIR}, but the following artefact(s) were `
          + `missing or had the wrong type: ${missingList}. Run `
          + `${BUILD_COMMAND_HINT} from the repo root before re-running the `
          + 'installer.',
        {
          missingPaths: missingPaths.map(entry => entry.absolutePath),
          missingRelativePaths: missingPaths.map(entry => entry.relativePath),
          expectedTypes: missingPaths.map(entry => entry.expectedType),
        }
      ),
    ];
  }

  return [];
}

module.exports = createInstallTargetAdapter({
  id: 'opencode-home',
  target: 'opencode',
  kind: 'home',
  rootSegments: ['.opencode'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.opencode',
  validate: defaultValidateOpencodeHome,
  planOperations(input, adapter) {
    const modules = Array.isArray(input.modules)
      ? input.modules
      : (input.module ? [input.module] : []);
    const includeHooksRuntime = modules.some(module => module.id === 'hooks-runtime');
    const targetRoot = adapter.resolveRoot(input);

    return modules.flatMap(module => {
      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths
        .filter(sourceRelativePath => !isForeignPlatformPath(sourceRelativePath, adapter.target))
        .flatMap(sourceRelativePath => {
          if (sourceRelativePath !== '.opencode' || includeHooksRuntime) {
            return [adapter.createScaffoldOperation(module.id, sourceRelativePath, input)];
          }

          const safePaths = [
            '.opencode/commands',
            '.opencode/instructions',
            '.opencode/prompts',
            '.opencode/tools',
            '.opencode/dist/tools',
          ];
          const operations = safePaths
            .filter(relativePath => fs.existsSync(path.join(input.repoRoot, relativePath)))
            .map(relativePath => createManagedOperation({
              moduleId: module.id,
              sourceRelativePath: relativePath,
              destinationPath: path.join(
                targetRoot,
                path.relative('.opencode', relativePath)
              ),
              strategy: 'preserve-relative-path',
            }));
          operations.push(createManagedOperation({
            moduleId: module.id,
            sourceRelativePath: 'scaffolds/opencode/opencode-core.json',
            destinationPath: path.join(targetRoot, 'opencode.json'),
            strategy: 'copy-safe-core-config',
          }));
          return operations;
        });
    });
  },
});
