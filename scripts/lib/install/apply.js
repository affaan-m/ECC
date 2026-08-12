'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  hasExplicitCommitAttributionPreference,
  withCommitAttributionDisabled,
} = require('../claude-commit-attribution');
const { writeInstallState } = require('../install-state');
const { filterMcpConfig, parseDisabledMcpServers } = require('../mcp-config');
const { assertWithinTrustedRoot } = require('../path-safety');
const {
  assertSafeClaudeSkillOperation,
  prepareClaudeSkillMigration,
  removeLegacyClaudeSkillFiles,
} = require('./claude-skill-migration');
const { cleanupLegacyAntigravityInstall } = require('./antigravity-legacy-migration');
const { buildInstallIndex, rewriteRelativeLinks } = require('./link-rewrite');
const { adaptAntigravityAgent } = require('./antigravity-agent');

function isMarkdownPath(filePath) {
  return /\.(md|mdx|markdown)$/i.test(String(filePath || ''));
}

function transformInstallContent(operation, content) {
  if (!operation.contentTransform) {
    return content;
  }
  if (operation.contentTransform === 'antigravity-agent-frontmatter') {
    return adaptAntigravityAgent(content, operation.sourceRelativePath);
  }
  throw new Error(`Unknown install content transform: ${operation.contentTransform}`);
}

// Map every copy-file operation to { sourceRel, destRel } so relative links in
// namespaced markdown can be rewritten to the file's actual installed location
// (issue #2340). Returns null when the plan lacks the data needed to do so.
function buildLinkIndexForPlan(plan) {
  if (!plan || !plan.targetRoot || !Array.isArray(plan.operations)) {
    return null;
  }
  const mappings = [];
  for (const operation of plan.operations) {
    if (operation.kind === 'copy-file' && operation.sourceRelativePath) {
      mappings.push({
        sourceRel: operation.sourceRelativePath,
        destRel: path.relative(plan.targetRoot, operation.destinationPath),
      });
    }
  }
  return buildInstallIndex(mappings);
}

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

function stateWithContentDigests(state) {
  return {
    ...state,
    operations: (state.operations || []).map(operation => {
      if (
        !operation.destinationPath
        || !fs.existsSync(operation.destinationPath)
        || !fs.statSync(operation.destinationPath).isFile()
      ) {
        return { ...operation };
      }
      return {
        ...operation,
        contentSha256: crypto.createHash('sha256')
          .update(fs.readFileSync(operation.destinationPath))
          .digest('hex'),
      };
    }),
  };
}

function cloneJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeJson(baseValue, patchValue) {
  if (!isPlainObject(baseValue) || !isPlainObject(patchValue)) {
    return cloneJsonValue(patchValue);
  }

  const merged = { ...baseValue };
  for (const [key, value] of Object.entries(patchValue)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMergeJson(merged[key], value);
    } else {
      merged[key] = cloneJsonValue(value);
    }
  }
  return merged;
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function shouldSetClaudeCommitAttributionPreference(plan) {
  if (!plan?.adapter || !['claude', 'claude-project'].includes(plan.adapter.target)) {
    return false;
  }

  return plan.operations.some(operation => {
    if (typeof operation?.destinationPath !== 'string') {
      return false;
    }
    const relativePath = path.relative(plan.targetRoot, operation.destinationPath);
    return relativePath && !relativePath.startsWith(`docs${path.sep}`) && relativePath !== 'docs';
  });
}

function writeClaudeCommitAttributionPreference(settingsPath) {
  // Read once rather than probing with existsSync first. Checking for the file and
  // then writing it is a file system race (CodeQL js/file-system-race), and a
  // missing file is simply the fresh-install case.
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      // Unreadable or malformed settings belong to the user; leave them untouched.
      return false;
    }
    settings = {};
  }

  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return false;
  }

  if (hasExplicitCommitAttributionPreference(settings)) {
    return false;
  }

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(
    settingsPath,
    formatJson(withCommitAttributionDisabled(settings)),
    'utf8'
  );
  return true;
}

function replacePluginRootPlaceholders(value, pluginRoot) {
  if (!pluginRoot) {
    return value;
  }

  if (typeof value === 'string') {
    return value.split('${CLAUDE_PLUGIN_ROOT}').join(pluginRoot);
  }

  if (Array.isArray(value)) {
    return value.map(item => replacePluginRootPlaceholders(item, pluginRoot));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        replacePluginRootPlaceholders(nestedValue, pluginRoot),
      ])
    );
  }

  return value;
}

