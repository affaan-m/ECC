'use strict';

const path = require('path');

const {
  ClaudeSetupError,
  CURRENT_PLUGIN_ID,
  OFFICIAL_MARKETPLACE_URL,
  VALID_HOOK_MODES,
  VALID_SCOPES,
  assertNoConflictingEccPlugins,
  assertSafeLocalInventory,
  assertGitAvailable,
  currentEccPlugins,
  createDryRunClaudeRunner,
  deriveHookMode,
  ensureOfficialMarketplace,
  ensurePluginAtScope,
  hookOptions,
  isOfficialMarketplace,
  needsClaudeCommitAttributionPreferenceWrite,
  parseMarketplaceList,
  parsePluginList,
  readSettings,
  readStoredHookOptions,
  runClaude,
  writeClaudePluginOptions,
} = require('./claude-plugin-setup');
const { resolveClaudePaths } = require('./install/inventory');

function migrationError(code, message, details = {}) {
  return new ClaudeSetupError(code, message, details);
}

function recoveryCommands(sourceScope, destinationScope) {
  const commands = [];
  if (sourceScope) {
    commands.push(
      `claude plugin uninstall ${CURRENT_PLUGIN_ID} --scope ${sourceScope} --keep-data`
    );
  }
  commands.push(
    `ecc setup --mode claude-plugin --scope ${destinationScope} --move-scope --yes`
  );
  return commands;
}

function readPluginInventory(run, projectRoot, phase) {
  return parsePluginList(
    run(
      ['plugin', 'list', '--json'],
      { cwd: projectRoot, phase }
    ).stdout
  );
}

function assertMigrationInventory(plugins, destinationScope) {
  assertNoConflictingEccPlugins(plugins);
  const installed = currentEccPlugins(plugins);
  const observedScopes = installed.map(plugin => plugin.scope);
  const uniqueScopes = new Set(observedScopes);

  if (installed.length === 0) {
    throw migrationError(
      'PLUGIN_NOT_INSTALLED',
      `${CURRENT_PLUGIN_ID} is not installed, so there is no source scope to migrate.`,
      {
        observedScopes,
        recovery: [
          `ecc setup --mode claude-plugin --scope ${destinationScope} --yes`,
        ],
      }
    );
  }
  if (
    installed.length > 2
    || uniqueScopes.size !== installed.length
    || (
      installed.length === 2
      && !uniqueScopes.has(destinationScope)
    )
  ) {
    throw migrationError(
      'AMBIGUOUS_PLUGIN_SCOPES',
      `Cannot safely migrate ${CURRENT_PLUGIN_ID} from ambiguous scopes: ${observedScopes.join(', ')}.`,
      { observedScopes }
    );
  }

  if (installed.length === 1 && installed[0].scope === destinationScope) {
    if (installed[0].enabled !== true) {
      throw migrationError(
        'DESTINATION_VERIFICATION_FAILED',
        `${CURRENT_PLUGIN_ID} exists at ${destinationScope} scope but is not enabled.`,
        {
          phase: 'destination-verification',
          observedScopes,
          recovery: recoveryCommands(null, destinationScope),
        }
      );
    }
    return {
      destination: installed[0],
      mode: 'already-migrated',
      observedScopes,
      sourceScope: null,
    };
  }
  if (installed.length === 1) {
    return {
      destination: null,
      mode: 'migrate',
      observedScopes,
      sourceScope: installed[0].scope,
    };
  }

  return {
    destination: installed.find(plugin => plugin.scope === destinationScope),
    mode: 'resume',
    observedScopes,
    sourceScope: installed.find(plugin => plugin.scope !== destinationScope).scope,
  };
}

function validateExpectedScopes(plugins, expectedScopes, options = {}) {
  assertNoConflictingEccPlugins(plugins);
  const installed = currentEccPlugins(plugins);
  const observedScopes = installed.map(plugin => plugin.scope);
  const actual = [...observedScopes].sort();
  const expected = [...expectedScopes].sort();
  const destination = installed.find(plugin => plugin.scope === options.destinationScope);
  const matches = (
    actual.length === expected.length
    && actual.every((scope, index) => scope === expected[index])
    && destination?.enabled === true
  );
  if (!matches) {
    throw migrationError(
      options.code,
      options.message,
      {
        phase: options.phase,
        observedScopes,
        recovery: options.recovery || [],
      }
    );
  }
  return installed;
}

