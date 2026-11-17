'use strict';

const path = require('path');
const { assertWithinTrustedRoot } = require('../path-safety');

// npm may hoist a dependency beside the ECC package instead of nesting it, so
// a path relative to the repository would need `..`. Dependency sources are
// recorded as `node_modules/<name>[/node_modules/<name>...]/<file>` instead,
// mirroring the installed layout, and Node resolves each package from the
// repository when the source is read.
const PACKAGE_DIR = 'node_modules';
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

function isPackageSourcePath(sourceRelativePath) {
  return typeof sourceRelativePath === 'string'
    && sourceRelativePath.split(/[/\\]+/)[0] === PACKAGE_DIR;
}

function formatPackageSourcePath(packageChain, relativeFile = '') {
  const segments = packageChain.flatMap(name => [PACKAGE_DIR, ...name.split('/')]);
  return path.posix.join(...segments, ...relativeFile.split(/[/\\]+/).filter(Boolean));
}

function parsePackageSourcePath(sourceRelativePath) {
  const parts = String(sourceRelativePath).split(/[/\\]+/);
  const packageChain = [];
  let index = 0;
  while (parts[index] === PACKAGE_DIR) {
    const scoped = String(parts[index + 1] || '').startsWith('@');
    const name = scoped ? `${parts[index + 1]}/${parts[index + 2] || ''}` : parts[index + 1];
    if (!PACKAGE_NAME.test(String(name || ''))) {
      throw new Error(`Invalid package source path: ${sourceRelativePath}`);
    }
    packageChain.push(name);
    index += scoped ? 3 : 2;
  }
  const relativeFile = parts.slice(index);
  if (packageChain.length === 0 || relativeFile.some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`Invalid package source path: ${sourceRelativePath}`);
  }
  return { packageChain, relativeFile };
}

// Returns null when a package in the chain cannot be resolved. Throws when the
// path itself is malformed.
function resolvePackageSourcePath(repoRoot, sourceRelativePath) {
  const { packageChain, relativeFile } = parsePackageSourcePath(sourceRelativePath);
  let packageRoot = repoRoot;
  for (const name of packageChain) {
    try {
      packageRoot = path.dirname(require.resolve(`${name}/package.json`, { paths: [packageRoot] }));
    } catch {
      return null;
    }
  }
  return assertWithinTrustedRoot(path.join(packageRoot, ...relativeFile), packageRoot, 'read package source');
}

module.exports = {
  formatPackageSourcePath,
  isPackageSourcePath,
  parsePackageSourcePath,
  resolvePackageSourcePath,
};
