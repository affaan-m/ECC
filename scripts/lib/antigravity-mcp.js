'use strict';

const fs = require('fs');
const path = require('path');
const { createManagedScaffoldOperation } = require('./install-targets/helpers');

/**
 * Antigravity MCP Configuration Generator
 *
 * Generates valid Antigravity mcp_config.json containing the ECC Memory Vault
 * stdio server so that Antigravity agents have native access to .ecc/memory/.
 */

function buildAntigravityMcpConfig(options = {}) {
  const { memoryScript } = options;
  if (typeof memoryScript !== 'string' || !path.isAbsolute(memoryScript) || memoryScript.includes('\0')) {
    throw new Error('memoryScript must be an absolute path');
  }

  return {
    mcpServers: {
      'ecc-memory': {
        command: 'node',
        args: [memoryScript],
        env: {
          ECC_MEMORY_HARNESS: 'antigravity',
        },
      },
    },
  };
}

function planAntigravityMemoryRuntime(moduleId, repoRoot, targetRoot) {
  const sourcePaths = [
    'package.json',
    'scripts/memory-mcp.mjs',
    'scripts/lib/missing-dependency.js',
    'scripts/lib/memory-vault.js',
    'scripts/lib/memory-vault-format.js',
    'scripts/lib/path-safety.js',
  ];
  const operations = sourcePaths.map(sourcePath => createManagedScaffoldOperation(
    moduleId, sourcePath, path.join(targetRoot, sourcePath), 'preserve-relative-path'
  ));
  function addDependency(name, fromRoot, destinationRoot, ancestors = []) {
    let manifestPath;
    try {
      manifestPath = require.resolve(`${name}/package.json`, { paths: [fromRoot] });
    } catch (error) {
      throw new Error(`Cannot install Antigravity memory dependency ${name}. Run npm install in ${repoRoot}: ${error.message}`);
    }
    if (ancestors.includes(manifestPath)) return;
    const packageRoot = path.dirname(manifestPath);
    const destinationPath = path.join(destinationRoot, 'node_modules', name);
    operations.push(createManagedScaffoldOperation(
      moduleId, path.relative(repoRoot, packageRoot), destinationPath, 'preserve-relative-path'
    ));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const dependency of Object.keys(manifest.dependencies || {})) {
      addDependency(dependency, packageRoot, destinationPath, [...ancestors, manifestPath]);
    }
  }
  addDependency('ajv', repoRoot, targetRoot);
  return operations;
}

module.exports = {
  buildAntigravityMcpConfig,
  planAntigravityMemoryRuntime,
};
