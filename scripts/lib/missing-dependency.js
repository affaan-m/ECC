'use strict';

// Production dependencies declared in package.json's "dependencies" field.
// `npm install` never runs when ECC is installed via the Claude Code plugin
// marketplace (a plain git clone), so these can be missing at runtime even
// though the code that needs them is fine.
const RUNTIME_DEPENDENCY_VERSIONS = {
  ajv: '8.20.0',
  'sql.js': '1.14.2',
  'js-yaml': '4.3.1',
  '@iarna/toml': '2.2.5',
};

function describeMissingDependencyError(error) {
  if (!error || error.code !== 'MODULE_NOT_FOUND') {
    return null;
  }

  const match = /Cannot find module '([^']+)'/.exec(error.message || '');
  const moduleName = match && match[1];
  const pinnedVersion = moduleName && RUNTIME_DEPENDENCY_VERSIONS[moduleName];

  if (!pinnedVersion) {
    return null;
  }

  return (
    `Missing dependency '${moduleName}'. ECC's production dependencies aren't installed ` +
    '(this happens when ECC was installed via the Claude Code plugin marketplace, which ' +
    'clones the repo but never runs npm install). Run "npm install" from the ECC repo ' +
    `root, or install just this package with "npm install --no-save ${moduleName}@${pinnedVersion}".`
  );
}

module.exports = {
  RUNTIME_DEPENDENCY_VERSIONS,
  describeMissingDependencyError,
};
