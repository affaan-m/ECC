'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const grokHomeTarget = require('./install-targets/grok-home');
const { SHA_PATTERN } = require('./grok-source-identity');

const GROK_PLUGIN_ROOT_ENV = 'GROK_PLUGIN_ROOT';
const GROK_HOME_DIRNAME = '.grok';
const SOURCE_IDENTITY_FILE = '.ecc-source.json';
const CURRENT_PLUGIN_SLUG = 'ecc';
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

function toSharedPluginEnv(env = {}) {
  const next = { ...env };
  const grokRoot = grokPluginRootFromEnv(env);
  delete next[GROK_PLUGIN_ROOT_ENV];
  if (grokRoot && !SHARED_PLUGIN_ROOT_KEYS.some((key) => trimEnv(next[key]))) {
    next.PLUGIN_ROOT = grokRoot;
  }
  return next;
}

function resolveHomeDir(env = process.env) {
  return trimEnv(env.ECC_GROK_HOME) || os.homedir();
}

function grokHomeDir(homeDir, pathModule = path) {
  return pathModule.join(homeDir, GROK_HOME_DIRNAME);
}

function grokInstallStatePath(homeDir, pathModule = path) {
  if (pathModule === path) return grokHomeTarget.getInstallStatePath({ homeDir });
  return pathModule.join(homeDir, GROK_HOME_DIRNAME, 'ecc', 'install-state.json');
}

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function isCompleteRoot(dir, probe, pathModule = path) {
  if (probe) return fs.existsSync(pathModule.join(dir, probe));
  return fs.existsSync(pathModule.join(dir, DEFAULT_SCRIPT_PROBE))
    && fs.existsSync(pathModule.join(dir, DEFAULT_SKILL_PROBE));
}

function listCachedGrokVersions(homeDir, pathModule = path) {
  const versions = [];
  const cacheBase = pathModule.join(grokHomeDir(homeDir, pathModule), 'plugins', 'cache', CURRENT_PLUGIN_SLUG);
  try {
    for (const orgEntry of fs.readdirSync(cacheBase, { withFileTypes: true })) {
      if (!orgEntry.isDirectory()) continue;
      const orgPath = pathModule.join(cacheBase, orgEntry.name);
      for (const versionEntry of fs.readdirSync(orgPath, { withFileTypes: true })) {
        if (!versionEntry.isDirectory()) continue;
        const installedRoot = pathModule.join(orgPath, versionEntry.name);
        const identity = readJsonIfPresent(pathModule.join(installedRoot, SOURCE_IDENTITY_FILE));
        versions.push({
          org: orgEntry.name,
          version: versionEntry.name,
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
  if (!SHA_PATTERN.test(sha || '')) return null;
  return versions.find((entry) => entry.sha === sha) || null;
}

function findRootInGrokHome(homeDir, probe, pathModule = path) {
  const grokRoot = grokHomeDir(homeDir, pathModule);
  const candidates = [
    pathModule.join(grokRoot, 'plugins', CURRENT_PLUGIN_SLUG),
    pathModule.join(grokRoot, 'plugins', `${CURRENT_PLUGIN_SLUG}@${CURRENT_PLUGIN_SLUG}`),
    pathModule.join(grokRoot, 'plugins', 'marketplaces', CURRENT_PLUGIN_SLUG),
  ];
  for (const candidate of candidates) {
    if (isCompleteRoot(candidate, probe, pathModule)) return candidate;
  }
  for (const dirname of ['installed-plugins', 'plugins']) {
    const base = pathModule.join(grokRoot, dirname);
    try {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = pathModule.join(base, entry.name);
        if (isCompleteRoot(candidate, probe, pathModule)) return candidate;
      }
    } catch {
      // Optional native discovery root.
    }
  }
  return null;
}

function resolveGrokPluginRoot(options = {}) {
  const pathModule = options.pathModule || path;
  const envRoot = options.envRoot !== undefined
    ? trimEnv(options.envRoot)
    : grokPluginRootFromEnv(options.env || {});
  if (envRoot) return envRoot;
  if (options.enabled === false) return null;

  const homeDir = options.homeDir || os.homedir();
  const pinnedSha = options.pinnedSha || (options.source && options.source.sha) || '';
  if (pinnedSha) {
    const pinned = selectPinnedCachedVersion(listCachedGrokVersions(homeDir, pathModule), pinnedSha);
    if (pinned && isCompleteRoot(pinned.installedRoot, options.probe, pathModule)) {
      return pinned.installedRoot;
    }
  }
  return findRootInGrokHome(homeDir, options.probe, pathModule);
}

module.exports = {
  GROK_PLUGIN_ROOT_ENV,
  GROK_HOME_DIRNAME,
  SOURCE_IDENTITY_FILE,
  grokPluginRootFromEnv,
  toSharedPluginEnv,
  resolveHomeDir,
  grokHomeDir,
  grokInstallStatePath,
  resolveGrokPluginRoot,
  listCachedGrokVersions,
  selectPinnedCachedVersion,
};
