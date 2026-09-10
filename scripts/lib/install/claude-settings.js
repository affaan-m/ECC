'use strict';

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { writeFileAtomic } = require('../atomic-write');
const { acquireSettingsLock, runWithSettingsLock } = require('./claude-settings-lock');

const CLAUDE_SETTINGS_FILENAME = 'settings.json';
const CLAUDE_HOOKS_CONFIG_PATH = 'hooks/hooks.json';
const PLUGIN_ROOT_PLACEHOLDER = '${CLAUDE_PLUGIN_ROOT}';
const PLUGIN_ROOT_ENV_PROLOGUE = 'var e=process.env.CLAUDE_PLUGIN_ROOT;';
const PLUGIN_ROOT_ENV_READ = /\bprocess\.env\.CLAUDE_PLUGIN_ROOT\b(?!\s*=)/;
const VALID_EVENTS = new Set([
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
  'PostToolUse', 'PostToolUseFailure', 'Notification', 'SubagentStart',
  'Stop', 'SubagentStop', 'PreCompact', 'InstructionsLoaded',
  'TeammateIdle', 'TaskCompleted', 'ConfigChange', 'WorktreeCreate',
  'WorktreeRemove', 'SessionEnd',
]);
const EVENTS_WITHOUT_MATCHER = new Set([
  'UserPromptSubmit', 'Notification', 'Stop', 'SubagentStop',
]);
const VALID_HOOK_TYPES = new Set(['command', 'http', 'prompt', 'agent']);

function isJsonObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, cloneValue(nestedValue)])
    );
  }
  return value;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function getClaudeSettingsPath(targetRoot) {
  return path.join(targetRoot, CLAUDE_SETTINGS_FILENAME);
}

function assertClaudeSettingsPath(destinationPath, trustedRoot) {
  const resolvedDestination = path.resolve(destinationPath);
  const resolvedExpected = path.resolve(getClaudeSettingsPath(trustedRoot));
  const pathsMatch = process.platform === 'win32'
    ? resolvedDestination.toLowerCase() === resolvedExpected.toLowerCase()
    : resolvedDestination === resolvedExpected;
  if (!pathsMatch) {
    throw new Error(
      `Refusing to manage Claude hooks outside the canonical settings file: ${destinationPath}`
    );
  }
}

function validateHookHandler(hook, label) {
  if (!isJsonObject(hook)) {
    throw new Error(`Invalid managed hook handler at ${label}: expected a JSON object`);
  }
  if (!VALID_HOOK_TYPES.has(hook.type)) {
    throw new Error(`Invalid managed hook handler at ${label}: unsupported type`);
  }
  if (hook.timeout !== undefined && (typeof hook.timeout !== 'number' || hook.timeout < 0)) {
    throw new Error(`Invalid managed hook handler at ${label}: invalid timeout`);
  }

  if (hook.type === 'command') {
    const validCommand = isNonEmptyString(hook.command)
      || (Array.isArray(hook.command)
        && hook.command.length > 0
        && hook.command.every(isNonEmptyString));
    if (!validCommand) {
      throw new Error(`Invalid managed hook handler at ${label}: invalid command`);
    }
    if (hook.async !== undefined && typeof hook.async !== 'boolean') {
      throw new Error(`Invalid managed hook handler at ${label}: invalid async flag`);
    }
    return;
  }

  if (hook.async !== undefined) {
    throw new Error(`Invalid managed hook handler at ${label}: async requires command type`);
  }
  if (hook.type === 'http') {
    if (!isNonEmptyString(hook.url)) {
      throw new Error(`Invalid managed hook handler at ${label}: invalid url`);
    }
    if (
      hook.headers !== undefined
      && (!isJsonObject(hook.headers)
        || !Object.values(hook.headers).every(value => typeof value === 'string'))
    ) {
      throw new Error(`Invalid managed hook handler at ${label}: invalid headers`);
    }
    if (
      hook.allowedEnvVars !== undefined
      && (!Array.isArray(hook.allowedEnvVars)
        || !hook.allowedEnvVars.every(isNonEmptyString))
    ) {
      throw new Error(`Invalid managed hook handler at ${label}: invalid allowedEnvVars`);
    }
    return;
  }
  if (!isNonEmptyString(hook.prompt)) {
    throw new Error(`Invalid managed hook handler at ${label}: invalid prompt`);
  }
  if (hook.model !== undefined && !isNonEmptyString(hook.model)) {
    throw new Error(`Invalid managed hook handler at ${label}: invalid model`);
  }
}

