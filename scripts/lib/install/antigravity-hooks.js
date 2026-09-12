'use strict';

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { writeFileAtomic } = require('../atomic-write');
const { runWithSettingsLock, sameFileIdentity } = require('./claude-settings-lock');

const ALLOWED_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'PreInvocation',
  'PostInvocation',
  'Stop',
]);
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);
const ANTIGRAVITY_HOOKS_FILENAME = 'hooks.json';
const ANTIGRAVITY_HOOK_RUNTIME_SOURCE_PATHS = Object.freeze([
  'scripts/hooks/antigravity-security.js',
  'scripts/hooks/block-no-verify.js',
  'scripts/hooks/config-protection.js',
  'scripts/hooks/gateguard-fact-force.js',
  'scripts/hooks/gateguard-heredoc.js',
  'scripts/lib/hook-flags.js',
  'scripts/lib/powershell-destructive-command.js',
  'scripts/lib/shell-substitution.js',
]);

function isJsonObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertOnlyKeys(value, allowedKeys, label) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Invalid ${label}: unsupported property ${JSON.stringify(key)}`);
    }
  }
}

function validateHookHandlers(handlers, label) {
  if (!Array.isArray(handlers) || handlers.length === 0) {
    throw new Error(`Invalid ${label}: hooks must be a non-empty array`);
  }
  for (const handler of handlers) {
    if (isJsonObject(handler)) {
      assertOnlyKeys(handler, new Set(['type', 'command', 'timeout']), label);
    }
    if (!isJsonObject(handler) || typeof handler.command !== 'string' || !handler.command.trim()) {
      throw new Error(`Invalid ${label}: command must be a non-empty string`);
    }
    if (handler.type !== 'command') {
      throw new Error(`Invalid ${label}: unsupported hook type`);
    }
    if (handler.timeout !== undefined && (!Number.isInteger(handler.timeout) || handler.timeout <= 0)) {
      throw new Error(`Invalid ${label}: timeout must be a positive integer`);
    }
  }
}

function validateHookEntry(entry, event, label) {
  if (!isJsonObject(entry)) {
    throw new Error(`Invalid ${label}: expected an object entry`);
  }
  if (TOOL_EVENTS.has(event)) {
    assertOnlyKeys(entry, new Set(['matcher', 'hooks']), label);
    if (typeof entry.matcher !== 'string' || !entry.matcher.trim()) {
      throw new Error(`Invalid ${label}: matcher must be a non-empty string`);
    }
  }
  validateHookHandlers(TOOL_EVENTS.has(event) ? entry.hooks : [entry], label);
}

function validateHookGroups(groups, label = 'Antigravity hook groups') {
  if (!isJsonObject(groups) || Object.keys(groups).length === 0) {
    throw new Error(`Invalid ${label}: expected a non-empty JSON object`);
  }
  for (const [name, group] of Object.entries(groups)) {
    if (!name.trim() || !isJsonObject(group)) {
      throw new Error(`Invalid ${label}: invalid hook group ${JSON.stringify(name)}`);
    }
    assertOnlyKeys(group, new Set(['enabled', ...ALLOWED_EVENTS]), `${label}.${name}`);
    if (group.enabled !== undefined && typeof group.enabled !== 'boolean') {
      throw new Error(`Invalid ${label}.${name}: enabled must be boolean`);
    }
    const events = Object.keys(group).filter(key => key !== 'enabled');
    if (events.length === 0) {
      throw new Error(`Invalid ${label}.${name}: expected at least one hook event`);
    }
    for (const [event, entries] of Object.entries(group)) {
      if (event === 'enabled') continue;
      if (!ALLOWED_EVENTS.has(event) || !Array.isArray(entries) || entries.length === 0) {
        throw new Error(`Invalid ${label}.${name}: invalid event ${JSON.stringify(event)}`);
      }
      for (const entry of entries) {
        validateHookEntry(entry, event, `${label}.${name}.${event}`);
      }
    }
  }
  return clone(groups);
}

function validateConfig(config, label = 'Antigravity hooks config') {
  if (!isJsonObject(config)) {
    throw new Error(`Invalid ${label}: expected a JSON object`);
  }
  return clone(config);
}

function getAntigravityHooksPath(targetRoot) {
  return path.join(targetRoot, ANTIGRAVITY_HOOKS_FILENAME);
}

function getAntigravityRuntimePath(targetRoot, sourceRelativePath) {
  const normalizedSource = String(sourceRelativePath || '').replace(/\\/g, '/');
  if (!ANTIGRAVITY_HOOK_RUNTIME_SOURCE_PATHS.includes(normalizedSource)) return null;
  return path.join(targetRoot, 'ecc-hooks', normalizedSource.replace(/^scripts\//, ''));
}

function assertAntigravityHooksPath(configPath, targetRoot) {
  const actual = path.resolve(configPath);
  const expected = path.resolve(getAntigravityHooksPath(targetRoot));
  const matches = process.platform === 'win32'
    ? actual.toLowerCase() === expected.toLowerCase()
    : actual === expected;
  if (!matches) {
    throw new Error(`Refusing to manage Antigravity hooks outside ${expected}`);
  }
}

function mergeManagedHookGroups(config, managedHookGroups, options = {}) {
  const current = validateConfig(config);
  const desired = validateHookGroups(managedHookGroups, 'managed Antigravity hook groups');
  const previous = options.previousManagedHookGroups
    ? validateHookGroups(options.previousManagedHookGroups, 'previous managed Antigravity hook groups')
    : null;
  const repair = options.repair === true;
  const next = { ...current };

  if (previous) {
    for (const [name, previousGroup] of Object.entries(previous)) {
      if (Object.prototype.hasOwnProperty.call(desired, name)) continue;
      if (!Object.prototype.hasOwnProperty.call(current, name)) continue;
      if (!isDeepStrictEqual(current[name], previousGroup)) {
        throw new Error(
          `Refusing to remove retired Antigravity hook group "${name}" because it has drifted`
        );
      }
      delete next[name];
    }
  }

  for (const [name, group] of Object.entries(desired)) {
    if (!Object.prototype.hasOwnProperty.call(current, name)) {
      next[name] = clone(group);
      continue;
    }
    const previousGroup = previous && previous[name];
    if (!previousGroup) {
      throw new Error(`Refusing to overwrite Antigravity hook group "${name}" because it is not an unchanged ECC-managed group`);
    }
    if (isDeepStrictEqual(current[name], group)) continue;
    const previouslyManaged = previousGroup && isDeepStrictEqual(current[name], previousGroup);
    if (!repair && !previouslyManaged) {
      throw new Error(`Refusing to overwrite Antigravity hook group "${name}" because the previous managed group has drifted`);
    }
    next[name] = clone(group);
  }

  return { config: next, managedHookGroups: clone(desired) };
}

function inspectManagedHookGroups(config, managedHookGroups) {
  const current = validateConfig(config);
  const expected = validateHookGroups(managedHookGroups, 'managed Antigravity hook groups');
  const matched = [];
  const missing = [];
  const drifted = [];
  for (const [name, group] of Object.entries(expected)) {
    if (!Object.prototype.hasOwnProperty.call(current, name)) {
      missing.push(name);
    } else if (isDeepStrictEqual(current[name], group)) {
      matched.push(name);
    } else {
      drifted.push(name);
    }
  }
  return {
    status: missing.length > 0 ? 'missing' : drifted.length > 0 ? 'drifted' : 'ok',
    matched,
    missing,
    drifted,
  };
}

function uninstallManagedHookGroups(config, managedHookGroups) {
  const current = validateConfig(config);
  const recorded = validateHookGroups(managedHookGroups, 'recorded Antigravity hook groups');
  const next = { ...current };
  const removed = [];
  const retained = [];
  const missing = [];

  for (const [name, group] of Object.entries(recorded)) {
    if (!Object.prototype.hasOwnProperty.call(current, name)) {
      missing.push(name);
    } else if (isDeepStrictEqual(current[name], group)) {
      delete next[name];
      removed.push(name);
    } else {
      retained.push(name);
    }
  }

  return { config: next, removed, retained, missing };
}

function readHookConfigSnapshot(configPath) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fs.openSync(configPath, flags);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { exists: false, raw: null, config: {}, mode: 0o600 };
    }
    throw error;
  }

  try {
    const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
    const pathStat = fs.lstatSync(configPath, { bigint: true });
    if (
      !descriptorStat.isFile()
      || !pathStat.isFile()
      || pathStat.isSymbolicLink()
      || !sameFileIdentity(descriptorStat, pathStat)
    ) {
      const error = new Error(`Refusing to read changed Antigravity hooks at ${configPath}`);
      error.code = 'ECC_ANTIGRAVITY_HOOKS_CHANGED';
      throw error;
    }
    const raw = fs.readFileSync(descriptor, 'utf8');
    let config;
    try {
      config = validateConfig(JSON.parse(raw), `Antigravity hooks at ${configPath}`);
    } catch (error) {
      throw new Error(`Failed to parse Antigravity hooks at ${configPath}: ${error.message}`);
    }
    return {
      exists: true,
      raw,
      config,
      mode: Number(descriptorStat.mode & 0o777n),
      dev: descriptorStat.dev,
      ino: descriptorStat.ino,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertSnapshotUnchanged(configPath, snapshot) {
  const current = readHookConfigSnapshot(configPath);
  if (
    current.exists !== snapshot.exists
    || current.raw !== snapshot.raw
    || (current.exists && (current.dev !== snapshot.dev || current.ino !== snapshot.ino))
  ) {
    const error = new Error(`Antigravity hooks changed during update: ${configPath}`);
    error.code = 'ECC_ANTIGRAVITY_HOOKS_CHANGED';
    throw error;
  }
}

function updateHookConfigAtomic(configPath, transform, options = {}) {
  const update = () => {
    if (typeof options.validateParent === 'function') options.validateParent();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const parentPath = path.dirname(path.resolve(configPath));
    const parentStats = fs.lstatSync(parentPath, { bigint: true });
    const validateParent = () => {
      if (typeof options.validateParent === 'function') options.validateParent();
      const current = fs.lstatSync(parentPath, { bigint: true });
      if (
        !current.isDirectory()
        || current.isSymbolicLink()
        || !sameFileIdentity(current, parentStats)
      ) {
        const error = new Error(`Antigravity hooks parent directory changed: ${parentPath}`);
        error.code = 'ECC_ANTIGRAVITY_HOOKS_PARENT_CHANGED';
        throw error;
      }
    };
    for (let attempt = 1; attempt <= (options.maxAttempts || 3); attempt += 1) {
      try {
        validateParent();
        const snapshot = readHookConfigSnapshot(configPath);
        const result = transform(snapshot.config);
        const config = validateConfig(result.config);
        if (typeof options.beforeCommit === 'function') options.beforeCommit();
        assertSnapshotUnchanged(configPath, snapshot);
        writeFileAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`, {
          encoding: 'utf8',
          mode: snapshot.mode,
          validateParent,
          beforeRename() {
            assertSnapshotUnchanged(configPath, snapshot);
          },
        });
        return { ...result, config };
      } catch (error) {
        if (error.code !== 'ECC_ANTIGRAVITY_HOOKS_CHANGED' || attempt === (options.maxAttempts || 3)) {
          throw error;
        }
      }
    }
    throw new Error(`Unable to update Antigravity hooks at ${configPath}`);
  };
  return options.lockHeld ? update() : runWithSettingsLock(configPath, update);
}

module.exports = {
  ANTIGRAVITY_HOOKS_FILENAME,
  ANTIGRAVITY_HOOK_RUNTIME_SOURCE_PATHS,
  assertAntigravityHooksPath,
  getAntigravityHooksPath,
  getAntigravityRuntimePath,
  inspectManagedHookGroups,
  mergeManagedHookGroups,
  readHookConfigSnapshot,
  uninstallManagedHookGroups,
  updateHookConfigAtomic,
  validateConfig,
  validateHookGroups,
};
