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

function listRelativeFiles(dirPath, prefix = '') {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const files = [];

  for (const entry of entries) {
    const entryRelativePath = prefix ? path.join(prefix, entry.name) : entry.name;
    const entryAbsolutePath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...listRelativeFiles(entryAbsolutePath, entryRelativePath));
    } else if (entry.isFile()) {
      files.push(entryRelativePath);
    }
  }

  return files;
}

function createOpencodeNativeOperations(moduleId, repoRoot, targetRoot) {
  const opencodeRoot = path.join(repoRoot, '.opencode');
  if (!fs.existsSync(opencodeRoot) || !fs.statSync(opencodeRoot).isDirectory()) {
    return [];
  }

  const operations = [];
  const entries = fs.readdirSync(opencodeRoot, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (entry.name === 'commands') {
      continue;
    }

    const entryRelativePath = path.join('.opencode', entry.name);
    const entryAbsolutePath = path.join(opencodeRoot, entry.name);

    if (entry.isDirectory()) {
      for (const relativeFile of listRelativeFiles(entryAbsolutePath)) {
        operations.push(createManagedOperation({
          kind: 'copy-file',
          moduleId,
          sourceRelativePath: path.join(entryRelativePath, relativeFile),
          destinationPath: path.join(targetRoot, entry.name, relativeFile),
          strategy: 'preserve-relative-path',
          ownership: 'managed',
          scaffoldOnly: false,
        }));
      }
      continue;
    }

    if (entry.isFile()) {
      operations.push(createManagedOperation({
        kind: 'copy-file',
        moduleId,
        sourceRelativePath: entryRelativePath,
        destinationPath: path.join(targetRoot, entry.name),
        strategy: 'preserve-relative-path',
        ownership: 'managed',
        scaffoldOnly: false,
      }));
    }
  }

  return operations;
}

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
    const planningInput = {
      repoRoot: input.repoRoot,
      projectRoot: input.projectRoot,
      homeDir: input.homeDir,
    };
    const targetRoot = adapter.resolveRoot(planningInput);

    return modules.flatMap(module => {
      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths
        .filter(p => !isForeignPlatformPath(p, adapter.target))
        .flatMap(sourceRelativePath => {
          if (sourceRelativePath === '.opencode') {
            return createOpencodeNativeOperations(module.id, input.repoRoot, targetRoot);
          }

          return [adapter.createScaffoldOperation(module.id, sourceRelativePath, planningInput)];
        });
    });
  },
});
