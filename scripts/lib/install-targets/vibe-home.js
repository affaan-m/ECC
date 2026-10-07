const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  HOME_INSTALL_EXCLUDED_SOURCE_PATHS,
  buildValidationIssue,
  createInstallTargetAdapter,
  isForeignPlatformPath,
  normalizeRelativePath,
} = require('./helpers');

// The Vibe plugin payload is generated into vibe/core/ by
// scripts/build-vibe.js (npm run build:vibe). The adapter installs the whole
// payload under ~/.vibe/plugins/ecc/ and then selectively adds canonical
// skills/ directories on top, so profile/--with/--without selection stays
// granular for the skills surface.
const VIBE_PAYLOAD_RELATIVE_PATH = 'vibe/core';
const REQUIRED_PAYLOAD_ARTEFACTS = Object.freeze([
  { relativePath: path.join(VIBE_PAYLOAD_RELATIVE_PATH, 'plugin.json'), expectedType: 'file' },
  { relativePath: path.join(VIBE_PAYLOAD_RELATIVE_PATH, 'ai.mistral.vibe'), expectedType: 'directory' },
  { relativePath: path.join(VIBE_PAYLOAD_RELATIVE_PATH, 'skills'), expectedType: 'directory' },
]);
const BUILD_COMMAND_HINT = 'node scripts/build-vibe.js (or: npm run build:vibe)';

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

function defaultValidateVibeHome(input = {}) {
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

  const missingPaths = REQUIRED_PAYLOAD_ARTEFACTS
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
        'vibe-plugin-not-built',
        'Vibe install requires the generated plugin payload under '
          + `${VIBE_PAYLOAD_RELATIVE_PATH}/, but the following artefact(s) were `
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

function isSkillPath(sourceRelativePath) {
  const normalizedPath = normalizeRelativePath(sourceRelativePath);
  return normalizedPath === 'skills' || normalizedPath.startsWith('skills/');
}

module.exports = createInstallTargetAdapter({
  id: 'vibe-home',
  target: 'vibe',
  kind: 'home',
  rootSegments: ['.vibe', 'plugins', 'ecc'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: VIBE_PAYLOAD_RELATIVE_PATH,
  excludedSourcePaths: HOME_INSTALL_EXCLUDED_SOURCE_PATHS,
  validate: defaultValidateVibeHome,
  planOperations(input, adapter) {
    const modules = Array.isArray(input.modules)
      ? input.modules
      : (input.module ? [input.module] : []);

    return modules.flatMap(module => {
      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths
        .filter(p => !isForeignPlatformPath(p, adapter.target) && !adapter.excludesSourcePath(p))
        .flatMap(sourceRelativePath => {
          // Only the generated payload and canonical skills install into the
          // Vibe plugin; agents, commands, rules, and hooks arrive pre-built
          // inside vibe/core, so their raw source paths are ignored here.
          if (
            module.id !== 'vibe-core'
            && !isSkillPath(sourceRelativePath)
          ) {
            return [];
          }
          return [adapter.createScaffoldOperation(module.id, sourceRelativePath, input)];
        });
    });
  },
});
