'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { writeFileAtomic } = require('./atomic-write');
const { normalizeGitHubGitOrigin } = require('./github-origin');
const {
  CURRENT_PLUGIN_ID,
  LEGACY_PLUGIN_IDS,
  findManagedClaudeInstalls,
  findManualClaudePlugin,
  resolveClaudePaths,
} = require('./install/inventory');

const OFFICIAL_MARKETPLACE_NAME = 'ecc';
const OFFICIAL_MARKETPLACE_REPO = 'affaan-m/ecc';
const OFFICIAL_MARKETPLACE_URL = 'https://github.com/affaan-m/ECC';
const PROVIDER_COMMAND_TIMEOUT_MS = 120 * 1000;
const VALID_SCOPES = new Set(['user', 'project', 'local']);
const VALID_HOOK_MODES = new Set(['off', 'minimal', 'standard', 'strict']);

class ClaudeSetupError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ClaudeSetupError';
    this.code = code;
    this.phase = details.phase || 'preflight';
    this.observedScopes = [...(details.observedScopes || [])];
    this.recovery = [...(details.recovery || [])];
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        phase: this.phase,
        observedScopes: [...this.observedScopes],
        recovery: [...this.recovery],
      },
    };
  }
}

function fail(code, message, details) {
  throw new ClaudeSetupError(code, message, details);
}

function normalizeGitHubRepository(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  const match = normalized.match(/^([^/]+\/[^/]+)$/);
  return match ? match[1].toLowerCase() : null;
}

function normalizeMarketplaceRepository(marketplace) {
  return marketplace?.source === 'github'
    ? normalizeGitHubRepository(marketplace.repo)
    : normalizeGitHubGitOrigin(marketplace?.url);
}

function isOfficialMarketplace(marketplace) {
  if (!marketplace || marketplace.name !== OFFICIAL_MARKETPLACE_NAME) return false;
  return normalizeMarketplaceRepository(marketplace) === OFFICIAL_MARKETPLACE_REPO;
}

function parseJsonArray(stdout, label) {
  let parsed;
  try {
    parsed = JSON.parse(String(stdout || ''));
  } catch (error) {
    fail(
      `INVALID_${label.toUpperCase()}_INVENTORY`,
      `Claude ${label} inventory returned invalid JSON: ${error.message}`
    );
  }
  if (!Array.isArray(parsed)) {
    fail(
      `INVALID_${label.toUpperCase()}_INVENTORY`,
      `Claude ${label} inventory is invalid: expected a JSON array`
    );
  }
  return parsed;
}

function parsePluginList(stdout) {
  const plugins = parseJsonArray(stdout, 'plugin');
  for (const plugin of plugins) {
    const isRelevant = plugin && (
      plugin.id === CURRENT_PLUGIN_ID
      || String(plugin.id || '').startsWith('ecc@')
      || LEGACY_PLUGIN_IDS.has(plugin.id)
      || String(plugin.id || '').startsWith('everything-claude-code@')
    );
    if (!isRelevant) continue;
    if (
      typeof plugin.id !== 'string'
      || !VALID_SCOPES.has(plugin.scope)
      || typeof plugin.enabled !== 'boolean'
    ) {
      fail(
        'INVALID_PLUGIN_INVENTORY',
        'Claude plugin inventory contains an invalid ECC plugin entry'
      );
    }
  }
  return plugins;
}

function parseMarketplaceList(stdout) {
  const marketplaces = parseJsonArray(stdout, 'marketplace');
  for (const marketplace of marketplaces) {
    if (!marketplace || marketplace.name !== OFFICIAL_MARKETPLACE_NAME) continue;
    if (
      typeof marketplace.name !== 'string'
      || typeof marketplace.source !== 'string'
      || !['github', 'git'].includes(marketplace.source)
      || !normalizeMarketplaceRepository(marketplace)
    ) {
      fail(
        'INVALID_MARKETPLACE_INVENTORY',
        'Claude marketplace inventory contains an invalid `ecc` entry'
      );
    }
  }
  return marketplaces;
}

const UNSAFE_WINDOWS_SHELL_CHARS = /[\r\n&|<>^%!]/;

