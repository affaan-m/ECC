'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createInstallState,
  readInstallState,
  writeInstallState,
} = require('./install-state');
const grokHomeTarget = require('./install-targets/grok-home');
const {
  isGitWorkTreeRoot,
  resolvePinnedGitSha,
  copyInstallSource,
  assertSourceIdentity,
  writePinnedMarketplace,
} = require('./grok-source-identity');

const GROK_PLUGIN_ROOT_ENV = 'GROK_PLUGIN_ROOT';
const GROK_HOME_DIRNAME = '.grok';
const INSTALLED_PLUGINS_DIR = 'installed-plugins';
const PREVIOUS_STATE_FILE = 'install-state.previous.json';
const SOURCE_IDENTITY_FILE = '.ecc-source.json';
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const HOOKS_CAPABILITY_ID = 'hooks';
const CHROME_DEVTOOLS_MCP = 'chrome-devtools';
const CURRENT_PLUGIN_SLUG = 'ecc';
const PLUGIN_CACHE_SLUGS = [CURRENT_PLUGIN_SLUG, 'everything-claude-code'];
const PLUGIN_ROOT_SEGMENTS = [
  [CURRENT_PLUGIN_SLUG],
  [`${CURRENT_PLUGIN_SLUG}@${CURRENT_PLUGIN_SLUG}`],
  ['marketplaces', CURRENT_PLUGIN_SLUG],
];
const DEFAULT_SCRIPT_PROBE = path.join('scripts', 'lib', 'utils.js');
const DEFAULT_SKILL_PROBE = path.join('skills', 'continuous-learning-v2');
const SHARED_PLUGIN_ROOT_KEYS = Object.freeze([
  'PLUGIN_ROOT',
  'CLAUDE_PLUGIN_ROOT',
  'ECC_PLUGIN_ROOT',
]);

function trimEnv(value) {
  return value && String(value).trim() ? String(value).trim() : '';
}

function grokPluginRootFromEnv(env = {}) {
  return trimEnv(env[GROK_PLUGIN_ROOT_ENV]);
}

function hasSharedPluginRoot(env = {}) {
  return SHARED_PLUGIN_ROOT_KEYS.some((key) => trimEnv(env[key]));
}

/**
 * Map Grok-only env onto the harness-neutral PLUGIN_ROOT without leaving
 * GROK_PLUGIN_ROOT for shared hook/root code to select.
 */
function toSharedPluginEnv(env = {}) {
  const next = { ...env };
  const grokRoot = grokPluginRootFromEnv(env);
  delete next[GROK_PLUGIN_ROOT_ENV];
  if (grokRoot && !hasSharedPluginRoot(next)) {
    next.PLUGIN_ROOT = grokRoot;
  }
  return next;
}

/**
 * Grok-facing plugin.json `mcpServers: ""` opts the native trusted plugin
 * surface out of repo-root `.mcp.json` (including chrome-devtools).
 */
function nativePluginMcpOptedOut(pluginManifest = {}) {
  const value = pluginManifest.mcpServers;
  if (value === '' || value === undefined || value === null) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }
  return false;
}

function nativeTrustedMcpServerNames(pluginManifest = {}) {
  if (nativePluginMcpOptedOut(pluginManifest)) {
    return [];
  }
  if (pluginManifest.mcpServers && typeof pluginManifest.mcpServers === 'object'
    && !Array.isArray(pluginManifest.mcpServers)) {
    return Object.keys(pluginManifest.mcpServers);
  }
  return [];
}

function nativeTrustedInstallAttachesChromeDevtools(pluginManifest = {}) {
  return nativeTrustedMcpServerNames(pluginManifest).includes(CHROME_DEVTOOLS_MCP);
}

function readGrokPluginManifest(pluginJsonPath, readFile = (file) => fs.readFileSync(file, 'utf8')) {
  return JSON.parse(readFile(pluginJsonPath));
}

function resolveHomeDir(env = process.env) {
  const explicit = trimEnv(env.ECC_GROK_HOME);
  if (explicit) {
    return explicit;
  }
  return os.homedir();
}

function grokHomeDir(homeDir, pathModule = path) {
  if (pathModule === path) {
    return grokHomeTarget.resolveRoot({ homeDir });
  }
  return pathModule.join(homeDir, GROK_HOME_DIRNAME);
}

