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
    if ('async' in hook && typeof hook.async !== 'boolean') {
      console.error(`ERROR: ${label} 'async' must be a boolean`);
      hasErrors = true;
    }

    if (!isNonEmptyString(hook.command) && !isNonEmptyStringArray(hook.command)) {
      console.error(`ERROR: ${label} missing or invalid 'command' field`);
      hasErrors = true;
    } else if (typeof hook.command === 'string') {
      const nodeEMatch = hook.command.match(/^node -e "((?:[^"\\]|\\.)*)"(?:\s|$)/s);
      if (nodeEMatch) {
        try {
          new vm.Script(nodeEMatch[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t'));
        } catch (syntaxErr) {
          console.error(`ERROR: ${label} has invalid inline JS: ${syntaxErr.message}`);
          hasErrors = true;
        }
      }
    }

    return hasErrors;
  }

  if ('async' in hook) {
    console.error(`ERROR: ${label} 'async' is only supported for command hooks`);
    hasErrors = true;
  }

  if (hook.type === 'http') {
    if (!isNonEmptyString(hook.url)) {
      console.error(`ERROR: ${label} missing or invalid 'url' field`);
      hasErrors = true;
    }

    if ('headers' in hook && (typeof hook.headers !== 'object' || hook.headers === null || Array.isArray(hook.headers) || !Object.values(hook.headers).every(value => typeof value === 'string'))) {
      console.error(`ERROR: ${label} 'headers' must be an object with string values`);
      hasErrors = true;
    }

    if ('allowedEnvVars' in hook && (!Array.isArray(hook.allowedEnvVars) || !hook.allowedEnvVars.every(value => isNonEmptyString(value)))) {
      console.error(`ERROR: ${label} 'allowedEnvVars' must be an array of strings`);
      hasErrors = true;
    }

    return hasErrors;
  }

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

function validateHooks() {
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

  // Without a sidecar, hooks.json keeps its legacy inline ids. With one, the
  // sidecar is the sole owner of id/description and hooks.json must stay
  // within Claude Code's schema.
  let metadata = null;
  const metadataPath = metadataPathFor(HOOKS_FILE);
  if (fs.existsSync(metadataPath)) {
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

    // Validate the merged view so the id/description rules below still apply.
    data = applyHooksMetadata(data, metadata);
  }

  // Validate against JSON schema
  if (validateAgainstSchema(data, HOOKS_SCHEMA_PATH, 'hooks.json')) {
    process.exit(1);
  }

  // Support both object format { hooks: {...} } and array format
  const hooks = data.hooks || data;
  const requiresStableIds = Boolean(
    data
    && typeof data === 'object'
    && !Array.isArray(data)
    && data.hooks
    && typeof data.hooks === 'object'
    && !Array.isArray(data.hooks)
  );
  let hasErrors = false;
  let totalMatchers = 0;
  const matcherIdLocations = new Map();

  if (typeof hooks === 'object' && !Array.isArray(hooks)) {
    // Object format: { EventType: [matchers] }
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
        const matcherLabel = `${eventType}[${i}]`;
        if (requiresStableIds && !isNonEmptyString(matcher.id)) {
          console.error(`ERROR: ${matcherLabel} missing or invalid 'id' field`);
          hasErrors = true;
        } else if (requiresStableIds && matcherIdLocations.has(matcher.id)) {
          console.error(
            `ERROR: ${matcherLabel} has duplicate id '${matcher.id}' (already used by ${matcherIdLocations.get(matcher.id)})`
          );
          hasErrors = true;
        } else if (requiresStableIds) {
          matcherIdLocations.set(matcher.id, matcherLabel);
        }
        if (!('matcher' in matcher) && !EVENTS_WITHOUT_MATCHER.has(eventType)) {
          console.error(`ERROR: ${matcherLabel} missing 'matcher' field`);
          hasErrors = true;
        } else if ('matcher' in matcher && typeof matcher.matcher !== 'string' && (typeof matcher.matcher !== 'object' || matcher.matcher === null)) {
          console.error(`ERROR: ${matcherLabel} has invalid 'matcher' field`);
          hasErrors = true;
        }
        if (!matcher.hooks || !Array.isArray(matcher.hooks) || matcher.hooks.length === 0) {
          console.error(`ERROR: ${matcherLabel} missing 'hooks' array`);
          hasErrors = true;
        } else {
          // Validate each hook entry
          for (let j = 0; j < matcher.hooks.length; j++) {
            if (validateHookEntry(matcher.hooks[j], `${matcherLabel}.hooks[${j}]`)) {
              hasErrors = true;
            }
          }
        }
        totalMatchers++;
      }
    }
  } else if (Array.isArray(hooks)) {
    // Array format (legacy)
    for (let i = 0; i < hooks.length; i++) {
      const hook = hooks[i];
      if (!('matcher' in hook)) {
        console.error(`ERROR: Hook ${i} missing 'matcher' field`);
        hasErrors = true;
      } else if (typeof hook.matcher !== 'string' && (typeof hook.matcher !== 'object' || hook.matcher === null)) {
        console.error(`ERROR: Hook ${i} has invalid 'matcher' field`);
        hasErrors = true;
      }
      if (!hook.hooks || !Array.isArray(hook.hooks)) {
        console.error(`ERROR: Hook ${i} missing 'hooks' array`);
        hasErrors = true;
      } else {
        // Validate each hook entry
        for (let j = 0; j < hook.hooks.length; j++) {
          if (validateHookEntry(hook.hooks[j], `Hook ${i}.hooks[${j}]`)) {
            hasErrors = true;
          }
        }
      }
      totalMatchers++;
    }
  } else {
    console.error('ERROR: hooks.json must be an object or array');
    process.exit(1);
  }

  if (hasErrors) {
    process.exit(1);
  }

  if (UPDATE_FINGERPRINTS && metadata) {
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(`Updated fingerprints in ${METADATA_FILENAME}`);
  }

  console.log(`Validated ${totalMatchers} hook matchers`);
}

validateHooks();