function plannedActions(migration, destinationScope, marketplaceAction, hookConfiguration) {
  const actions = [];
  if (migration.mode === 'migrate') {
    actions.push(marketplaceAction);
    actions.push([
      'plugin', 'install', CURRENT_PLUGIN_ID,
      '--scope', destinationScope,
      '--config', `hooks_enabled=${hookConfiguration.hooks_enabled}`,
      '--config', `hook_profile=${hookConfiguration.hook_profile}`,
    ]);
  }
  actions.push(['plugin', 'list', '--json']);
  actions.push(['plugin', 'list', '--json']);
  actions.push([
    'plugin', 'uninstall', CURRENT_PLUGIN_ID,
    '--scope', migration.sourceScope,
    '--keep-data',
  ]);
  actions.push(['plugin', 'list', '--json']);
  return actions;
}

function verifySourceAndDestination(run, paths, migration, destinationScope, phase) {
  const expectedScopes = [migration.sourceScope, destinationScope];
  return validateExpectedScopes(
    readPluginInventory(run, paths.projectRoot, phase),
    expectedScopes,
    {
      code: phase === 'concurrency-check'
        ? 'CONCURRENT_SCOPE_CHANGE'
        : 'DESTINATION_VERIFICATION_FAILED',
      destinationScope,
      message: phase === 'concurrency-check'
        ? 'Claude plugin scopes changed during migration; the source was not removed.'
        : `Could not verify ${CURRENT_PLUGIN_ID} at the destination before source cleanup.`,
      phase,
      recovery: recoveryCommands(null, destinationScope),
    }
  );
}

function uninstallSource(run, paths, migration, destinationScope) {
  const args = [
    'plugin', 'uninstall', CURRENT_PLUGIN_ID,
    '--scope', migration.sourceScope,
    '--keep-data',
  ];
  try {
    run(args, { cwd: paths.projectRoot, phase: 'source-uninstall' });
    return [];
  } catch {
    let observedScopes = [migration.sourceScope, destinationScope];
    try {
      const plugins = readPluginInventory(
        run,
        paths.projectRoot,
        'source-uninstall-verification'
      );
      assertNoConflictingEccPlugins(plugins);
      const installed = currentEccPlugins(plugins);
      observedScopes = installed.map(plugin => plugin.scope);
      if (
        installed.length === 1
        && installed[0].scope === destinationScope
        && installed[0].enabled === true
      ) {
        return ['Claude reported an uninstall error, but destination-only state was verified.'];
      }
    } catch {
      // Preserve the safest known two-scope state in the structured recovery.
    }
    throw migrationError(
      'SOURCE_UNINSTALL_FAILED',
      `The destination is installed, but Claude could not remove the ${migration.sourceScope} source scope.`,
      {
        phase: 'source-uninstall',
        observedScopes,
        recovery: recoveryCommands(migration.sourceScope, destinationScope),
      }
    );
  }
}

function verifyFinalState(run, paths, destinationScope) {
  const plugins = readPluginInventory(run, paths.projectRoot, 'final-verification');
  return validateExpectedScopes(plugins, [destinationScope], {
    code: 'FINAL_VERIFICATION_FAILED',
    destinationScope,
    message: `Could not verify destination-only ${CURRENT_PLUGIN_ID} state after source cleanup.`,
    phase: 'final-verification',
    recovery: recoveryCommands(null, destinationScope),
  });
}

