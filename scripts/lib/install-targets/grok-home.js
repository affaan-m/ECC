'use strict';

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

module.exports = createInstallTargetAdapter({
  id: 'grok-home',
  target: 'grok',
  kind: 'home',
  rootSegments: ['.grok'],
  installStatePathSegments: ['ecc', 'install-state.json'],
  nativeRootRelativePath: '.grok',
  planOperations(input = {}, adapter) {
    const trust = input.trust === true;
    const consent = input.consent && typeof input.consent === 'object' ? input.consent : {};
    const allowHooks = trust && consent.hooks === true;
    const modules = Array.isArray(input.modules) ? input.modules : [];

    return modules.flatMap((module) => {
      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths
        .filter((sourceRelativePath) => !isForeignPlatformPath(sourceRelativePath, 'grok'))
        // Root .mcp.json attach is owned by applyInstall's per-server filter.
        .filter((sourceRelativePath) => !isMcpPath(sourceRelativePath))
        .filter((sourceRelativePath) => allowHooks || !isHooksPath(sourceRelativePath))
        .map((sourceRelativePath) => adapter.createScaffoldOperation(
          module.id,
          sourceRelativePath,
          input
        ));
    });
  },
});