function validateManagedHooks(managedHooks, label = 'managed hooks') {
  if (!isJsonObject(managedHooks)) {
    throw new Error(`Invalid ${label}: expected a JSON object`);
  }
  if (Object.keys(managedHooks).length === 0) {
    throw new Error(`Invalid ${label}: expected at least one hook event`);
  }

  const seenIds = new Set();
  for (const [event, entries] of Object.entries(managedHooks)) {
    if (!VALID_EVENTS.has(event)) {
      throw new Error(`Invalid ${label}: unsupported hook event "${event}"`);
    }
    if (!Array.isArray(entries)) {
      throw new Error(`Invalid ${label}.${event}: expected an array`);
    }
    if (entries.length === 0) {
      throw new Error(`Invalid ${label}.${event}: expected at least one hook entry`);
    }

    entries.forEach((entry, index) => {
      if (!isJsonObject(entry)) {
        throw new Error(
          `Invalid managed hook entry at ${label}.${event}[${index}]: expected a JSON object`
        );
      }
      if (typeof entry.id !== 'string' || entry.id.trim() === '') {
        throw new Error(
          `Invalid managed hook entry at ${label}.${event}[${index}]: `
          + 'expected a non-empty unique id'
        );
      }
      if (seenIds.has(entry.id)) {
        throw new Error(`Invalid ${label}: expected globally unique id "${entry.id}"`);
      }
      seenIds.add(entry.id);
      if (
        !Object.prototype.hasOwnProperty.call(entry, 'matcher')
        && !EVENTS_WITHOUT_MATCHER.has(event)
      ) {
        throw new Error(
          `Invalid managed hook entry at ${label}.${event}[${index}]: missing matcher`
        );
      }
      if (
        Object.prototype.hasOwnProperty.call(entry, 'matcher')
        && typeof entry.matcher !== 'string'
        && !isJsonObject(entry.matcher)
      ) {
        throw new Error(
          `Invalid managed hook entry at ${label}.${event}[${index}]: invalid matcher`
        );
      }
      if (!Array.isArray(entry.hooks) || entry.hooks.length === 0) {
        throw new Error(
          `Invalid managed hook entry at ${label}.${event}[${index}]: expected hooks`
        );
      }
      entry.hooks.forEach((hook, hookIndex) => {
        validateHookHandler(hook, `${label}.${event}[${index}].hooks[${hookIndex}]`);
      });
    });
  }

  return cloneValue(managedHooks);
}

function validateRecordedManagedHooks(managedHooks, label = 'recorded managed hooks') {
  if (!isJsonObject(managedHooks) || Object.keys(managedHooks).length === 0) {
    throw new Error(`Invalid ${label}: expected a non-empty JSON object`);
  }
  for (const [event, entries] of Object.entries(managedHooks)) {
    if (!isNonEmptyString(event) || !Array.isArray(entries) || entries.length === 0) {
      throw new Error(`Invalid ${label}.${event}: expected a non-empty hook array`);
    }
    const seenIds = new Set();
    entries.forEach((entry, index) => {
      if (!isJsonObject(entry) || !isNonEmptyString(entry.id) || !Array.isArray(entry.hooks)) {
        throw new Error(`Invalid hook entry at ${label}.${event}[${index}]`);
      }
      if (seenIds.has(entry.id)) {
        throw new Error(
          `Invalid ${label}: expected unique id "${entry.id}" within event "${event}"`
        );
      }
      seenIds.add(entry.id);
    });
  }
  return cloneValue(managedHooks);
}

