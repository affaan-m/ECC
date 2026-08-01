'use strict';

const { execFile: nodeExecFile } = require('child_process');

const CODEX_PLUGIN_ID = 'ecc@ecc';
const OFFICIAL_MARKETPLACE_NAME = 'ecc';
const OFFICIAL_MARKETPLACE_REPO = 'affaan-m/ECC';
const NORMALIZED_OFFICIAL_MARKETPLACE_REPO = OFFICIAL_MARKETPLACE_REPO.toLowerCase();
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

class CodexPluginSetupError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CodexPluginSetupError';
    this.code = code;
    this.phase = details.phase || 'inventory';
    this.argv = [...(details.argv || [])];
  }
}

function fail(code, message, details) {
  throw new CodexPluginSetupError(code, message, details);
}

function parseJsonObject(stdout, inventoryName) {
  let parsed;
  try {
    parsed = JSON.parse(String(stdout || ''));
  } catch (error) {
    fail(
      `INVALID_${inventoryName.toUpperCase()}_INVENTORY`,
      `Codex ${inventoryName} inventory returned invalid JSON: ${error.message}`
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(
      `INVALID_${inventoryName.toUpperCase()}_INVENTORY`,
      `Codex ${inventoryName} inventory is invalid: expected a JSON object`
    );
  }
  return parsed;
}

function normalizeGitHubRepository(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  const match = normalized.match(
    /^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)?([^/]+\/[^/]+)$/i
  );
  return match ? match[1].toLowerCase() : null;
}

function parseMarketplaceInventory(stdout) {
  const inventory = parseJsonObject(stdout, 'marketplace');
  if (!Array.isArray(inventory.marketplaces)) {
    fail(
      'INVALID_MARKETPLACE_INVENTORY',
      'Codex marketplace inventory is invalid: expected `marketplaces` to be an array'
    );
  }
  for (const marketplace of inventory.marketplaces) {
    if (
      !marketplace
      || typeof marketplace.name !== 'string'
      || marketplace.name.length === 0
      || typeof marketplace.root !== 'string'
      || marketplace.root.length === 0
    ) {
      fail(
        'INVALID_MARKETPLACE_INVENTORY',
        'Codex marketplace inventory contains an invalid marketplace entry'
      );
    }
  }
  const eccEntries = inventory.marketplaces.filter(
    marketplace => marketplace.name === OFFICIAL_MARKETPLACE_NAME
  );
  if (eccEntries.length > 1) {
    fail(
      'INVALID_MARKETPLACE_INVENTORY',
      'Codex marketplace inventory contains duplicate `ecc` entries'
    );
  }
  return inventory.marketplaces;
}

function assertPluginEntries(entries, field) {
  if (!Array.isArray(entries)) {
    fail(
      'INVALID_PLUGIN_INVENTORY',
      `Codex plugin inventory is invalid: expected \`${field}\` to be an array`
    );
  }
  for (const plugin of entries) {
    if (
      !plugin
      || typeof plugin.pluginId !== 'string'
      || plugin.pluginId.length === 0
    ) {
      fail(
        'INVALID_PLUGIN_INVENTORY',
        `Codex plugin inventory contains an invalid \`${field}\` entry`
      );
    }
    if (plugin.installed !== undefined && typeof plugin.installed !== 'boolean') {
      fail(
        'INVALID_PLUGIN_INVENTORY',
        `Codex plugin inventory contains an invalid \`${field}\` install state`
      );
    }
    if (plugin.enabled !== undefined && typeof plugin.enabled !== 'boolean') {
      fail(
        'INVALID_PLUGIN_INVENTORY',
        `Codex plugin inventory contains an invalid \`${field}\` enabled state`
      );
    }
  }
}

