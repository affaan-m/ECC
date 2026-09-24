'use strict';

/**
 * Antigravity Plugin Manifest Generator
 *
 * Generates valid Antigravity plugin.json declaring the ECC plugin.
 */

function buildAntigravityPluginManifest(options = {}) {
  const version = options.version || require('../../package.json').version;
  return {
    name: 'ecc',
    description: 'ECC - The Agent Harness Operating System for Antigravity',
    version,
  };
}

module.exports = {
  buildAntigravityPluginManifest,
};
