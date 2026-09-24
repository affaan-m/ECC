'use strict';

const os = require('os');
const path = require('path');
const { resolveInvocationEnvironment } = require('./invocation-environment');

function configuredDirectory(environment, name) {
  const value = environment && environment[name];
  return typeof value === 'string' && value.trim() !== ''
    ? path.resolve(value.trim())
    : null;
}

function resolveOpencodeConfigRoot(options = {}) {
  const environment = resolveInvocationEnvironment(options);
  const explicitRoot = configuredDirectory(environment, 'OPENCODE_CONFIG_DIR');
  if (explicitRoot) {
    return explicitRoot;
  }

  const xdgConfigRoot = configuredDirectory(environment, 'XDG_CONFIG_HOME');
  if (xdgConfigRoot) {
    return path.join(xdgConfigRoot, 'opencode');
  }

  return path.join(path.resolve(options.homeDir || os.homedir()), '.config', 'opencode');
}

module.exports = {
  resolveOpencodeConfigRoot,
};