function findHooksOperation(plan, hooksDestinationPath) {
  return plan.operations.find(item => (
    item.destinationPath === hooksDestinationPath
    && item.moduleId === 'hooks-runtime'
    && typeof item.sourcePath === 'string'
  ));
}

function isMcpConfigPath(filePath) {
  const basename = path.basename(String(filePath || ''));
  return basename === '.mcp.json' || basename === 'mcp.json';
}

function assertSafeInstallOperation(plan, operation) {
  if (!operation || typeof operation.destinationPath !== 'string') {
    throw new Error('Refusing to apply install operation: missing destination path.');
  }

  const targetRoot = plan && plan.targetRoot;
  assertWithinTrustedRoot(operation.destinationPath, targetRoot, 'install ECC file');

  const resolvedRoot = path.resolve(targetRoot);
  const resolvedTarget = path.resolve(operation.destinationPath);
  const relativePath = path.relative(resolvedRoot, resolvedTarget);
  const segments = relativePath ? relativePath.split(path.sep) : [];
  for (const segmentIndex of Array.from({ length: segments.length + 1 }, (_value, index) => index)) {
    const currentPath = segmentIndex === 0
      ? resolvedRoot
      : path.join(resolvedRoot, ...segments.slice(0, segmentIndex));
    try {
      const stats = fs.lstatSync(currentPath);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `Refusing to install ECC file through symlinked path: '${currentPath}'.`
        );
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        break;
      }
      throw error;
    }
  }
}

function buildResolvedClaudeHooks(plan) {
  if (!plan.adapter || (plan.adapter.target !== 'claude' && plan.adapter.target !== 'claude-project')) {
    return null;
  }

  const pluginRoot = plan.targetRoot;
  const hooksDestinationPath = path.join(plan.targetRoot, 'hooks', 'hooks.json');
  const hooksOperation = findHooksOperation(plan, hooksDestinationPath);
  if (!hooksOperation) {
    return null;
  }
  const hooksSourcePath = hooksOperation.sourcePath;
  if (!fs.existsSync(hooksSourcePath)) {
    return null;
  }

  const hooksConfig = readJsonObject(hooksSourcePath, 'hooks config');
  const resolvedHooks = replacePluginRootPlaceholders(hooksConfig.hooks, pluginRoot);
  if (!resolvedHooks || typeof resolvedHooks !== 'object' || Array.isArray(resolvedHooks)) {
    throw new Error(`Invalid hooks config at ${hooksSourcePath}: expected "hooks" to be a JSON object`);
  }

  return {
    hooksOperation,
    hooksDestinationPath,
    resolvedHooksConfig: {
      ...hooksConfig,
      hooks: resolvedHooks,
    },
  };
}

function previewInstallPlan(plan) {
  const migration = prepareClaudeSkillMigration(plan);
  return {
    ...plan,
    statePreview: migration.finalState,
    plannedOperations: [...plan.operations],
    operations: migration.appliedOperations,
    skippedOperations: migration.skippedOperations,
    warnings: [
      ...(Array.isArray(plan.warnings) ? plan.warnings : []),
      ...migration.warnings,
    ],
    applied: false,
  };
}