function validateSettings(settings, label = 'Claude settings') {
  if (!isJsonObject(settings)) {
    throw new Error(`Invalid ${label}: expected a JSON object`);
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'hooks')) {
    if (!isJsonObject(settings.hooks)) {
      throw new Error(`Invalid ${label}: expected "hooks" to be a JSON object`);
    }
    for (const [event, entries] of Object.entries(settings.hooks)) {
      if (!Array.isArray(entries)) {
        throw new Error(`Invalid ${label}: expected hooks.${event} to be an array`);
      }
    }
  }

  return cloneValue(settings);
}

function replacePluginRootPlaceholders(value, pluginRoot) {
  if (typeof pluginRoot !== 'string') {
    throw new Error('Invalid Claude plugin root: expected a string');
  }
  if (typeof value === 'string') {
    return value.split(PLUGIN_ROOT_PLACEHOLDER).join(pluginRoot);
  }
  if (Array.isArray(value)) {
    return value.map(item => replacePluginRootPlaceholders(item, pluginRoot));
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        replacePluginRootPlaceholders(nestedValue, pluginRoot),
      ])
    );
  }
  return value;
}

function resolveManagedHookCommands(managedHooks, targetRoot) {
  const encodedRoot = Buffer.from(targetRoot, 'utf8').toString('base64');
  const rootExpression = `Buffer.from('${encodedRoot}','base64').toString('utf8')`;
  const resolveCommand = command => {
    // Leave invalid entries intact so managed-hook validation reports them.
    if (typeof command !== 'string') {
      return command;
    }
    const resolved = command
      .split(PLUGIN_ROOT_ENV_PROLOGUE)
      .join(`var e=${rootExpression};`);
    if (PLUGIN_ROOT_ENV_READ.test(resolved)) {
      throw new Error(
        'Unable to resolve CLAUDE_PLUGIN_ROOT in a managed hook command; '
        + 'the hooks.json command prologue no longer matches the expected form'
      );
    }
    return resolved;
  };
  return Object.fromEntries(
    Object.entries(managedHooks).map(([event, entries]) => [
      event,
      entries.map(entry => ({
        ...entry,
        hooks: entry.hooks.map(hook => ({
          ...hook,
          ...(typeof hook.command === 'string' || Array.isArray(hook.command)
            ? {
              command: Array.isArray(hook.command)
                ? hook.command.map(resolveCommand)
                : resolveCommand(hook.command),
            }
            : {}),
        })),
      })),
    ])
  );
}

function materializeManagedHooks(hooksConfig, targetRoot) {
  if (!isJsonObject(hooksConfig) || !isJsonObject(hooksConfig.hooks)) {
    throw new Error('Invalid hooks config: expected a JSON object with a hooks object');
  }
  if (!isNonEmptyString(targetRoot)) {
    throw new Error('Invalid Claude target root: expected a non-empty string');
  }
  return validateManagedHooks(resolveManagedHookCommands(
    replacePluginRootPlaceholders(hooksConfig.hooks, targetRoot),
    targetRoot
  ));
}

function parseSettings(rawSettings, label = 'Claude settings') {
  let settings;
  try {
    settings = JSON.parse(rawSettings);
  } catch (error) {
    throw new Error(`Failed to parse ${label}: ${error.message}`, { cause: error });
  }
  return validateSettings(settings, label);
}