function quoteWindowsCommandToken(value) {
  const token = String(value);
  if (UNSAFE_WINDOWS_SHELL_CHARS.test(token)) {
    throw new Error('Claude Code command contains characters that are unsafe for cmd.exe');
  }
  if (token === '') return '""';
  if (!/[\s"]/.test(token)) return token;
  return `"${token.replace(/"/g, '""')}"`;
}

function buildWindowsCommandLine(command, args) {
  return [command, ...args].map(quoteWindowsCommandToken).join(' ');
}

function resolveWindowsCmdShim(command, env) {
  if (typeof command !== 'string' || command.length === 0) return null;
  if (/\.(cmd|bat)$/i.test(command)) return command;
  if (path.extname(command)) return null;

  const isPathLike = path.isAbsolute(command)
    || command.includes('/')
    || command.includes('\\');
  if (isPathLike) {
    const candidate = `${command}.cmd`;
    return fs.existsSync(candidate) ? candidate : null;
  }

  const lookup = spawnSync('where.exe', [`${command}.cmd`], {
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (lookup.error || lookup.status !== 0) return null;
  return String(lookup.stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean) || null;
}

function runClaude(args, options = {}, dependencies = {}) {
  const command = options.command || 'claude';
  const spawn = dependencies.spawnSync || spawnSync;
  const timeoutMs = options.timeoutMs ?? PROVIDER_COMMAND_TIMEOUT_MS;
  const spawnOptions = {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    killSignal: 'SIGKILL',
    timeout: timeoutMs,
    windowsHide: true,
  };
  let result = spawn(command, args, spawnOptions);

  if (process.platform === 'win32' && result.error) {
    const shim = resolveWindowsCmdShim(command, spawnOptions.env);
    if (shim) {
      let commandLine;
      try {
        commandLine = buildWindowsCommandLine(shim, args);
      } catch (error) {
        fail(
          'CLAUDE_COMMAND_FAILED',
          `Could not run Claude Code: ${error.message}`,
          { phase: options.phase || 'provider' }
        );
      }
      result = spawn(commandLine, {
        ...spawnOptions,
        shell: true,
      });
    }
  }

  const timedOut = (
    result.error?.code === 'ETIMEDOUT'
    || (result.error?.killed === true && result.error?.signal === spawnOptions.killSignal)
  );
  if (timedOut) {
    fail(
      'CLAUDE_COMMAND_FAILED',
      `Claude Code command timed out after ${timeoutMs} ms`,
      { phase: options.phase || 'provider' }
    );
  }
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      fail(
        'CLAUDE_NOT_FOUND',
        'Claude Code is not installed or `claude` is not on PATH. Install Claude Code, then rerun ECC setup.',
        { phase: options.phase || 'inventory' }
      );
    }
    fail(
      'CLAUDE_COMMAND_FAILED',
      `Could not run Claude Code: ${result.error.message}`,
      { phase: options.phase || 'provider' }
    );
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    fail(
      'CLAUDE_COMMAND_FAILED',
      `Claude Code command failed${detail ? `: ${detail}` : ''}`,
      { phase: options.phase || 'provider' }
    );
  }
  return result;
}

function readSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return {};
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (error) {
    fail(
      'INVALID_CLAUDE_SETTINGS',
      `Claude user settings are invalid at ${settingsPath}: ${error.message}`,
      { phase: 'preflight' }
    );
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    fail(
      'INVALID_CLAUDE_SETTINGS',
      `Claude user settings are invalid at ${settingsPath}: expected a JSON object`,
      { phase: 'preflight' }
    );
  }
  const pluginConfigs = settings.pluginConfigs;
  if (pluginConfigs !== undefined && (
    !pluginConfigs
    || typeof pluginConfigs !== 'object'
    || Array.isArray(pluginConfigs)
  )) {
    fail(
      'INVALID_CLAUDE_SETTINGS',
      `Claude user settings are invalid at ${settingsPath}: pluginConfigs must be an object`,
      { phase: 'preflight' }
    );
  }
  const eccConfig = pluginConfigs?.[CURRENT_PLUGIN_ID];
  if (eccConfig !== undefined && (
    !eccConfig
    || typeof eccConfig !== 'object'
    || Array.isArray(eccConfig)
  )) {
    fail(
      'INVALID_CLAUDE_SETTINGS',
      `Claude user settings are invalid at ${settingsPath}: ${CURRENT_PLUGIN_ID} config must be an object`,
      { phase: 'preflight' }
    );
  }
  if (eccConfig?.options !== undefined && (
    !eccConfig.options
    || typeof eccConfig.options !== 'object'
    || Array.isArray(eccConfig.options)
  )) {
    fail(
      'INVALID_CLAUDE_SETTINGS',
      `Claude user settings are invalid at ${settingsPath}: ${CURRENT_PLUGIN_ID} options must be an object`,
      { phase: 'preflight' }
    );
  }
  return settings;
}

function hookOptions(hooks) {
  return {
    hooks_enabled: hooks !== 'off',
    hook_profile: hooks === 'off' ? 'standard' : hooks,
  };
}

function readStoredHookOptions(settings) {
  const options = settings.pluginConfigs?.[CURRENT_PLUGIN_ID]?.options || {};
  return {
    hooks_enabled: options.hooks_enabled !== false,
    hook_profile: VALID_HOOK_MODES.has(options.hook_profile)
      && options.hook_profile !== 'off'
      ? options.hook_profile
      : 'standard',
  };
}

function deriveHookMode(settings) {
  const options = readStoredHookOptions(settings);
  return options.hooks_enabled ? options.hook_profile : 'off';
}

function writeClaudePluginOptions(settingsPath, hooks) {
  const settings = readSettings(settingsPath);
  const pluginConfigs = settings.pluginConfigs || {};
  const eccConfig = pluginConfigs[CURRENT_PLUGIN_ID] || {};
  const options = eccConfig.options || {};
  const nextSettings = {
    ...settings,
    pluginConfigs: {
      ...pluginConfigs,
      [CURRENT_PLUGIN_ID]: {
        ...eccConfig,
        options: {
          ...options,
          ...hookOptions(hooks),
        },
      },
    },
  };
  writeFileAtomic(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`);
  return settingsPath;
}

const STATUSLINE_LAUNCHER = `#!/usr/bin/env node
// ECC statusline launcher — written by the ECC installer.
// Resolves the active ecc plugin install and delegates to its statusline
// script, so the settings.json command survives plugin version updates.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
function resolveScript() {
  const relative = path.join('scripts', 'hooks', 'ecc-statusline.js');
  try {
    const installed = JSON.parse(
      fs.readFileSync(path.join(configDir, 'plugins', 'installed_plugins.json'), 'utf8')
    );
    const entries = installed?.plugins?.['${CURRENT_PLUGIN_ID}'];
    const entry = Array.isArray(entries) ? entries[0] : null;
    if (entry?.installPath) {
      const candidate = path.join(entry.installPath, relative);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch { /* fall through */ }
  if (process.env.ECC_ROOT) {
    const candidate = path.join(process.env.ECC_ROOT, relative);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
const script = resolveScript();
if (script) require(script).runStatusline();
`;

/**
 * Install the ECC usage bar as the default statusLine. Always refreshes the
 * launcher script; never overwrites an existing statusLine setting (e.g. a
 * user-configured bar) — reports 'kept-existing' instead.
 */
function ensureStatuslineDefault(settingsPath, configDir) {
  try {
    const launcherPath = path.join(configDir, 'ecc-statusline.js');
    writeFileAtomic(launcherPath, STATUSLINE_LAUNCHER);
    const settings = readSettings(settingsPath);
    if (settings.statusLine) {
      return { action: 'kept-existing', launcherPath };
    }
    const nextSettings = {
      ...settings,
      statusLine: { type: 'command', command: `node "${launcherPath}"` },
    };
    writeFileAtomic(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`);
    return { action: 'configured', launcherPath };
  } catch (error) {
    return { action: 'skipped', error: error.message };
  }
}

function currentEccPlugins(plugins) {
  return plugins.filter(plugin => plugin?.id === CURRENT_PLUGIN_ID);
}

function assertNoConflictingEccPlugins(plugins) {
  const legacy = plugins.find(plugin => (
    LEGACY_PLUGIN_IDS.has(plugin?.id)
    || String(plugin?.id || '').startsWith('everything-claude-code@')
  ));
  if (legacy) {
    fail(
      'LEGACY_PLUGIN_INSTALLED',
      `Legacy plugin ${legacy.id} is installed. Uninstall it before setting up ${CURRENT_PLUGIN_ID}.`,
      {
        observedScopes: [legacy.scope],
        recovery: [`claude plugin uninstall ${legacy.id} --scope ${legacy.scope} --keep-data`],
      }
    );
  }

  const conflictingEcc = plugins.find(plugin => (
    typeof plugin?.id === 'string'
    && plugin.id.startsWith('ecc@')
    && plugin.id !== CURRENT_PLUGIN_ID
  ));
  if (conflictingEcc) {
    fail(
      'DUPLICATE_ECC_PLUGIN',
      `${conflictingEcc.id} is already installed and would duplicate ECC surfaces. Uninstall it before setting up ${CURRENT_PLUGIN_ID}.`,
      {
        observedScopes: [conflictingEcc.scope],
        recovery: [
          `claude plugin uninstall ${conflictingEcc.id} --scope ${conflictingEcc.scope} --keep-data`,
        ],
      }
    );
  }
}

function inspectPluginInventory(plugins, requestedScope) {
  assertNoConflictingEccPlugins(plugins);
  const installed = currentEccPlugins(plugins);
  const observedScopes = installed.map(plugin => plugin.scope);
  if (installed.length > 1 || new Set(observedScopes).size !== observedScopes.length) {
    fail(
      'MULTIPLE_PLUGIN_SCOPES',
      `${CURRENT_PLUGIN_ID} is installed in multiple scopes. Resolve the duplicate scopes before setup.`,
      { observedScopes }
    );
  }

  if (!requestedScope && installed.length === 0) {
    fail(
      'SCOPE_REQUIRED',
      'A fresh install requires --scope user, project, or local.'
    );
  }

  const scope = requestedScope || installed[0].scope;
  if (!VALID_SCOPES.has(scope)) {
    fail('INVALID_SCOPE', `Invalid plugin scope: ${scope}`);
  }
  if (installed.length === 1 && installed[0].scope !== scope) {
    fail(
      'SCOPE_MOVE_REQUIRED',
      `${CURRENT_PLUGIN_ID} is already installed at ${installed[0].scope} scope. Use the scope migration workflow to move it to ${scope}.`,
      {
        observedScopes,
        recovery: [
          `ecc setup --mode claude-plugin --scope ${scope} --move-scope --yes`,
        ],
      }
    );
  }

  return {
    installed: installed[0] || null,
    observedScopes,
    scope,
  };
}

function assertSafeLocalInventory(options) {
  const manual = findManualClaudePlugin(options);
  if (manual) {
    fail(
      'MANUAL_PLUGIN_INSTALL',
      `A manual ECC plugin layout exists at ${manual.manifestPath}. Remove or migrate the manual install before setup.`
    );
  }
  let managedInstalls;
  try {
    managedInstalls = findManagedClaudeInstalls(options);
  } catch (error) {
    fail('INVALID_MANAGED_STATE', error.message);
  }
  const overlap = managedInstalls.find(install => install.overlapsPlugin);
  if (overlap) {
    fail(
      'MANAGED_INSTALL_OVERLAP',
      `Managed ECC content at ${overlap.statePath} overlaps the Claude plugin. Remove that managed overlap before setup.`
    );
  }
  return managedInstalls;
}

function ensureOfficialMarketplace(options) {
  const run = options.run || runClaude;
  const existing = options.marketplaces.find(entry => entry?.name === OFFICIAL_MARKETPLACE_NAME);
  if (existing && !isOfficialMarketplace(existing)) {
    fail(
      'MARKETPLACE_COLLISION',
      'Refusing the `ecc` marketplace collision because it is not the official affaan-m/ECC source.'
    );
  }

  if (existing) {
    run(
      ['plugin', 'marketplace', 'update', OFFICIAL_MARKETPLACE_NAME],
      { cwd: options.projectRoot, phase: 'marketplace' }
    );
  } else {
    run(
      [
        'plugin', 'marketplace', 'add',
        OFFICIAL_MARKETPLACE_URL,
        '--scope', options.scope,
      ],
      { cwd: options.projectRoot, phase: 'marketplace' }
    );
  }

  const verified = parseMarketplaceList(
    run(
      ['plugin', 'marketplace', 'list', '--json'],
      { cwd: options.projectRoot, phase: 'marketplace-verification' }
    ).stdout
  ).find(entry => entry?.name === OFFICIAL_MARKETPLACE_NAME);
  if (!verified || !isOfficialMarketplace(verified)) {
    fail(
      'MARKETPLACE_VERIFICATION_FAILED',
      'Could not verify the official ECC marketplace after the marketplace change.',
      { phase: 'marketplace-verification' }
    );
  }
  return verified;
}

function verifyPluginAtScope(options) {
  const run = options.run || runClaude;
  const plugins = parsePluginList(
    run(
      ['plugin', 'list', '--json'],
      { cwd: options.projectRoot, phase: options.phase || 'plugin-verification' }
    ).stdout
  );
  const installed = currentEccPlugins(plugins);
  const valid = (
    installed.length === 1
    && installed[0].scope === options.scope
    && installed[0].enabled === true
  );
  if (!valid) {
    fail(
      'PLUGIN_VERIFICATION_FAILED',
      `Could not verify ${CURRENT_PLUGIN_ID} as enabled only at ${options.scope} scope.`,
      {
        phase: options.phase || 'plugin-verification',
        observedScopes: installed.map(plugin => plugin.scope),
      }
    );
  }
  return installed[0];
}

function ensurePluginAtScope(options) {
  const run = options.run || runClaude;
  const configuredHooks = options.hookConfiguration || hookOptions(options.hooks);
  if (options.installed) {
    run(
      ['plugin', 'update', CURRENT_PLUGIN_ID, '--scope', options.scope],
      { cwd: options.projectRoot, phase: 'plugin-update' }
    );
    return 'updated';
  }
  run(
    [
      'plugin', 'install', CURRENT_PLUGIN_ID,
      '--scope', options.scope,
      '--config', `hooks_enabled=${configuredHooks.hooks_enabled}`,
      '--config', `hook_profile=${configuredHooks.hook_profile}`,
    ],
    { cwd: options.projectRoot, phase: 'plugin-install' }
  );
  return 'installed';
}

function setupClaudePlugin(options = {}, dependencies = {}) {
  const paths = resolveClaudePaths(options);
  if (options.hooks !== undefined && !VALID_HOOK_MODES.has(options.hooks)) {
    fail('INVALID_HOOK_MODE', `Invalid hook mode: ${options.hooks}`);
  }
  if (options.scope !== undefined && !VALID_SCOPES.has(options.scope)) {
    fail('INVALID_SCOPE', `Invalid plugin scope: ${options.scope}`);
  }

  const settingsPath = path.join(paths.configDir, 'settings.json');
  const initialSettings = readSettings(settingsPath);
  assertSafeLocalInventory(paths);

  const run = dependencies.runClaude || runClaude;
  const plugins = parsePluginList(
    run(
      ['plugin', 'list', '--json'],
      { cwd: paths.projectRoot, phase: 'inventory' }
    ).stdout
  );
  const inventory = inspectPluginInventory(plugins, options.scope);
  const hooks = options.hooks === undefined && inventory.installed
    ? deriveHookMode(initialSettings)
    : (options.hooks || 'standard');
  const marketplaces = parseMarketplaceList(
    run(
      ['plugin', 'marketplace', 'list', '--json'],
      { cwd: paths.projectRoot, phase: 'marketplace-inventory' }
    ).stdout
  );
  const namedMarketplace = marketplaces.find(entry => (
    entry?.name === OFFICIAL_MARKETPLACE_NAME
  ));
  if (namedMarketplace && !isOfficialMarketplace(namedMarketplace)) {
    fail(
      'MARKETPLACE_COLLISION',
      'Refusing the `ecc` marketplace collision because it is not the official affaan-m/ECC source.'
    );
  }

  if (options.dryRun) {
    return {
      action: inventory.installed ? 'would-update' : 'would-install',
      dryRun: true,
      hooks,
      marketplaceAction: namedMarketplace ? 'would-update' : 'would-add',
      pluginId: CURRENT_PLUGIN_ID,
      scope: inventory.scope,
      statusline: initialSettings.statusLine ? 'would-keep-existing' : 'would-configure',
    };
  }

  ensureOfficialMarketplace({
    marketplaces,
    projectRoot: paths.projectRoot,
    run,
    scope: inventory.scope,
  });
  const action = ensurePluginAtScope({
    hooks,
    installed: inventory.installed,
    projectRoot: paths.projectRoot,
    run,
    scope: inventory.scope,
  });
  verifyPluginAtScope({
    phase: 'plugin-verification',
    projectRoot: paths.projectRoot,
    run,
    scope: inventory.scope,
  });
  if (options.hooks !== undefined || !inventory.installed) {
    writeClaudePluginOptions(settingsPath, hooks);
  }
  const statusline = ensureStatuslineDefault(settingsPath, paths.configDir);

  return {
    action,
    hooks,
    pluginId: CURRENT_PLUGIN_ID,
    restartRequired: true,
    scope: inventory.scope,
    settingsPath,
    statusline,
  };
}

module.exports = {
  ClaudeSetupError,
  CURRENT_PLUGIN_ID,
  OFFICIAL_MARKETPLACE_NAME,
  OFFICIAL_MARKETPLACE_URL,
  PROVIDER_COMMAND_TIMEOUT_MS,
  VALID_HOOK_MODES,
  VALID_SCOPES,
  buildWindowsCommandLine,
  assertNoConflictingEccPlugins,
  assertSafeLocalInventory,
  currentEccPlugins,
  deriveHookMode,
  ensureOfficialMarketplace,
  ensurePluginAtScope,
  ensureStatuslineDefault,
  hookOptions,
  inspectPluginInventory,
  isOfficialMarketplace,
  parseMarketplaceList,
  parsePluginList,
  readStoredHookOptions,
  readSettings,
  runClaude,
  setupClaudePlugin,
  verifyPluginAtScope,
  writeClaudePluginOptions,
};