function grokInstallStatePath(homeDir, pathModule = path) {
  if (pathModule === path) {
    return grokHomeTarget.getInstallStatePath({ homeDir });
  }
  return pathModule.join(homeDir, GROK_HOME_DIRNAME, 'ecc', 'install-state.json');
}

function grokPreviousStatePath(homeDir, pathModule = path) {
  return pathModule.join(pathModule.dirname(grokInstallStatePath(homeDir, pathModule)), PREVIOUS_STATE_FILE);
}

function normalizeContainedPath(candidate, pathModule = path) {
  const raw = String(candidate || '');
  if (!raw) {
    return '';
  }
  return pathModule.normalize(raw);
}

function isContained(candidate, root, pathModule = path) {
  const resolvedRoot = pathModule.resolve(normalizeContainedPath(root, pathModule));
  const resolvedCandidate = pathModule.resolve(resolvedRoot, normalizeContainedPath(candidate, pathModule));
  if (resolvedCandidate === resolvedRoot) {
    return true;
  }
  const prefix = resolvedRoot.endsWith(pathModule.sep)
    ? resolvedRoot
    : resolvedRoot + pathModule.sep;
  return resolvedCandidate.startsWith(prefix);
}

function assertRootContainment(candidate, root, pathModule = path) {
  if (!isContained(candidate, root, pathModule)) {
    throw new Error(`install path escapes Grok root: ${candidate}`);
  }
  return true;
}

function assertPinnedSource(source) {
  if (!source || typeof source !== 'object') {
    throw new Error('marketplace source must be an object');
  }
  if (source.source !== 'url') {
    throw new Error('marketplace source must be type url');
  }
  if (!source.url || typeof source.url !== 'string') {
    throw new Error('marketplace source must include a Git URL');
  }
  if (!SHA_PATTERN.test(source.sha || '')) {
    throw new Error('marketplace source must pin a 40-character lowercase commit SHA');
  }
  return {
    source: 'url',
    url: source.url,
    sha: source.sha,
  };
}

function sourceIdentity(source) {
  const pinned = assertPinnedSource(source);
  return `${pinned.url}@${pinned.sha}`;
}

function readMarketplaceSource(catalogPath, readFile = (file) => fs.readFileSync(file, 'utf8')) {
  const catalog = JSON.parse(readFile(catalogPath));
  const plugin = catalog && Array.isArray(catalog.plugins) ? catalog.plugins[0] : null;
  if (!plugin) {
    throw new Error('marketplace catalog has no plugins');
  }
  return {
    name: plugin.name,
    version: plugin.version,
    source: assertPinnedSource(plugin.source),
  };
}

function listMcpCapabilities(mcpConfig) {
  const servers = mcpConfig && mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object'
    ? mcpConfig.mcpServers
    : {};
  return Object.keys(servers).map((name) => ({
    id: name,
    kind: 'mcp',
    command: servers[name] && servers[name].command,
  }));
}

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function isCompleteRoot(dir, probe, pathModule = path) {
  if (probe) {
    return fs.existsSync(pathModule.join(dir, probe));
  }
  return fs.existsSync(pathModule.join(dir, DEFAULT_SCRIPT_PROBE))
    && fs.existsSync(pathModule.join(dir, DEFAULT_SKILL_PROBE));
}