function readSettings(settingsPath, fileSystem = fs) {
  const reader = fileSystem && fileSystem.fs ? fileSystem.fs : fileSystem;
  let rawSettings;
  try {
    rawSettings = reader.readFileSync(settingsPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
  return parseSettings(rawSettings, `Claude settings at ${settingsPath}`);
}

function readSettingsSnapshot(settingsPath) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fs.openSync(settingsPath, flags);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { exists: false, raw: null, settings: {}, mode: 0o600 };
    }
    throw error;
  }

  try {
    const descriptorStat = fs.fstatSync(descriptor);
    let pathStat;
    try {
      pathStat = fs.lstatSync(settingsPath);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        error.code = 'ECC_SETTINGS_CHANGED';
      }
      throw error;
    }
    if (
      !descriptorStat.isFile()
      || !pathStat.isFile()
      || pathStat.isSymbolicLink()
      || descriptorStat.dev !== pathStat.dev
      || descriptorStat.ino !== pathStat.ino
    ) {
      const error = new Error(`Refusing to read changed Claude settings at ${settingsPath}`);
      error.code = 'ECC_SETTINGS_CHANGED';
      throw error;
    }
    const raw = fs.readFileSync(descriptor, 'utf8');
    return {
      exists: true,
      raw,
      settings: parseSettings(raw, `Claude settings at ${settingsPath}`),
      mode: descriptorStat.mode & 0o777,
      dev: descriptorStat.dev,
      ino: descriptorStat.ino,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertSettingsSnapshotUnchanged(settingsPath, snapshot) {
  let current;
  try {
    current = readSettingsSnapshot(settingsPath);
  } catch (error) {
    error.code = error.code || 'ECC_SETTINGS_CHANGED';
    throw error;
  }
  const unchanged = current.exists === snapshot.exists
    && current.raw === snapshot.raw
    && (!current.exists || (current.dev === snapshot.dev && current.ino === snapshot.ino));
  if (!unchanged) {
    const error = new Error(`Claude settings changed during update: ${settingsPath}`);
    error.code = 'ECC_SETTINGS_CHANGED';
    throw error;
  }
}

function updateSettingsAtomic(settingsPath, transform, options = {}) {
  const update = () => {
    const parentPath = path.dirname(path.resolve(settingsPath));
    const parentStats = fs.lstatSync(parentPath, { bigint: true });
    const validateParent = () => {
      const current = fs.lstatSync(parentPath, { bigint: true });
      if (
        !current.isDirectory() || current.isSymbolicLink()
        || current.dev !== parentStats.dev || current.ino !== parentStats.ino
      ) {
        const error = new Error(`Claude settings parent directory changed: ${parentPath}`);
        error.code = 'ECC_SETTINGS_PARENT_CHANGED';
        throw error;
      }
    };
    const maxAttempts = options.maxAttempts || 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        validateParent();
        const snapshot = readSettingsSnapshot(settingsPath);
        const result = transform(snapshot.settings);
        if (typeof options.beforeCommit === 'function') options.beforeCommit();
        assertSettingsSnapshotUnchanged(settingsPath, snapshot);
        writeFileAtomic(
          settingsPath,
          `${JSON.stringify(result.settings, null, 2)}\n`,
          {
            encoding: 'utf8',
            mode: snapshot.mode,
            validateParent,
            beforeRename() {
              assertSettingsSnapshotUnchanged(settingsPath, snapshot);
            },
          }
        );
        return result;
      } catch (error) {
        if (error.code !== 'ECC_SETTINGS_CHANGED' || attempt === maxAttempts) {
          throw error;
        }
      }
    }
    throw new Error(`Unable to update Claude settings at ${settingsPath}`);
  };
  if (options.lockHeld) {
    return update();
  }
  return runWithSettingsLock(settingsPath, update);
}

function reference(event, id) {
  return { event, id };
}

function entriesMatchingId(entries, id) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(candidate => isJsonObject(candidate.entry) && candidate.entry.id === id);
}

function assertUnambiguousMatch(entries, event, id) {
  const matches = entriesMatchingId(entries, id);
  if (matches.length > 1) {
    throw new Error(
      `Claude settings contains multiple hooks for event "${event}" and id "${id}"`
    );
  }
  return matches[0] || null;
}

function managedEntryFor(managedHooks, event, id) {
  const entries = managedHooks && managedHooks[event];
  if (!Array.isArray(entries)) {
    return null;
  }
  return entries.find(entry => entry.id === id) || null;
}

