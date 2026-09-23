'use strict';

/**
 * Antigravity Plugin Manifest Generator
 *
 * Generates valid Antigravity plugin.json declaring the ECC plugin.
 */

function buildAntigravityPluginManifest(options = {}) {
  const version = options.version || '2.2.2';
  return {
    name: 'ecc',
    description: 'ECC - The Agent Harness Operating System for Antigravity',
    version,
  };
}

module.exports = {
  buildAntigravityPluginManifest,
};