function applyInstallPlan(plan, dependencies = {}) {
  const persistInstallState = dependencies.writeInstallState || writeInstallState;
  const beforeOperationWrite = dependencies.beforeOperationWrite;
  const beforeInstallStateWrite = dependencies.beforeInstallStateWrite;
  const migration = prepareClaudeSkillMigration(plan);
  const appliedPlan = {
    ...plan,
    operations: migration.appliedOperations,
  };
  const resolvedClaudeHooksPlan = buildResolvedClaudeHooks(appliedPlan);
  const disabledServers = parseDisabledMcpServers(process.env.ECC_DISABLED_MCPS);
  const linkIndex = buildLinkIndexForPlan(appliedPlan);
  const hasLegacyMigration = migration.legacyOperationsToRemove.length > 0;

  if (migration.requiresBridgeState) {
    // Own every operation that may be written during a flat-skill migration
    // before the first copy. A later failure is retryable and uninstall can
    // clean the entire partial install, including non-skill files. During
    // legacy migration the bridge also retains the prior managed operations.
    if (typeof beforeInstallStateWrite === 'function') {
      beforeInstallStateWrite({ plan: appliedPlan, state: migration.bridgeState });
    }
    persistInstallState(plan.installStatePath, migration.bridgeState);
  }

  for (const operation of appliedPlan.operations) {
    assertSafeInstallOperation(appliedPlan, operation);
    assertSafeClaudeSkillOperation(appliedPlan, operation);
    fs.mkdirSync(path.dirname(operation.destinationPath), { recursive: true });
    // Recheck directories that were absent during the first validation. This
    // narrows the symlink-swap window around mkdirSync, but path checks cannot
    // eliminate a later TOCTOU race before the file write.
    assertSafeInstallOperation(appliedPlan, operation);
    assertSafeClaudeSkillOperation(appliedPlan, operation);
    if (typeof beforeOperationWrite === 'function') {
      beforeOperationWrite({ plan: appliedPlan, operation });
    }

    if (operation.kind === 'merge-json') {
      const payload = cloneJsonValue(operation.mergePayload);
      if (payload === undefined) {
        throw new Error(`Missing merge payload for ${operation.destinationPath}`);
      }

      const filteredPayload = (
        isMcpConfigPath(operation.destinationPath) && disabledServers.length > 0
      )
        ? filterMcpConfig(payload, disabledServers).config
        : payload;

      const currentValue = fs.existsSync(operation.destinationPath)
        ? readJsonObject(operation.destinationPath, 'existing JSON config')
        : {};
      const mergedValue = deepMergeJson(currentValue, filteredPayload);
      fs.writeFileSync(operation.destinationPath, formatJson(mergedValue), 'utf8');
      continue;
    }

    if (operation.kind === 'copy-file' && isMcpConfigPath(operation.destinationPath) && disabledServers.length > 0) {
      const sourceConfig = readJsonObject(operation.sourcePath, 'MCP config');
      const filteredConfig = filterMcpConfig(sourceConfig, disabledServers).config;
      fs.writeFileSync(operation.destinationPath, formatJson(filteredConfig), 'utf8');
      continue;
    }

    // Markdown may reference files whose installed paths move, such as rules
    // copied under rules/ecc. Rewrite only links that point at installed targets;
    // untouched links and non-markdown files stay on the byte-for-byte path.
    if (
      linkIndex
      && operation.kind === 'copy-file'
      && operation.sourceRelativePath
      && isMarkdownPath(operation.destinationPath)
    ) {
      const rewritten = rewriteRelativeLinks(
        transformInstallContent(operation, fs.readFileSync(operation.sourcePath, 'utf8')),
        { sourceRel: operation.sourceRelativePath, index: linkIndex }
      );
      fs.writeFileSync(operation.destinationPath, rewritten, 'utf8');
      continue;
    }

    fs.copyFileSync(operation.sourcePath, operation.destinationPath);
  }

  if (resolvedClaudeHooksPlan) {
    assertSafeInstallOperation(appliedPlan, resolvedClaudeHooksPlan.hooksOperation);
    fs.mkdirSync(path.dirname(resolvedClaudeHooksPlan.hooksDestinationPath), { recursive: true });
    assertSafeInstallOperation(appliedPlan, resolvedClaudeHooksPlan.hooksOperation);
    if (typeof beforeOperationWrite === 'function') {
      beforeOperationWrite({ plan: appliedPlan, operation: resolvedClaudeHooksPlan.hooksOperation });
    }
    fs.writeFileSync(
      resolvedClaudeHooksPlan.hooksDestinationPath,
      JSON.stringify(resolvedClaudeHooksPlan.resolvedHooksConfig, null, 2) + '\n',
      'utf8'
    );
  }

  if (hasLegacyMigration) {
    removeLegacyClaudeSkillFiles(migration, plan.targetRoot);
  }

  if (shouldSetClaudeCommitAttributionPreference(appliedPlan)) {
    writeClaudeCommitAttributionPreference(path.join(plan.targetRoot, 'settings.json'));
  }

  const finalState = stateWithContentDigests(migration.finalState);
  if (typeof beforeInstallStateWrite === 'function') {
    beforeInstallStateWrite({ plan: appliedPlan, state: finalState });
  }
  persistInstallState(plan.installStatePath, finalState);
  const antigravityMigration = cleanupLegacyAntigravityInstall(appliedPlan);
  const antigravityMigrationWarnings = antigravityMigration.detected && !antigravityMigration.complete
    ? [
        'Legacy Antigravity migration is incomplete. ECC preserved modified or unmanaged content under .agent; review and move anything you want to keep, then rerun the Antigravity install.',
      ]
    : [];

  return {
    ...plan,
    statePreview: finalState,
    plannedOperations: [...plan.operations],
    operations: migration.appliedOperations,
    skippedOperations: migration.skippedOperations,
    warnings: [
      ...(Array.isArray(plan.warnings) ? plan.warnings : []),
      ...migration.warnings,
      ...antigravityMigrationWarnings,
    ],
    applied: true,
  };
}

module.exports = {
  applyInstallPlan,
  assertSafeInstallOperation,
  previewInstallPlan,
};
