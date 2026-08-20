'use strict';

const path = require('path');

const root = path.join(__dirname, '..', '..');

function isMissing(error) {
  return Boolean(error && error.code === 'MODULE_NOT_FOUND');
}

function pkg(error, fallback) {
  const match = String(error?.message || '').match(/Cannot find module '([^']+)'/);
  return match ? match[1] : fallback;
}

function format(name) {
  return [
    `Missing runtime dependency '${name}'.`,
    'ECC plugin/marketplace installs are git clones without node_modules.',
    'From the ECC repository root, run: npm install',
    `ECC root: ${root}`,
  ].join('\n');
}

function missing(name) {
  const err = new Error(format(name));
  err.code = 'ECC_RUNTIME_DEPENDENCY_MISSING';
  err.packageName = name;
  return err;
}

function requireRuntime(name) {
  try {
    return require(name);
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
    throw missing(pkg(error, name));
  }
}

module.exports = {
  format,
  isMissing,
  missing,
  requireRuntime,
};