function findRootInGrokHome(homeDir, probe, pathModule = path) {
  const vendorDir = grokHomeDir(homeDir, pathModule);
  if (isCompleteRoot(vendorDir, probe, pathModule)) {
    return vendorDir;
  }

  for (const segments of PLUGIN_ROOT_SEGMENTS) {
    const candidate = pathModule.join(vendorDir, 'plugins', ...segments);
    if (isCompleteRoot(candidate, probe, pathModule)) {
      return candidate;
    }
  }

  try {
    for (const slug of PLUGIN_CACHE_SLUGS) {
      const cacheBase = pathModule.join(vendorDir, 'plugins', 'cache', slug);
      const orgDirs = fs.readdirSync(cacheBase, { withFileTypes: true });
      for (const orgEntry of orgDirs) {
        if (!orgEntry.isDirectory()) continue;
        const orgPath = pathModule.join(cacheBase, orgEntry.name);
        let versionDirs;
        try {
          versionDirs = fs.readdirSync(orgPath, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const verEntry of versionDirs) {
          if (!verEntry.isDirectory()) continue;
          const candidate = pathModule.join(orgPath, verEntry.name);
          if (isCompleteRoot(candidate, probe, pathModule)) {
            return candidate;
          }
        }
      }
    }
  } catch {
    // Grok plugin cache is optional.
  }

  try {
    const installedBase = pathModule.join(vendorDir, INSTALLED_PLUGINS_DIR);
    const installedDirs = fs.readdirSync(installedBase, { withFileTypes: true });
    for (const entry of installedDirs) {
      if (!entry.isDirectory()) continue;
      const candidate = pathModule.join(installedBase, entry.name);
      if (isCompleteRoot(candidate, probe, pathModule)) {
        return candidate;
      }
    }
  } catch {
    // installed-plugins is Grok-specific and optional.
  }

  return null;
}

function receiptIdFromState(state) {
  const sha = state && state.source && state.source.repoCommit
    ? String(state.source.repoCommit).slice(0, 12)
    : 'unknown';
  return `ecc-${sha}-${state.installedAt}`;
}

function receiptFromInstallState(state) {
  if (!state) {
    return null;
  }
  const copyOp = (state.operations || []).find((operation) => operation.moduleId === 'ecc');
  const mcpAttached = (state.operations || [])
    .filter((operation) => operation.kind === 'mcp-attach')
    .map((operation) => operation.moduleId);
  const hooksOp = (state.operations || []).find((operation) => operation.moduleId === 'hooks');
  const sourcePin = (state.operations || []).find((operation) => operation.kind === 'source-pin');
  const enabled = Array.isArray(state.resolution.selectedModules)
    && state.resolution.selectedModules.includes(CURRENT_PLUGIN_SLUG);
  return {
    id: receiptIdFromState(state),
    pluginId: CURRENT_PLUGIN_SLUG,
    version: state.source.repoVersion,
    source: {
      source: 'url',
      url: sourcePin ? sourcePin.destinationPath : '',
      sha: state.source.repoCommit,
    },
    identity: sourcePin
      ? `${sourcePin.destinationPath}@${state.source.repoCommit}`
      : state.source.repoCommit,
    installedRoot: copyOp ? copyOp.destinationPath : state.target.root,
    enabled,
    trust: (state.operations || []).some((operation) => operation.strategy === 'consent-allow'),
    capabilities: (state.operations || [])
      .filter((operation) => operation.moduleId === 'hooks' || operation.kind === 'mcp-attach' || operation.kind === 'mcp-omit')
      .map((operation) => ({
        id: operation.moduleId,
        kind: operation.moduleId === 'hooks' ? 'hooks' : 'mcp',
        consented: operation.strategy === 'consent-allow',
      })),
    hooksEnabled: Boolean(hooksOp && hooksOp.strategy === 'consent-allow'),
    mcpAttached,
    previousReceiptId: null,
    createdAt: state.installedAt,
    operation: (state.operations || []).some((operation) => operation.kind === 'rollback')
      ? 'rollback'
      : (state.operations || []).some((operation) => operation.kind === 'uninstall')
        ? 'uninstall'
        : 'install',
    installStatePath: state.target.installStatePath,
    schemaVersion: state.schemaVersion,
  };
}

function loadCurrentReceipt(homeDir, pathModule = path) {
  const statePath = grokInstallStatePath(homeDir, pathModule);
  if (!fs.existsSync(statePath)) {
    return null;
  }
  try {
    const state = readInstallState(statePath);
    const receipt = receiptFromInstallState(state);
    const previousPath = grokPreviousStatePath(homeDir, pathModule);
    if (fs.existsSync(previousPath)) {
      try {
        const previous = readInstallState(previousPath);
        receipt.previousReceiptId = receiptIdFromState(previous);
      } catch {
        receipt.previousReceiptId = null;
      }
    }
    return receipt;
  } catch {
    return null;
  }
}

function installDestination(homeDir, plan, pathModule = path) {
  const grokRoot = grokHomeDir(homeDir, pathModule);
  const dest = pathModule.join(
    grokRoot,
    INSTALLED_PLUGINS_DIR,
    `${plan.pluginId || CURRENT_PLUGIN_SLUG}-${String(plan.source.sha).slice(0, 12)}`
  );
  assertRootContainment(dest, grokRoot, pathModule);
  return dest;
}

function readInstalledSharedEnv(installedRoot, pathModule = path) {
  return readJsonIfPresent(pathModule.join(installedRoot, '.grok-plugin', 'shared-env.json'));
}

function listManagedInstallRoots(homeDir, pathModule = path) {
  const roots = [];
  const base = pathModule.join(grokHomeDir(homeDir, pathModule), INSTALLED_PLUGINS_DIR);
  try {
    const entries = fs.readdirSync(base, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const installedRoot = pathModule.join(base, entry.name);
      if (readJsonIfPresent(pathModule.join(installedRoot, SOURCE_IDENTITY_FILE))) {
        roots.push(installedRoot);
      }
    }
  } catch {
    return roots;
  }
  return roots;
}

function planToOperations(plan, dest, pathModule) {
  const operations = [
    {
      kind: 'copy-path',
      moduleId: CURRENT_PLUGIN_SLUG,
      sourceRelativePath: '.',
      destinationPath: dest,
      strategy: 'preserve-relative-path',
      ownership: 'managed',
      scaffoldOnly: false,
    },
    {
      kind: 'source-pin',
      moduleId: 'marketplace',
      sourceRelativePath: '.grok-plugin/marketplace.json',
      destinationPath: plan.source.url,
      strategy: 'pin-sha',
      ownership: 'managed',
      scaffoldOnly: false,
    },
    {
      kind: plan.hooksEnabled ? 'copy-path' : 'omit-path',
      moduleId: 'hooks',
      sourceRelativePath: 'hooks/hooks.json',
      destinationPath: pathModule.join(dest, 'hooks', 'hooks.json'),
      strategy: plan.hooksEnabled ? 'consent-allow' : 'consent-deny',
      ownership: 'managed',
      scaffoldOnly: false,
    },
  ];
  for (const capability of plan.capabilities.filter((item) => item.kind === 'mcp')) {
    operations.push({
      kind: capability.consented ? 'mcp-attach' : 'mcp-omit',
      moduleId: capability.id,
      sourceRelativePath: '.mcp.json',
      destinationPath: pathModule.join(dest, '.mcp.json'),
      strategy: capability.consented ? 'consent-allow' : 'consent-deny',
      ownership: 'managed',
      scaffoldOnly: false,
    });
  }
  return operations;
}

function writeGrokInstallState(homeDir, plan, dest, now, pathModule, extraOperations = []) {
  const installStatePath = grokInstallStatePath(homeDir, pathModule);
  const operations = planToOperations(plan, dest, pathModule).concat(extraOperations);
  const state = createInstallState({
    installedAt: now,
    adapter: {
      id: grokHomeTarget.id,
      target: grokHomeTarget.target,
      kind: grokHomeTarget.kind,
    },
    targetRoot: grokHomeDir(homeDir, pathModule),
    installStatePath,
    request: {
      profile: null,
      modules: plan.enabled !== false ? [CURRENT_PLUGIN_SLUG] : [],
      includeComponents: plan.mcpAttached.slice(),
      excludeComponents: plan.hooksEnabled ? [] : ['hooks'],
      legacyLanguages: [],
      legacyMode: false,
    },
    resolution: {
      selectedModules: plan.enabled !== false ? [CURRENT_PLUGIN_SLUG] : [],
      skippedModules: plan.enabled !== false ? [] : [CURRENT_PLUGIN_SLUG],
    },
    source: {
      repoVersion: plan.version || null,
      repoCommit: plan.source.sha,
      manifestVersion: 1,
    },
    operations,
  });
  writeInstallState(installStatePath, state);
  return state;
}

function resolveGrokPluginRoot(options = {}) {
  const pathModule = options.pathModule || path;
  const env = options.env || {};
  const envRoot = options.envRoot !== undefined
    ? trimEnv(options.envRoot)
    : grokPluginRootFromEnv(env);
  if (envRoot) {
    return envRoot;
  }

  const homeDir = options.homeDir || os.homedir();
  const requireEnabled = options.requireEnabled !== false;
  const current = loadCurrentReceipt(homeDir, pathModule);
  if (requireEnabled && current && current.enabled === false) {
    return null;
  }

  const pinnedSha = options.pinnedSha || (options.source && options.source.sha) || '';
  if (pinnedSha) {
    const pinned = selectPinnedCachedVersion(
      listCachedGrokVersions(homeDir, pathModule),
      pinnedSha
    );
    if (pinned && isCompleteRoot(pinned.installedRoot, options.probe, pathModule)) {
      return pinned.installedRoot;
    }
  }

  if (current && current.installedRoot && isCompleteRoot(current.installedRoot, options.probe, pathModule)) {
    return current.installedRoot;
  }

  return findRootInGrokHome(homeDir, options.probe, pathModule);
}

function listCachedGrokVersions(homeDir, pathModule = path) {
  const versions = [];
  const cacheBase = pathModule.join(grokHomeDir(homeDir, pathModule), 'plugins', 'cache', CURRENT_PLUGIN_SLUG);
  try {
    const orgDirs = fs.readdirSync(cacheBase, { withFileTypes: true });
    for (const orgEntry of orgDirs) {
      if (!orgEntry.isDirectory()) continue;
      const orgPath = pathModule.join(cacheBase, orgEntry.name);
      const versionDirs = fs.readdirSync(orgPath, { withFileTypes: true });
      for (const verEntry of versionDirs) {
        if (!verEntry.isDirectory()) continue;
        const installedRoot = pathModule.join(orgPath, verEntry.name);
        const identity = readJsonIfPresent(pathModule.join(installedRoot, SOURCE_IDENTITY_FILE));
        versions.push({
          org: orgEntry.name,
          version: verEntry.name,
          installedRoot,
          sha: identity && identity.sha,
        });
      }
    }
  } catch {
    return versions;
  }
  return versions;
}

function selectPinnedCachedVersion(versions, sha) {
  if (!SHA_PATTERN.test(sha || '')) {
    return null;
  }
  return versions.find((entry) => entry.sha === sha) || null;
}

function capabilityConsented(consent, capability) {
  if (!consent || typeof consent !== 'object') {
    return false;
  }
  if (capability.kind === 'hooks') {
    return consent.hooks === true;
  }
  if (capability.kind === 'mcp') {
    const mcp = consent.mcp && typeof consent.mcp === 'object' ? consent.mcp : {};
    return mcp[capability.id] === true;
  }
  return false;
}

function previewInstall(options = {}) {
  const pathModule = options.pathModule || path;
  const source = assertPinnedSource(options.source);
  const trust = options.trust === true;
  const consent = options.consent && typeof options.consent === 'object' ? options.consent : {};
  const mcpCapabilities = listMcpCapabilities(options.mcpConfig || {});
  const capabilities = [
    { id: HOOKS_CAPABILITY_ID, kind: 'hooks' },
    ...mcpCapabilities,
  ].map((capability) => {
    const consented = trust && capabilityConsented(consent, capability);
    return {
      ...capability,
      consented,
    };
  });

  const mcpAttached = capabilities
    .filter((capability) => capability.kind === 'mcp' && capability.consented)
    .map((capability) => capability.id);
  const hooksEnabled = capabilities.some(
    (capability) => capability.id === HOOKS_CAPABILITY_ID && capability.consented
  );

  return {
    kind: 'grok-install-plan',
    pluginId: options.pluginId || CURRENT_PLUGIN_SLUG,
    version: options.version || null,
    trust,
    enabled: options.enabled !== false,
    source,
    identity: sourceIdentity(source),
    capabilities,
    hooksEnabled,
    mcpAttached,
    attachRootMcp: mcpAttached.length > 0,
    attachChromeDevtools: mcpAttached.includes(CHROME_DEVTOOLS_MCP),
    homeDir: options.homeDir,
    sourceRoot: options.sourceRoot || null,
    pathModule: pathModule === path.win32 ? 'win32' : 'posix',
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function filterMcpConfig(mcpConfig, attachedNames) {
  const servers = mcpConfig && mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object'
    ? mcpConfig.mcpServers
    : {};
  const mcpServers = {};
  for (const name of attachedNames) {
    if (servers[name]) {
      mcpServers[name] = servers[name];
    }
  }
  return { mcpServers };
}

const SHARED_INLINE_ENV = 'process.env.PLUGIN_ROOT||process.env.CLAUDE_PLUGIN_ROOT||process.env.ECC_PLUGIN_ROOT';
const INSTALLED_INLINE_ENV = `${SHARED_INLINE_ENV}||process.env.GROK_PLUGIN_ROOT`;

function applyInstalledHookBoundary(dest, pathModule) {
  const mapped = toSharedPluginEnv({ GROK_PLUGIN_ROOT: dest });
  writeJson(pathModule.join(dest, '.grok-plugin', 'shared-env.json'), {
    PLUGIN_ROOT: mapped.PLUGIN_ROOT,
  });
  const destHooks = pathModule.join(dest, 'hooks', 'hooks.json');
  if (!fs.existsSync(destHooks)) {
    return;
  }
  const text = fs.readFileSync(destHooks, 'utf8');
  fs.writeFileSync(destHooks, text.split(SHARED_INLINE_ENV).join(INSTALLED_INLINE_ENV));
}

function applyInstall(plan, options = {}) {
  if (!plan || plan.kind !== 'grok-install-plan') {
    throw new Error('applyInstall requires a grok-install-plan');
  }
  const pathModule = options.pathModule || path;
  const homeDir = plan.homeDir || options.homeDir;
  if (!homeDir) {
    throw new Error('homeDir is required to apply a Grok install');
  }
  const dest = installDestination(homeDir, plan, pathModule);

  if (!plan.sourceRoot) {
    throw new Error('sourceRoot is required to apply a Grok install');
  }
  assertSourceIdentity(plan.sourceRoot, plan.source, pathModule);

  fs.mkdirSync(dest, { recursive: true });
  copyInstallSource(plan.sourceRoot, dest, pathModule, plan.source.sha);
  writeJson(pathModule.join(dest, SOURCE_IDENTITY_FILE), plan.source);
  writePinnedMarketplace(dest, plan.source, pathModule);
  writeJson(
    pathModule.join(dest, '.mcp.json'),
    filterMcpConfig(options.mcpConfig || plan.mcpConfig, plan.mcpAttached)
  );

  if (!plan.hooksEnabled) {
    fs.rmSync(pathModule.join(dest, 'hooks'), { recursive: true, force: true });
  } else {
    applyInstalledHookBoundary(dest, pathModule);
  }

  const now = options.now || new Date().toISOString();
  const statePath = grokInstallStatePath(homeDir, pathModule);
  const previousPath = grokPreviousStatePath(homeDir, pathModule);
  if (fs.existsSync(statePath)) {
    fs.mkdirSync(pathModule.dirname(previousPath), { recursive: true });
    fs.copyFileSync(statePath, previousPath);
  }

  writeGrokInstallState(homeDir, plan, dest, now, pathModule);
  const receipt = loadCurrentReceipt(homeDir, pathModule);
  receipt.operation = fs.existsSync(previousPath) ? 'upgrade' : 'install';
  receipt.trust = plan.trust === true;
  return receipt;
}

function uninstall(homeDir, options = {}) {
  const pathModule = options.pathModule || path;
  const current = loadCurrentReceipt(homeDir, pathModule);
  if (!current) {
    return { operation: 'uninstall', removed: false };
  }
  const managedRoots = listManagedInstallRoots(homeDir, pathModule);
  for (const installedRoot of managedRoots) {
    fs.rmSync(installedRoot, { recursive: true, force: true });
  }
  const statePath = grokInstallStatePath(homeDir, pathModule);
  const previousPath = grokPreviousStatePath(homeDir, pathModule);
  fs.rmSync(statePath, { force: true });
  fs.rmSync(previousPath, { force: true });
  return {
    ...current,
    enabled: false,
    operation: 'uninstall',
    removedRoots: managedRoots,
    uninstalledAt: options.now || new Date().toISOString(),
  };
}

function rollback(homeDir, options = {}) {
  const pathModule = options.pathModule || path;
  const current = loadCurrentReceipt(homeDir, pathModule);
  const previousPath = grokPreviousStatePath(homeDir, pathModule);
  if (!current || !fs.existsSync(previousPath)) {
    throw new Error('no previous receipt to roll back to');
  }
  const previousState = readInstallState(previousPath);
  const previousReceipt = receiptFromInstallState(previousState);
  if (!previousReceipt.installedRoot || !fs.existsSync(previousReceipt.installedRoot)) {
    throw new Error('previous install is not available for rollback');
  }
  const statePath = grokInstallStatePath(homeDir, pathModule);
  fs.copyFileSync(previousPath, statePath);
  fs.rmSync(previousPath, { force: true });
  if (current.installedRoot && current.installedRoot !== previousReceipt.installedRoot) {
    fs.rmSync(current.installedRoot, { recursive: true, force: true });
  }
  return {
    ...loadCurrentReceipt(homeDir, pathModule),
    operation: 'rollback',
    rolledBackFrom: current.id,
  };
}

function setPluginEnabled(homeDir, enabled, options = {}) {
  const pathModule = options.pathModule || path;
  const statePath = grokInstallStatePath(homeDir, pathModule);
  if (!fs.existsSync(statePath)) {
    throw new Error('no current Grok install to enable or disable');
  }
  const state = readInstallState(statePath);
  const next = createInstallState({
    installedAt: state.installedAt,
    adapter: {
      id: state.target.id,
      target: state.target.target,
      kind: state.target.kind,
    },
    targetRoot: state.target.root,
    installStatePath: state.target.installStatePath,
    request: {
      ...state.request,
      modules: enabled ? [CURRENT_PLUGIN_SLUG] : [],
    },
    resolution: {
      selectedModules: enabled ? [CURRENT_PLUGIN_SLUG] : [],
      skippedModules: enabled ? [] : [CURRENT_PLUGIN_SLUG],
    },
    source: state.source,
    operations: state.operations,
  });
  writeInstallState(statePath, next);
  return loadCurrentReceipt(homeDir, pathModule);
}

function parseMcpConsentList(raw) {
  const mcp = {};
  String(raw || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .forEach((name) => {
      mcp[name] = true;
    });
  return mcp;
}

function resolveRepoRoot(candidate) {
  const start = candidate || path.join(__dirname, '..', '..');
  try {
    const { execFileSync } = require('child_process');
    return execFileSync('git', ['-C', start, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return start;
  }
}

function runGrokInstall(options = {}) {
  const repoRoot = resolveRepoRoot(options.repoRoot || path.join(__dirname, '..', '..'));
  const homeDir = options.homeDir || resolveHomeDir();
  const marketplace = readMarketplaceSource(path.join(repoRoot, '.grok-plugin', 'marketplace.json'));
  const pluginManifest = readGrokPluginManifest(path.join(repoRoot, '.grok-plugin', 'plugin.json'));
  let mcpConfig = { mcpServers: {} };
  try {
    mcpConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, '.mcp.json'), 'utf8'));
  } catch {
    mcpConfig = { mcpServers: {} };
  }

  const plan = previewInstall({
    source: marketplace.source,
    version: marketplace.version,
    sourceRoot: repoRoot,
    homeDir,
    trust: options.trust === true,
    consent: options.consent && typeof options.consent === 'object' ? options.consent : {},
    mcpConfig,
    enabled: true,
  });

  const result = {
    kind: 'grok-install-result',
    dryRun: options.dryRun === true,
    plan,
    nativeMcpOptedOut: nativePluginMcpOptedOut(pluginManifest),
    nativeHooksOptedOut: pluginManifest.hooks === '',
  };

  if (options.dryRun) {
    return result;
  }

  result.receipt = applyInstall(plan, { mcpConfig, homeDir });
  return result;
}

module.exports = {
  GROK_PLUGIN_ROOT_ENV,
  GROK_HOME_DIRNAME,
  SOURCE_IDENTITY_FILE,
  SHA_PATTERN,
  HOOKS_CAPABILITY_ID,
  CHROME_DEVTOOLS_MCP,
  grokPluginRootFromEnv,
  toSharedPluginEnv,
  nativePluginMcpOptedOut,
  nativeTrustedMcpServerNames,
  nativeTrustedInstallAttachesChromeDevtools,
  readGrokPluginManifest,
  resolveHomeDir,
  grokHomeDir,
  grokInstallStatePath,
  isContained,
  assertRootContainment,
  assertPinnedSource,
  sourceIdentity,
  readMarketplaceSource,
  listMcpCapabilities,
  resolveGrokPluginRoot,
  listCachedGrokVersions,
  selectPinnedCachedVersion,
  installDestination,
  readInstalledSharedEnv,
  listManagedInstallRoots,
  planToOperations,
  previewInstall,
  applyInstall,
  uninstall,
  rollback,
  setPluginEnabled,
  loadCurrentReceipt,
  parseMcpConsentList,
  resolveRepoRoot,
  runGrokInstall,
  isGitWorkTreeRoot,
  resolvePinnedGitSha,
  assertSourceIdentity,
};
