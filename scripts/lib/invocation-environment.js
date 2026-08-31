'use strict';

function resolveInvocationEnvironment(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'env')) {
    return { ...(options.env || {}) };
  }

  if (typeof options.homeDir === 'string' && options.homeDir.trim() !== '') {
    return {};
  }

  return { ...process.env };
}

module.exports = {
  resolveInvocationEnvironment,
};