function mergeManagedHooks(settings, managedHooks, options = {}) {
  const validatedSettings = validateSettings(settings);
  const desiredHooks = validateManagedHooks(managedHooks);
  const previousHooks = options.previousManagedHooks === undefined
    || options.previousManagedHooks === null
    ? null
    : validateRecordedManagedHooks(options.previousManagedHooks, 'previous managed hooks');
  const repair = options.mode === 'repair' || options.repair === true;
  if (options.mode !== undefined && options.mode !== 'merge' && options.mode !== 'repair') {
    throw new Error(`Unknown Claude settings merge mode: ${options.mode}`);
  }

  let nextHooks = validatedSettings.hooks
    ? cloneValue(validatedSettings.hooks)
    : {};
  const added = [];
  const updated = [];
  const unchanged = [];
  const removed = [];

  if (previousHooks) {
    for (const [event, previousEntries] of Object.entries(previousHooks)) {
      let eventEntries = nextHooks[event] ? cloneValue(nextHooks[event]) : [];
      for (const previousEntry of previousEntries) {
        if (managedEntryFor(desiredHooks, event, previousEntry.id)) continue;
        const match = assertUnambiguousMatch(eventEntries, event, previousEntry.id);
        if (!match) continue;
        if (!isDeepStrictEqual(match.entry, previousEntry)) {
          throw new Error(
            `Refusing to remove Claude hook for event "${event}" and id `
            + `"${previousEntry.id}" because the previous managed entry has drifted`
          );
        }
        eventEntries = eventEntries.filter((_entry, index) => index !== match.index);
        removed.push(reference(event, previousEntry.id));
      }
      nextHooks = eventEntries.length > 0
        ? { ...nextHooks, [event]: eventEntries }
        : withoutProperty(nextHooks, event);
    }
  }

  for (const [event, desiredEntries] of Object.entries(desiredHooks)) {
    let eventEntries = nextHooks[event] ? cloneValue(nextHooks[event]) : [];
    for (const desiredEntry of desiredEntries) {
      const match = assertUnambiguousMatch(eventEntries, event, desiredEntry.id);
      if (!match) {
        eventEntries = [...eventEntries, cloneValue(desiredEntry)];
        added.push(reference(event, desiredEntry.id));
        continue;
      }
      if (isDeepStrictEqual(match.entry, desiredEntry)) {
        unchanged.push(reference(event, desiredEntry.id));
        continue;
      }

      const previousEntry = managedEntryFor(previousHooks, event, desiredEntry.id);
      if (!repair && (!previousEntry || !isDeepStrictEqual(match.entry, previousEntry))) {
        const driftReason = previousEntry ? ' because the previous managed entry has drifted' : '';
        throw new Error(
          `Refusing to overwrite Claude hook for event "${event}" and id `
          + `"${desiredEntry.id}"${driftReason}`
        );
      }

      eventEntries = eventEntries.map((entry, index) => (
        index === match.index ? cloneValue(desiredEntry) : entry
      ));
      updated.push(reference(event, desiredEntry.id));
    }
    if (desiredEntries.length > 0) {
      nextHooks = { ...nextHooks, [event]: eventEntries };
    }
  }

  const nextSettings = Object.keys(nextHooks).length > 0
    ? { ...validatedSettings, hooks: nextHooks }
    : validatedSettings;
  return {
    settings: nextSettings,
    managedHooks: cloneValue(desiredHooks),
    added,
    updated,
    unchanged,
    removed,
  };
}

function repairManagedHooks(settings, managedHooks, options = {}) {
  return mergeManagedHooks(settings, managedHooks, {
    ...options,
    mode: 'repair',
  });
}