function migrateClaudePluginScope(options = {}, dependencies = {}) {
  if (!VALID_SCOPES.has(options.scope)) {
    throw migrationError(
      'INVALID_SCOPE',
      'Scope migration requires --scope user, project, or local.'
    );
  }
  if (options.hooks !== undefined && !VALID_HOOK_MODES.has(options.hooks)) {
    throw migrationError('INVALID_HOOK_MODE', `Invalid hook mode: ${options.hooks}`);
  }

  const paths = resolveClaudePaths(options);
  const settingsPath = path.join(paths.configDir, 'settings.json');
  const settings = readSettings(settingsPath);
  assertSafeLocalInventory(paths);
  assertGitAvailable(
    { cwd: paths.projectRoot },
    { spawnSync: dependencies.spawnSync }
  );
  const providerRun = dependencies.runClaude || runClaude;
  const run = options.dryRun
    ? createDryRunClaudeRunner(providerRun, paths, options)
    : providerRun;
  const plugins = readPluginInventory(run, paths.projectRoot, 'inventory');
  const migration = assertMigrationInventory(plugins, options.scope);
  const hooks = options.hooks === undefined
    ? deriveHookMode(settings)
    : options.hooks;
  const hookConfiguration = options.hooks === undefined
    ? readStoredHookOptions(settings)
    : hookOptions(options.hooks);
  const needsCommitAttributionPreference = needsClaudeCommitAttributionPreferenceWrite(settings);

  const marketplaces = parseMarketplaceList(
    run(
      ['plugin', 'marketplace', 'list', '--json'],
      { cwd: paths.projectRoot, phase: 'marketplace-inventory' }
    ).stdout
  );
  const namedMarketplace = marketplaces.find(entry => entry?.name === 'ecc');
  if (namedMarketplace && !isOfficialMarketplace(namedMarketplace)) {
    throw migrationError(
      'MARKETPLACE_COLLISION',
      'Refusing the `ecc` marketplace collision because it is not the official affaan-m/ECC source.',
      {
        phase: 'marketplace-inventory',
        observedScopes: migration.observedScopes,
      }
    );
  }

  if (migration.mode === 'already-migrated') {
    const result = {
      action: 'already-migrated',
      hooks,
      pluginId: CURRENT_PLUGIN_ID,
      sourceScope: null,
      scope: options.scope,
    };
    if (options.dryRun) {
      return {
        ...result,
        dryRun: true,
        preferencesUpdated: false,
        plannedActions: [
          ...(options.hooks === undefined ? [] : [{
            action: 'write-hook-preferences',
            ...hookConfiguration,
          }]),
          ...(needsCommitAttributionPreference ? [{
            action: 'write-commit-attribution-preference',
            includeCoAuthoredBy: false,
          }] : []),
        ],
      };
    }
    if (options.hooks !== undefined || needsCommitAttributionPreference) {
      writeClaudePluginOptions(
        settingsPath,
        options.hooks !== undefined ? options.hooks : undefined
      );
      return { ...result, preferencesUpdated: true };
    }
    return result;
  }

  let marketplaceAction = null;
  if (migration.mode === 'migrate') {
    marketplaceAction = namedMarketplace
      ? ['plugin', 'marketplace', 'update', 'ecc']
      : [
        'plugin', 'marketplace', 'add',
        OFFICIAL_MARKETPLACE_URL,
        '--scope', options.scope,
      ];
  }

  if (options.dryRun) {
    return {
      action: migration.mode === 'resume' ? 'would-resume' : 'would-migrate',
      dryRun: true,
      hooks,
      plannedActions: plannedActions(
        migration,
        options.scope,
        marketplaceAction,
        hookConfiguration
      ),
      pluginId: CURRENT_PLUGIN_ID,
      sourceScope: migration.sourceScope,
      scope: options.scope,
    };
  }

  if (migration.mode === 'migrate') {
    ensureOfficialMarketplace({
      marketplaces,
      projectRoot: paths.projectRoot,
      run,
      scope: options.scope,
      spawnSync: dependencies.spawnSync,
    });
    ensurePluginAtScope({
      hookConfiguration,
      hooks,
      installed: false,
      projectRoot: paths.projectRoot,
      run,
      scope: options.scope,
    });
  }

  verifySourceAndDestination(
    run,
    paths,
    migration,
    options.scope,
    'destination-verification'
  );
  verifySourceAndDestination(
    run,
    paths,
    migration,
    options.scope,
    'concurrency-check'
  );
  const warnings = uninstallSource(run, paths, migration, options.scope);
  verifyFinalState(run, paths, options.scope);

  if (options.hooks !== undefined || needsCommitAttributionPreference) {
    writeClaudePluginOptions(
      settingsPath,
      options.hooks !== undefined ? options.hooks : undefined
    );
  }

  const result = {
    action: migration.mode === 'resume' ? 'resumed' : 'migrated',
    hooks,
    pluginId: CURRENT_PLUGIN_ID,
    sourceScope: migration.sourceScope,
    scope: options.scope,
  };
  return warnings.length > 0 ? { ...result, warnings } : result;
}

module.exports = {
  migrateClaudePluginScope,
};
