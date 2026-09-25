'use strict';

const fs = require('fs');
const path = require('path');

const {
  HOME_INSTALL_EXCLUDED_SOURCE_PATHS,
  createFlatRuleOperations,
  createInstallTargetAdapter,
  createManagedOperation,
  createManagedScaffoldOperation,
  isForeignPlatformPath,
  normalizeRelativePath,
} = require('./helpers');
const { buildAntigravityHooksConfig } = require('../antigravity-hooks');
const { buildAntigravityMcpConfig, planAntigravityMemoryRuntime } = require('../antigravity-mcp');
const { buildAntigravityPluginManifest } = require('../antigravity-plugin');

function readJsonObject(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse ${label} at ${filePath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid ${label} at ${filePath}: expected a JSON object`);
  }

  return parsed;
}

module.exports = createInstallTargetAdapter({
  id: 'antigravity-home',
  target: 'antigravity-home',
  kind: 'home',
  rootSegments: ['.gemini', 'config', 'plugins', 'ecc'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.gemini',
  excludedSourcePaths: HOME_INSTALL_EXCLUDED_SOURCE_PATHS,
  resolveTrustedRoots(input, targetRoot) {
    const workflowsRoot = path.join(
      path.dirname(path.dirname(targetRoot)),
      'workflows'
    );
    return [targetRoot, workflowsRoot];
  },
  planOperations(input, adapter) {
    const modules = Array.isArray(input.modules)
      ? input.modules
      : (input.module ? [input.module] : []);
    const {
      repoRoot,
      projectRoot,
      homeDir,
    } = input;
    const planningInput = {
      repoRoot,
      projectRoot,
      homeDir,
    };
    const targetRoot = adapter.resolveRoot(planningInput);

    return modules.flatMap(module => {
      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths
        .filter(p => !isForeignPlatformPath(p, 'antigravity') && !adapter.excludesSourcePath(p))
        .flatMap(sourceRelativePath => {
          const normalizedSourcePath = normalizeRelativePath(sourceRelativePath);

          if (
            normalizedSourcePath === 'rules'
            || normalizedSourcePath.startsWith('rules/')
          ) {
            return createFlatRuleOperations({
              moduleId: module.id,
              repoRoot,
              sourceRelativePath: normalizedSourcePath,
              destinationDir: path.join(targetRoot, 'rules'),
            });
          }

          if (
            normalizedSourcePath === 'commands'
            || normalizedSourcePath.startsWith('commands/')
          ) {
            const commandRelativePath = normalizedSourcePath === 'commands'
              ? ''
              : normalizedSourcePath.slice('commands/'.length);
            const workflowsRoot = path.join(
              path.dirname(path.dirname(targetRoot)),
              'workflows'
            );
            return [
              createManagedScaffoldOperation(
                module.id,
                normalizedSourcePath,
                path.join(workflowsRoot, commandRelativePath),
                'preserve-relative-path'
              ),
            ];
          }

          if (
            normalizedSourcePath === 'agents'
            || normalizedSourcePath.startsWith('agents/')
          ) {
            const agentRelativePath = normalizedSourcePath === 'agents'
              ? ''
              : normalizedSourcePath.slice('agents/'.length);
            return [
              createManagedOperation({
                moduleId: module.id,
                sourceRelativePath: normalizedSourcePath,
                destinationPath: path.join(targetRoot, 'agents', agentRelativePath),
                strategy: 'preserve-relative-path',
                contentTransform: 'antigravity-agent-frontmatter',
              }),
            ];
          }

          if (
            normalizedSourcePath === 'skills'
            || normalizedSourcePath.startsWith('skills/')
          ) {
            const skillRelativePath = normalizedSourcePath === 'skills'
              ? ''
              : normalizedSourcePath.slice('skills/'.length);
            return [
              createManagedScaffoldOperation(
                module.id,
                normalizedSourcePath,
                path.join(targetRoot, 'skills', skillRelativePath),
                'preserve-relative-path'
              ),
            ];
          }

          if (
            module.id === 'hooks-runtime'
            && normalizedSourcePath === 'hooks'
          ) {
            return [
              createManagedScaffoldOperation(module.id, 'package.json', path.join(targetRoot, 'package.json'), 'preserve-relative-path'),
              createManagedOperation({
                kind: 'merge-json',
                moduleId: module.id,
                sourceRelativePath: 'hooks/hooks.json',
                destinationPath: path.join(targetRoot, 'hooks.json'),
                strategy: 'merge-json',
                ownership: 'managed',
                scaffoldOnly: false,
                mergePayload: buildAntigravityHooksConfig({
                  profile: input.hookProfile || 'standard',
                  bridgeScript: path.join(targetRoot, 'scripts', 'hooks', 'antigravity-hook-bridge.js'),
                }),
              }),
            ];
          }

          if (
            module.id === 'platform-configs'
            && (normalizedSourcePath === 'mcp-configs' || normalizedSourcePath === '.mcp.json')
          ) {
            const baseMcp = (repoRoot && fs.existsSync(path.join(repoRoot, '.mcp.json')))
              ? readJsonObject(path.join(repoRoot, '.mcp.json'), '.mcp.json')
              : { mcpServers: {} };
            const antigravityMcp = buildAntigravityMcpConfig({
              memoryScript: path.join(targetRoot, 'scripts', 'memory-mcp.mjs'),
            });
            const mergedMcp = {
              mcpServers: {
                ...(baseMcp.mcpServers || {}),
                ...(antigravityMcp.mcpServers || {}),
              },
            };

            const operations = [
              createManagedOperation({
                kind: 'merge-json',
                moduleId: module.id,
                sourceRelativePath: '.mcp.json',
                destinationPath: path.join(targetRoot, 'mcp_config.json'),
                strategy: 'merge-json',
                ownership: 'managed',
                scaffoldOnly: false,
                mergePayload: mergedMcp,
              }),
              createManagedOperation({
                kind: 'merge-json',
                moduleId: module.id,
                sourceRelativePath: 'plugin.json',
                destinationPath: path.join(targetRoot, 'plugin.json'),
                strategy: 'merge-json',
                ownership: 'managed',
                scaffoldOnly: false,
                mergePayload: buildAntigravityPluginManifest(),
              }),
            ];

            if (repoRoot && fs.existsSync(path.join(repoRoot, 'scripts', 'memory-mcp.mjs'))) {
              operations.push(...planAntigravityMemoryRuntime(module.id, repoRoot, targetRoot));
            }

            return operations;
          }

          if (normalizedSourcePath === 'scripts/hooks' || normalizedSourcePath === 'scripts/lib') {
            return [adapter.createScaffoldOperation(module.id, normalizedSourcePath, planningInput)];
          }

          return [];
        });
    });
  },
});
