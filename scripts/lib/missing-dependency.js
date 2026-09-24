'use strict';

const fs = require('fs');
const path = require('path');

// Runtime dependencies that can be missing when ECC is installed via the
// Claude Code plugin marketplace (a plain git clone, so `npm install` never
// runs), even though the code that needs them is fine. Versions are read
// straight from package.json's "dependencies" field instead of a second
// hardcoded copy, so this can't silently drift out of sync with what's
// actually declared there.
const TRACKED_DEPENDENCIES = ['ajv', 'sql.js', 'js-yaml', '@iarna/toml'];

function loadRuntimeDependencyVersions() {
  try {
    const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
    const declared = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).dependencies || {};

    const versions = {};
    for (const name of TRACKED_DEPENDENCIES) {
      const declaredVersion = declared[name];
      if (declaredVersion) {
        versions[name] = declaredVersion.replace(/^[\^~]/, '');
      }
    }
    return versions;
  } catch {
    // package.json isn't reachable from here for some reason. Fall back to
    // an empty map rather than crash — describeMissingDependencyError()
    // just won't be able to suggest a pinned version in that case.
    return {};
  }
}

const RUNTIME_DEPENDENCY_VERSIONS = loadRuntimeDependencyVersions();

function describeMissingDependencyError(error) {
  if (!error || error.code !== 'MODULE_NOT_FOUND') {
    return null;
  }

  const match = /Cannot find module '([^']+)'/.exec(error.message || '');
  const moduleName = match && match[1];

  if (!moduleName || !TRACKED_DEPENDENCIES.includes(moduleName)) {
    return null;
  }

  const pinnedVersion = RUNTIME_DEPENDENCY_VERSIONS[moduleName];
  const installCommand = pinnedVersion
    ? `npm install --no-save ${moduleName}@${pinnedVersion}`
    : `npm install --no-save ${moduleName}`;

  return (
    `Missing dependency '${moduleName}'. ECC's production dependencies aren't installed ` +
    '(this happens when ECC was installed via the Claude Code plugin marketplace, which ' +
    'clones the repo but never runs npm install). Run "npm install" from the ECC repo ' +
    `root, or install just this package with "${installCommand}".`
  );
}

module.exports = {
  RUNTIME_DEPENDENCY_VERSIONS,
  describeMissingDependencyError,
};
