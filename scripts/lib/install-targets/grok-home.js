'use strict';

const fs = require('fs');
const path = require('path');
const { preparePinnedGrokSource } = require('../grok-source-identity');

const {
  createInstallTargetAdapter,
  isForeignPlatformPath,
  normalizeRelativePath,
} = require('./helpers');

function isMcpPath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  return normalized === '.mcp.json'
    || normalized.startsWith('.mcp.json/')
    || normalized === 'mcp-configs'
    || normalized.startsWith('mcp-configs/');
}

function isHooksPath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  return normalized === 'hooks' || normalized.startsWith('hooks/');
}

function readMcpConfig(repoRoot) {
  const configPath = path.join(repoRoot, '.mcp.json');
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { mcpServers: {} };
    throw new Error(`Failed to parse Grok MCP config at ${configPath}: ${error.message}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || !config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
    throw new Error(`Invalid Grok MCP config at ${configPath}: expected an mcpServers object`);
  }
  return config;
}

module.exports = createInstallTargetAdapter({
  id: 'grok-home',
  target: 'grok',
  kind: 'home',
  acceptsUndeclaredModuleTargets: true,
  rootSegments: ['.grok'],
  installStatePathSegments: ['ecc', 'install-state.json'],
  nativeRootRelativePath: '.grok',
  prepareSource(input = {}) {
    return preparePinnedGrokSource({
      sourceRoot: input.sourceRoot || input.repoRoot,
      homeDir: input.homeDir,
      sourceUrl: input.sourceUrl,
      sourceSha: input.sourceSha,
    });
  },
  planOperations(input = {}, adapter) {
    const trust = input.trust === true;
    const consent = input.consent && typeof input.consent === 'object' ? input.consent : {};
    const allowHooks = trust && consent.hooks === true;
    const requestedMcpIds = Object.entries(consent.mcp || {})
      .filter(([, allowed]) => allowed === true)
      .map(([id]) => id);
    const mcpConfig = readMcpConfig(input.repoRoot);
    const unknownMcpIds = requestedMcpIds.filter((id) => !Object.hasOwn(mcpConfig.mcpServers, id));
    if (unknownMcpIds.length > 0) {
      throw new Error(`Unknown Grok MCP capability: ${unknownMcpIds.join(', ')}`);
    }
    const allowedMcpIds = trust ? requestedMcpIds : [];
    const modules = Array.isArray(input.modules) ? input.modules : [];

    const operations = modules.flatMap((module) => {
      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths
        .filter((sourceRelativePath) => !isForeignPlatformPath(sourceRelativePath, 'grok'))
        // Root MCP files are emitted only by the adapter's per-server consent operation.
        .filter((sourceRelativePath) => !isMcpPath(sourceRelativePath))
        .filter((sourceRelativePath) => allowHooks || !isHooksPath(sourceRelativePath))
        .map((sourceRelativePath) => {
          const operation = adapter.createScaffoldOperation(module.id, sourceRelativePath, input);
          return {
            ...operation,
            destinationPath: path.join(adapter.resolveRoot(input), 'plugins', 'ecc', sourceRelativePath),
            ...(normalizeRelativePath(sourceRelativePath) === 'hooks/hooks.json'
              ? { contentTransform: 'grok-hook-boundary' }
              : {}),
          };
        });
    });
    const hooksEnabled = allowHooks && operations.some((operation) => isHooksPath(operation.sourceRelativePath));
    const pluginRoot = path.join(adapter.resolveRoot(input), 'plugins', 'ecc');
    const hooksManifestPath = path.join(pluginRoot, 'hooks', 'hooks.json');
    if (hooksEnabled && !operations.some((operation) => operation.destinationPath === hooksManifestPath)) {
      operations.push({
        ...adapter.createScaffoldOperation('hooks-runtime', 'hooks/hooks.json', input),
        destinationPath: hooksManifestPath,
        contentTransform: 'grok-hook-boundary',
      });
    }
    operations.push({
      ...adapter.createScaffoldOperation('grok-source-identity', '.ecc-source.json', input),
      destinationPath: path.join(pluginRoot, '.ecc-source.json'),
    });
    if (allowedMcpIds.length > 0) {
      operations.push({
        ...adapter.createScaffoldOperation('grok-mcp', '.mcp.json', input),
        destinationPath: path.join(pluginRoot, '.mcp.json'),
        contentTransform: 'grok-mcp-consent',
        grokMcpIds: allowedMcpIds,
      });
    }
    const manifestOperation = adapter.createScaffoldOperation(
      'grok-manifest',
      '.grok-plugin/plugin.json',
      input
    );
    operations.push({
      ...manifestOperation,
      destinationPath: path.join(pluginRoot, '.grok-plugin', 'plugin.json'),
      contentTransform: 'grok-plugin-consent',
      grokHooksEnabled: hooksEnabled,
      grokMcpEnabled: allowedMcpIds.length > 0,
    });
    return operations;
  },
});