function parsePluginInventory(stdout) {
  const inventory = parseJsonObject(stdout, 'plugin');
  assertPluginEntries(inventory.installed, 'installed');
  assertPluginEntries(inventory.available, 'available');
  const eccEntries = inventory.installed.filter(
    plugin => plugin.pluginId === CODEX_PLUGIN_ID
  );
  if (eccEntries.length > 1) {
    fail(
      'INVALID_PLUGIN_INVENTORY',
      `Codex plugin inventory contains duplicate ${CODEX_PLUGIN_ID} entries`
    );
  }
  return {
    installed: [...inventory.installed],
    available: [...inventory.available],
  };
}

function executeFile(execFile, command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject({
          cause: error,
          code: error.code,
          message: error.message,
          stderr: error.stderr || stderr,
          stdout: error.stdout || stdout,
        });
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function runCodexCommand(args, options = {}, dependencies = {}) {
  const command = dependencies.command || options.command || 'codex';
  const execFile = dependencies.execFile || nodeExecFile;
  const argv = [...args];
  try {
    return await executeFile(execFile, command, argv, {
      cwd: options.cwd || process.cwd(),
      encoding: 'utf8',
      env: options.env || process.env,
      maxBuffer: MAX_OUTPUT_BYTES,
      shell: false,
      windowsHide: true,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      fail(
        'CODEX_NOT_FOUND',
        'Codex CLI is not installed or `codex` is not on PATH. Install Codex, then rerun ECC setup.',
        { argv, phase: options.phase }
      );
    }
    const detail = String(error?.stderr || error?.stdout || error?.message || '').trim();
    fail(
      'CODEX_COMMAND_FAILED',
      `Codex command failed${detail ? `: ${detail}` : ''}`,
      { argv, phase: options.phase }
    );
  }
}

async function resolveMarketplaceRepository(marketplace, options = {}, dependencies = {}) {
  const execFile = dependencies.execFile || nodeExecFile;
  let result;
  try {
    result = await executeFile(
      execFile,
      dependencies.gitCommand || 'git',
      ['-C', marketplace.root, 'remote', 'get-url', 'origin'],
      {
        cwd: options.cwd || process.cwd(),
        encoding: 'utf8',
        env: options.env || process.env,
        maxBuffer: MAX_OUTPUT_BYTES,
        shell: false,
        windowsHide: true,
      }
    );
  } catch (error) {
    const detail = String(error?.stderr || error?.message || '').trim();
    fail(
      'MARKETPLACE_COLLISION',
      `Refusing the existing \`ecc\` marketplace because its Git provenance could not be verified${detail ? `: ${detail}` : ''}.`,
      { phase: 'marketplace-provenance' }
    );
  }
  return normalizeGitHubRepository(result.stdout);
}

async function assertOfficialMarketplace(marketplace, options, dependencies) {
  if (!marketplace) return;
  const resolveRepository = dependencies.resolveMarketplaceRepository
    || (entry => resolveMarketplaceRepository(entry, options, dependencies));
  let repository;
  try {
    repository = normalizeGitHubRepository(await resolveRepository(marketplace));
  } catch (error) {
    if (error instanceof CodexPluginSetupError) throw error;
    const detail = String(error?.message || error || '').trim();
    fail(
      'MARKETPLACE_COLLISION',
      `Refusing the existing \`ecc\` marketplace because its provenance could not be verified${detail ? `: ${detail}` : ''}.`,
      { phase: 'marketplace-provenance' }
    );
  }
  if (repository !== NORMALIZED_OFFICIAL_MARKETPLACE_REPO) {
    fail(
      'MARKETPLACE_COLLISION',
      'Refusing the existing `ecc` marketplace because it is not the official affaan-m/ECC source.',
      { phase: 'marketplace-provenance' }
    );
  }
}

function findEccMarketplace(marketplaces) {
  return marketplaces.find(
    marketplace => marketplace.name === OFFICIAL_MARKETPLACE_NAME
  ) || null;
}

function findInstalledEccPlugin(inventory) {
  return inventory.installed.find(
    plugin => plugin.pluginId === CODEX_PLUGIN_ID
  ) || null;
}

async function readMarketplaceInventory(run, phase) {
  const result = await run(
    ['plugin', 'marketplace', 'list', '--json'],
    { phase }
  );
  return parseMarketplaceInventory(result.stdout);
}

async function readPluginInventory(run, phase) {
  const result = await run(['plugin', 'list', '--json'], { phase });
  return parsePluginInventory(result.stdout);
}

async function reconcileCodexPlugin(options = {}, dependencies = {}) {
  const run = (args, details = {}) => runCodexCommand(
    args,
    {
      command: options.command,
      cwd: options.cwd,
      env: options.env,
      phase: details.phase,
    },
    dependencies
  );
  const marketplaces = await readMarketplaceInventory(run, 'marketplace-inventory');
  const plugins = await readPluginInventory(run, 'plugin-inventory');
  const marketplace = findEccMarketplace(marketplaces);
  const installedPlugin = findInstalledEccPlugin(plugins);
  await assertOfficialMarketplace(marketplace, options, dependencies);
  const pluginReady = (
    installedPlugin?.installed === true
    && installedPlugin.enabled === true
  );
  const isReconciled = Boolean(marketplace && pluginReady);

  if (options.dryRun) {
    return {
      action: isReconciled
        ? 'unchanged'
        : (installedPlugin ? 'would-update' : 'would-install'),
      dryRun: true,
      marketplaceAction: marketplace
        ? (isReconciled ? 'unchanged' : 'would-upgrade')
        : 'would-add',
      pluginId: CODEX_PLUGIN_ID,
      restartRequired: !isReconciled,
    };
  }

  if (isReconciled) {
    return {
      action: 'unchanged',
      marketplaceAction: 'unchanged',
      pluginId: CODEX_PLUGIN_ID,
      restartRequired: false,
    };
  }

  const marketplaceArgs = marketplace
    ? ['plugin', 'marketplace', 'upgrade', OFFICIAL_MARKETPLACE_NAME, '--json']
    : ['plugin', 'marketplace', 'add', OFFICIAL_MARKETPLACE_REPO, '--json'];
  const marketplaceAction = marketplace ? 'upgraded' : 'added';
  await run(marketplaceArgs, {
    phase: marketplace ? 'marketplace-upgrade' : 'marketplace-add',
  });

  const verifiedMarketplaces = await readMarketplaceInventory(
    run,
    'marketplace-verification'
  );
  if (!findEccMarketplace(verifiedMarketplaces)) {
    fail(
      'MARKETPLACE_VERIFICATION_FAILED',
      'Could not verify the ECC marketplace after reconciliation.',
      { phase: 'marketplace-verification' }
    );
  }
  await assertOfficialMarketplace(
    findEccMarketplace(verifiedMarketplaces),
    options,
    dependencies
  );

  if (!pluginReady) {
    await run(
      ['plugin', 'add', CODEX_PLUGIN_ID, '--json'],
      { phase: 'plugin-add' }
    );
  }

  const verifiedPlugins = await readPluginInventory(run, 'plugin-verification');
  const verifiedPlugin = findInstalledEccPlugin(verifiedPlugins);
  if (!(verifiedPlugin?.installed === true && verifiedPlugin.enabled === true)) {
    fail(
      'PLUGIN_VERIFICATION_FAILED',
      `Could not verify ${CODEX_PLUGIN_ID} as installed and enabled after reconciliation.`,
      { phase: 'plugin-verification' }
    );
  }

  return {
    action: installedPlugin ? 'updated' : 'installed',
    marketplaceAction,
    pluginId: CODEX_PLUGIN_ID,
    restartRequired: true,
  };
}

module.exports = {
  CODEX_PLUGIN_ID,
  CodexPluginSetupError,
  OFFICIAL_MARKETPLACE_NAME,
  OFFICIAL_MARKETPLACE_REPO,
  findEccMarketplace,
  findInstalledEccPlugin,
  normalizeGitHubRepository,
  parseMarketplaceInventory,
  parsePluginInventory,
  reconcileCodexPlugin,
  resolveMarketplaceRepository,
  runCodexCommand,
};
