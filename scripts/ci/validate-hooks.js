#!/usr/bin/env node
/**
 * Validate hooks.json schema and hook entry rules.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Ajv = require('ajv');

/**
 * Resolve a module by its repo-relative path.
 *
 * Test harnesses copy this validator to the repo root before running it, so a
 * plain relative require would break. Walk up from __dirname until the module
 * is found instead.
 *
 * @param {string} repoRelativePath - e.g. 'scripts/lib/hooks-config.js'
 * @returns {string} absolute path to the module
 */
function resolveRepoModule(repoRelativePath) {
  let dir = __dirname;
  for (;;) {
    const candidate = path.join(dir, repoRelativePath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Cannot locate ${repoRelativePath} above ${__dirname}`);
    }
    dir = parent;
  }
}

const {
  METADATA_FILENAME,
  applyHooksMetadata,
  findMetadataMismatches,
  metadataPathFor,
  withRefreshedFingerprints,
} = require(resolveRepoModule('scripts/lib/hooks-config.js'));

const HOOKS_FILE = path.join(__dirname, '../../hooks/hooks.json');
const HOOKS_SCHEMA_PATH = path.join(__dirname, '../../schemas/hooks.schema.json');
const METADATA_SCHEMA_PATH = path.join(__dirname, '../../schemas/hooks-metadata.schema.json');
// `--update-fingerprints` rewrites the sidecar's fingerprints from the current
// hooks.json instead of validating. Run it after changing a hook command.
const UPDATE_FINGERPRINTS = process.argv.includes('--update-fingerprints');
// Keys Claude Code's own hooks schema rejects. Keeping them out of hooks.json is
// what stops "unknown keys ... ignored" warnings when the plugin loads.
const HARNESS_UNKNOWN_ROOT_KEYS = ['$schema'];
const HARNESS_UNKNOWN_MATCHER_KEYS = ['id', 'description'];
const VALID_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'SubagentStart',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'InstructionsLoaded',
  'TeammateIdle',
  'TaskCompleted',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'SessionEnd',
];
const VALID_HOOK_TYPES = ['command', 'http', 'prompt', 'agent'];
const EVENTS_WITHOUT_MATCHER = new Set(['UserPromptSubmit', 'Notification', 'Stop', 'SubagentStop']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(item => isNonEmptyString(item));
}

function isStringRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every(item => typeof item === 'string');
}

const INLINE_ESCAPES = { '\\': '\\', '"': '"', n: '\n', t: '\t' };

/** Unescape a shell double-quoted `node -e` body in one pass, so `\\n` stays a literal backslash and n. */
function unescapeInlineJs(source) {
  return source.replace(/\\(["\\nt])/g, (match, ch) => INLINE_ESCAPES[ch]);
}

/**
 * Compile the inline program of a `node -e "..."` command so a typo in
 * hooks.json fails validation instead of every hook invocation.
 * @returns {boolean} true if errors were found
 */
function validateInlineJs(command, label) {
  const nodeEMatch = command.match(/^node -e "((?:[^"\\]|\\.)*)"(?:\s|$)/s);
  if (!nodeEMatch) return false;
  try {
    new vm.Script(unescapeInlineJs(nodeEMatch[1]));
    return false;
  } catch (syntaxErr) {
    console.error(`ERROR: ${label} has invalid inline JS: ${syntaxErr.message}`);
    return true;
  }
}

/** @returns {boolean} true if errors were found */
function validateCommandHook(hook, label) {
  let hasErrors = false;

  if ('async' in hook && typeof hook.async !== 'boolean') {
    console.error(`ERROR: ${label} 'async' must be a boolean`);
    hasErrors = true;
  }

  if (!isNonEmptyString(hook.command) && !isNonEmptyStringArray(hook.command)) {
    console.error(`ERROR: ${label} missing or invalid 'command' field`);
    hasErrors = true;
  } else if (typeof hook.command === 'string' && validateInlineJs(hook.command, label)) {
    hasErrors = true;
  }

  return hasErrors;
}

/** @returns {boolean} true if errors were found */
function validateHttpHook(hook, label) {
  let hasErrors = false;

  if (!isNonEmptyString(hook.url)) {
    console.error(`ERROR: ${label} missing or invalid 'url' field`);
    hasErrors = true;
  }

  if ('headers' in hook && !isStringRecord(hook.headers)) {
    console.error(`ERROR: ${label} 'headers' must be an object with string values`);
    hasErrors = true;
  }

  if ('allowedEnvVars' in hook && (!Array.isArray(hook.allowedEnvVars) || !hook.allowedEnvVars.every(value => isNonEmptyString(value)))) {
    console.error(`ERROR: ${label} 'allowedEnvVars' must be an array of strings`);
    hasErrors = true;
  }

  return hasErrors;
}

/** prompt and agent hooks share one shape. @returns {boolean} true if errors were found */
function validatePromptHook(hook, label) {
  let hasErrors = false;

  if (!isNonEmptyString(hook.prompt)) {
    console.error(`ERROR: ${label} missing or invalid 'prompt' field`);
    hasErrors = true;
  }

  if ('model' in hook && !isNonEmptyString(hook.model)) {
    console.error(`ERROR: ${label} 'model' must be a non-empty string`);
    hasErrors = true;
  }

  return hasErrors;
}

/**
 * Validate a single hook entry has required fields and valid inline JS
 * @param {object} hook - Hook object with type and command fields
 * @param {string} label - Label for error messages (e.g., "PreToolUse[0].hooks[1]")
 * @returns {boolean} true if errors were found
 */
function validateHookEntry(hook, label) {
  let hasErrors = false;

  if (!hook.type || typeof hook.type !== 'string') {
    console.error(`ERROR: ${label} missing or invalid 'type' field`);
    hasErrors = true;
  } else if (!VALID_HOOK_TYPES.includes(hook.type)) {
    console.error(`ERROR: ${label} has unsupported hook type '${hook.type}'`);
    hasErrors = true;
  }

  if ('timeout' in hook && (typeof hook.timeout !== 'number' || hook.timeout < 0)) {
    console.error(`ERROR: ${label} 'timeout' must be a non-negative number`);
    hasErrors = true;
  }

  if (hook.type === 'command') {
    return validateCommandHook(hook, label) || hasErrors;
  }

  if ('async' in hook) {
    console.error(`ERROR: ${label} 'async' is only supported for command hooks`);
    hasErrors = true;
  }

  if (hook.type === 'http') {
    return validateHttpHook(hook, label) || hasErrors;
  }

  return validatePromptHook(hook, label) || hasErrors;
}

/**
 * Reject keys the Claude Code harness does not understand.
 *
 * Claude Code validates a plugin's hooks.json against its own schema and prints
 * every unrecognised key at load time. Once a hooks.metadata.json sidecar is
 * present it owns the stable ids and descriptions, so hooks.json must not
 * carry them as well.
 *
 * @param {object} data - Parsed hooks.json.
 * @returns {boolean} true if errors were found
 */
function validateHarnessCompatibility(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }

  let hasErrors = false;
  for (const key of HARNESS_UNKNOWN_ROOT_KEYS) {
    if (key in data) {
      console.error(
        `ERROR: hooks.json must not define "${key}" - Claude Code reports it as an unknown key`
      );
      hasErrors = true;
    }
  }

  const events = data.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks)
    ? data.hooks
    : {};
  for (const [eventType, matchers] of Object.entries(events)) {
    if (!Array.isArray(matchers)) continue;
    matchers.forEach((matcher, index) => {
      if (!matcher || typeof matcher !== 'object') return;
      for (const key of HARNESS_UNKNOWN_MATCHER_KEYS) {
        if (key in matcher) {
          console.error(
            `ERROR: hooks.json ${eventType}[${index}] must not define "${key}" - `
            + `move it to ${METADATA_FILENAME}`
          );
          hasErrors = true;
        }
      }
    });
  }

  return hasErrors;
}

/**
 * Validate a parsed document against a JSON schema file, if the schema exists.
 *
 * @param {object} document - Parsed JSON to validate.
 * @param {string} schemaPath - Path to the schema; skipped when absent.
 * @param {string} label - Name used in error output.
 * @returns {boolean} true if errors were found
 */
function validateAgainstSchema(document, schemaPath, label) {
  if (!fs.existsSync(schemaPath)) {
    return false;
  }
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  if (validate(document)) {
    return false;
  }
  for (const err of validate.errors) {
    console.error(`ERROR: ${label} schema: ${err.instancePath || '/'} ${err.message}`);
  }
  return true;
}

function isObjectFormat(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isValidMatcherValue(value) {
  return typeof value === 'string' || (typeof value === 'object' && value !== null);
}

function readHooksFile() {
  if (!fs.existsSync(HOOKS_FILE)) {
    console.log('No hooks.json found, skipping validation');
    process.exit(0);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(HOOKS_FILE, 'utf-8'));
  } catch (e) {
    console.error(`ERROR: Invalid JSON in hooks.json: ${e.message}`);
    process.exit(1);
  }
  return data;
}

/**
 * Load and check the hooks.metadata.json sidecar, if present.
 *
 * Without a sidecar, hooks.json keeps its legacy inline ids. With one, the
 * sidecar is the sole owner of id/description and hooks.json must stay
 * within Claude Code's schema. Exits the process on any sidecar error.
 *
 * @returns {object|null} parsed (and possibly refreshed) metadata, or null
 */
function loadMetadata(data, metadataPath) {
  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  } catch (e) {
    console.error(`ERROR: Invalid JSON in ${METADATA_FILENAME}: ${e.message}`);
    process.exit(1);
  }

  if (validateHarnessCompatibility(data)) {
    process.exit(1);
  }

  if (UPDATE_FINGERPRINTS) {
    try {
      metadata = withRefreshedFingerprints(data, metadata);
    } catch (error) {
      console.error(`ERROR: ${error.message}`);
      process.exit(1);
    }
  }

  if (validateAgainstSchema(metadata, METADATA_SCHEMA_PATH, METADATA_FILENAME)) {
    process.exit(1);
  }

  const mismatches = findMetadataMismatches(data, metadata);
  if (mismatches.length > 0) {
    for (const mismatch of mismatches) {
      console.error(`ERROR: ${mismatch}`);
    }
    process.exit(1);
  }

  return metadata;
}

/**
 * Validate each hook entry of one matcher.
 * @returns {boolean} true if errors were found
 */
function validateHookEntries(entries, label) {
  let hasErrors = false;
  for (let j = 0; j < entries.length; j++) {
    if (validateHookEntry(entries[j], `${label}.hooks[${j}]`)) {
      hasErrors = true;
    }
  }
  return hasErrors;
}

/**
 * Validate one matcher of the object format. `ids` tracks stable ids when the
 * document requires them, and is null otherwise.
 * @returns {boolean} true if errors were found
 */
function validateObjectMatcher(eventType, index, matcher, ids) {
  const matcherLabel = `${eventType}[${index}]`;
  let hasErrors = false;

  if (ids && !isNonEmptyString(matcher.id)) {
    console.error(`ERROR: ${matcherLabel} missing or invalid 'id' field`);
    hasErrors = true;
  } else if (ids && ids.has(matcher.id)) {
    console.error(
      `ERROR: ${matcherLabel} has duplicate id '${matcher.id}' (already used by ${ids.get(matcher.id)})`
    );
    hasErrors = true;
  } else if (ids) {
    ids.set(matcher.id, matcherLabel);
  }

  if (!('matcher' in matcher) && !EVENTS_WITHOUT_MATCHER.has(eventType)) {
    console.error(`ERROR: ${matcherLabel} missing 'matcher' field`);
    hasErrors = true;
  } else if ('matcher' in matcher && !isValidMatcherValue(matcher.matcher)) {
    console.error(`ERROR: ${matcherLabel} has invalid 'matcher' field`);
    hasErrors = true;
  }

  if (!matcher.hooks || !Array.isArray(matcher.hooks) || matcher.hooks.length === 0) {
    console.error(`ERROR: ${matcherLabel} missing 'hooks' array`);
    hasErrors = true;
  } else if (validateHookEntries(matcher.hooks, matcherLabel)) {
    hasErrors = true;
  }

  return hasErrors;
}

/**
 * Object format: { EventType: [matchers] }
 * @returns {{ hasErrors: boolean, totalMatchers: number }}
 */
function validateObjectFormat(hooks, requiresStableIds) {
  const ids = requiresStableIds ? new Map() : null;
  let hasErrors = false;
  let totalMatchers = 0;

  for (const [eventType, matchers] of Object.entries(hooks)) {
    if (!VALID_EVENTS.includes(eventType)) {
      console.error(`ERROR: Invalid event type: ${eventType}`);
      hasErrors = true;
      continue;
    }

    if (!Array.isArray(matchers)) {
      console.error(`ERROR: ${eventType} must be an array`);
      hasErrors = true;
      continue;
    }

    for (let i = 0; i < matchers.length; i++) {
      const matcher = matchers[i];
      if (typeof matcher !== 'object' || matcher === null) {
        console.error(`ERROR: ${eventType}[${i}] is not an object`);
        hasErrors = true;
        continue;
      }
      if (validateObjectMatcher(eventType, i, matcher, ids)) {
        hasErrors = true;
      }
      totalMatchers++;
    }
  }

  return { hasErrors, totalMatchers };
}

/** @returns {boolean} true if errors were found */
function validateLegacyHook(hook, index) {
  let hasErrors = false;

  if (!('matcher' in hook)) {
    console.error(`ERROR: Hook ${index} missing 'matcher' field`);
    hasErrors = true;
  } else if (!isValidMatcherValue(hook.matcher)) {
    console.error(`ERROR: Hook ${index} has invalid 'matcher' field`);
    hasErrors = true;
  }

  if (!hook.hooks || !Array.isArray(hook.hooks)) {
    console.error(`ERROR: Hook ${index} missing 'hooks' array`);
    hasErrors = true;
  } else if (validateHookEntries(hook.hooks, `Hook ${index}`)) {
    hasErrors = true;
  }

  return hasErrors;
}

/**
 * Array format (legacy): [{ matcher, hooks }]
 * @returns {{ hasErrors: boolean, totalMatchers: number }}
 */
function validateArrayFormat(hooks) {
  let hasErrors = false;
  for (let i = 0; i < hooks.length; i++) {
    if (validateLegacyHook(hooks[i], i)) {
      hasErrors = true;
    }
  }
  return { hasErrors, totalMatchers: hooks.length };
}

function validateHooks() {
  let data = readHooksFile();

  const metadataPath = metadataPathFor(HOOKS_FILE);
  const metadata = loadMetadata(data, metadataPath);
  if (metadata) {
    // Validate the merged view so the id/description rules below still apply.
    data = applyHooksMetadata(data, metadata);
  }

  // Validate against JSON schema
  if (validateAgainstSchema(data, HOOKS_SCHEMA_PATH, 'hooks.json')) {
    process.exit(1);
  }

  // Support both object format { hooks: {...} } and array format
  const hooks = data.hooks || data;
  const requiresStableIds = isObjectFormat(data) && isObjectFormat(data.hooks);

  let result;
  if (typeof hooks === 'object' && !Array.isArray(hooks)) {
    result = validateObjectFormat(hooks, requiresStableIds);
  } else if (Array.isArray(hooks)) {
    result = validateArrayFormat(hooks);
  } else {
    console.error('ERROR: hooks.json must be an object or array');
    process.exit(1);
  }

  if (result.hasErrors) {
    process.exit(1);
  }

  if (UPDATE_FINGERPRINTS && metadata) {
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(`Updated fingerprints in ${METADATA_FILENAME}`);
  }

  console.log(`Validated ${result.totalMatchers} hook matchers`);
}

validateHooks();