function inspectManagedHooks(settings, managedHooks) {
  const validatedSettings = validateSettings(settings);
  const expectedHooks = validateManagedHooks(managedHooks);
  const settingsHooks = validatedSettings.hooks || {};
  const managedSubset = {};
  const matched = [];
  const missing = [];
  const drifted = [];

  for (const [event, expectedEntries] of Object.entries(expectedHooks)) {
    const actualEntries = settingsHooks[event] || [];
    const foundEntries = [];
    for (const expectedEntry of expectedEntries) {
      const match = assertUnambiguousMatch(actualEntries, event, expectedEntry.id);
      if (!match) {
        missing.push(reference(event, expectedEntry.id));
        continue;
      }

      foundEntries.push(cloneValue(match.entry));
      if (isDeepStrictEqual(match.entry, expectedEntry)) {
        matched.push(reference(event, expectedEntry.id));
      } else {
        drifted.push({
          ...reference(event, expectedEntry.id),
          expected: cloneValue(expectedEntry),
          actual: cloneValue(match.entry),
        });
      }
    }
    if (foundEntries.length > 0) {
      managedSubset[event] = foundEntries;
    }
  }

  const ok = missing.length === 0 && drifted.length === 0;
  return {
    status: ok ? 'ok' : (missing.length > 0 ? 'missing' : 'drifted'),
    ok,
    managedHooks: managedSubset,
    matched,
    missing,
    drifted,
  };
}

function withoutProperty(object, omittedKey) {
  return Object.fromEntries(
    Object.entries(object).filter(([key]) => key !== omittedKey)
  );
}

function uninstallManagedHooks(settings, recordedManagedHooks) {
  const validatedSettings = validateSettings(settings);
  const recordedHooks = validateRecordedManagedHooks(recordedManagedHooks);
  const currentHooks = validatedSettings.hooks || {};

  for (const [event, recordedEntries] of Object.entries(recordedHooks)) {
    const eventEntries = currentHooks[event] || [];
    for (const recordedEntry of recordedEntries) {
      assertUnambiguousMatch(eventEntries, event, recordedEntry.id);
    }
  }

  const removed = [];
  const retained = [];
  const missing = [];
  let nextHooks = cloneValue(currentHooks);

  for (const [event, recordedEntries] of Object.entries(recordedHooks)) {
    let eventEntries = nextHooks[event] || [];
    for (const recordedEntry of recordedEntries) {
      const match = assertUnambiguousMatch(eventEntries, event, recordedEntry.id);
      if (!match) {
        missing.push(reference(event, recordedEntry.id));
        continue;
      }
      if (!isDeepStrictEqual(match.entry, recordedEntry)) {
        retained.push({
          ...reference(event, recordedEntry.id),
          expected: cloneValue(recordedEntry),
          actual: cloneValue(match.entry),
          reason: 'modified',
        });
        continue;
      }

      eventEntries = eventEntries.filter((_entry, index) => index !== match.index);
      removed.push(reference(event, recordedEntry.id));
    }
    nextHooks = eventEntries.length > 0
      ? { ...nextHooks, [event]: eventEntries }
      : withoutProperty(nextHooks, event);
  }

  nextHooks = Object.fromEntries(
    Object.entries(nextHooks).filter(([, entries]) => entries.length > 0)
  );
  const settingsWithoutHooks = withoutProperty(validatedSettings, 'hooks');
  const nextSettings = Object.keys(nextHooks).length > 0
    ? { ...settingsWithoutHooks, hooks: nextHooks }
    : settingsWithoutHooks;

  return {
    settings: nextSettings,
    removed,
    retained,
    missing,
  };
}

module.exports = {
  CLAUDE_HOOKS_CONFIG_PATH,
  CLAUDE_SETTINGS_FILENAME,
  acquireSettingsLock,
  assertClaudeSettingsPath,
  getClaudeSettingsPath,
  inspectManagedHooks,
  materializeManagedHooks,
  mergeManagedHooks,
  parseSettings,
  readSettings,
  repairManagedHooks,
  replacePluginRootPlaceholders,
  runWithSettingsLock,
  updateSettingsAtomic,
  uninstallManagedHooks,
  validateManagedHooks,
  validateRecordedManagedHooks,
  validateSettings,
};
