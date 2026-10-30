'use strict';

/**
 * Read hooks/hooks.json together with its sibling hooks/hooks.metadata.json.
 *
 * Claude Code validates a plugin's hooks.json against its own schema and warns
 * about every key it does not recognise, so ECC's stable matcher ids and
 * human-readable descriptions cannot live in that file. They are kept in a
 * sidecar keyed by event name and aligned with hooks.json entry order, and
 * merged back here so the rest of ECC keeps seeing one object with `id` and
 * `description` on each matcher entry.
 *
 * Index alignment alone cannot tell a reordered hooks.json from a correct one,
 * so every sidecar entry also carries a fingerprint of the matcher entry it
 * describes. A mismatch means the two files drifted apart.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HOOKS_FILENAME = 'hooks.json';
const METADATA_FILENAME = 'hooks.metadata.json';
const FINGERPRINT_LENGTH = 12;
const FINGERPRINT_PATTERN = /^[0-9a-f]{12}$/;

function readJsonObject(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${filePath}: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} at ${filePath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid ${label} at ${filePath}: expected a JSON object`);
  }

  return parsed;
}

function metadataPathFor(hooksPath) {
  return path.join(path.dirname(hooksPath), METADATA_FILENAME);
}

/**
 * JSON.stringify with object keys sorted, so a fingerprint does not change when
 * someone reorders the keys inside a hook object.
 */
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      key => `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Fingerprint the parts of a hooks.json matcher entry that identify it: its
 * matcher and its hook commands. Ids and descriptions are excluded so the
 * fingerprint is the same whether or not metadata has been merged in.
 *
 * @param {object} entry - A matcher entry from hooks.json.
 * @returns {string} short hex digest
 */
function fingerprintHookEntry(entry) {
  const subject = {
    matcher: entry && 'matcher' in entry ? entry.matcher : null,
    hooks: entry && Array.isArray(entry.hooks) ? entry.hooks : [],
  };
  return crypto.createHash('sha256')
    .update(stableStringify(subject))
    .digest('hex')
    .slice(0, FINGERPRINT_LENGTH);
}

function eventsOf(hooksConfig) {
  return hooksConfig && typeof hooksConfig.hooks === 'object' && hooksConfig.hooks
    && !Array.isArray(hooksConfig.hooks)
    ? hooksConfig.hooks
    : null;
}

function metadataEntriesOf(metadata) {
  return metadata && typeof metadata.entries === 'object' && metadata.entries
    && !Array.isArray(metadata.entries)
    ? metadata.entries
    : null;
}

/**
 * Merge sidecar metadata into a parsed hooks.json object.
 *
 * Neither argument is mutated; the returned config shares untouched matcher
 * entries with the input and copies the ones that receive metadata.
 *
 * @param {object} hooksConfig - Parsed hooks.json.
 * @param {object|null} metadata - Parsed hooks.metadata.json, or null when absent.
 * @returns {object} a new hooks configuration with id/description restored.
 */
function applyHooksMetadata(hooksConfig, metadata) {
  const events = eventsOf(hooksConfig);
  const entriesByEvent = metadataEntriesOf(metadata);
  if (!events || !entriesByEvent) {
    return hooksConfig;
  }

  const mergedEvents = {};
  for (const [event, entries] of Object.entries(events)) {
    const eventMetadata = entriesByEvent[event];
    if (!Array.isArray(entries) || !Array.isArray(eventMetadata)) {
      mergedEvents[event] = entries;
      continue;
    }

    mergedEvents[event] = entries.map((entry, index) => {
      const entryMetadata = eventMetadata[index];
      if (!entry || typeof entry !== 'object') return entry;
      if (!entryMetadata || typeof entryMetadata !== 'object') return entry;

      const merged = { ...entry };
      if (typeof entryMetadata.id === 'string' && !('id' in entry)) {
        merged.id = entryMetadata.id;
      }
      if (typeof entryMetadata.description === 'string' && !('description' in entry)) {
        merged.description = entryMetadata.description;
      }
      return merged;
    });
  }

  return { ...hooksConfig, hooks: mergedEvents };
}

/**
 * Report entries whose metadata is missing, misaligned, or bound to a
 * different matcher entry than the one at the same index.
 *
 * @param {object} hooksConfig - Parsed hooks.json.
 * @param {object|null} metadata - Parsed hooks.metadata.json.
 * @returns {string[]} human-readable problems; empty when the sidecar lines up.
 */
function findMetadataMismatches(hooksConfig, metadata) {
  const problems = [];
  const idLocations = new Map();
  const events = eventsOf(hooksConfig) || {};
  const entriesByEvent = metadataEntriesOf(metadata) || {};

  for (const [event, entries] of Object.entries(events)) {
    if (!Array.isArray(entries)) continue;
    const eventMetadata = entriesByEvent[event];

    if (!Array.isArray(eventMetadata)) {
      problems.push(`${METADATA_FILENAME} is missing entries for event "${event}"`);
      continue;
    }
    if (eventMetadata.length !== entries.length) {
      problems.push(
        `${METADATA_FILENAME} lists ${eventMetadata.length} entr(ies) for event "${event}" `
        + `but ${HOOKS_FILENAME} has ${entries.length}`
      );
      continue;
    }

    eventMetadata.forEach((entry, index) => {
      const label = `${METADATA_FILENAME} ${event}[${index}]`;
      if (!entry || typeof entry !== 'object') {
        problems.push(`${label} is not an object`);
        return;
      }
      if (typeof entry.id !== 'string' || entry.id.trim() === '') {
        problems.push(`${label} is missing a non-empty "id"`);
      } else if (idLocations.has(entry.id)) {
        problems.push(`${label} has duplicate id "${entry.id}" already used by ${idLocations.get(entry.id)}`);
      } else {
        idLocations.set(entry.id, label);
      }
      if ('description' in entry && typeof entry.description !== 'string') {
        problems.push(`${label} has a non-string "description"`);
      }
      if (typeof entry.fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(entry.fingerprint)) {
        problems.push(`${label} is missing a valid "fingerprint"`);
        return;
      }
      const expected = fingerprintHookEntry(entries[index]);
      if (entry.fingerprint !== expected) {
        problems.push(
          `${label} (id "${entry.id}") fingerprint ${entry.fingerprint} does not match `
          + `${HOOKS_FILENAME} ${event}[${index}] (${expected}); the entries were reordered `
          + 'or the hook command changed - regenerate with '
          + 'node scripts/ci/validate-hooks.js --update-fingerprints'
        );
      }
    });
  }

  for (const event of Object.keys(entriesByEvent)) {
    if (!Array.isArray(events[event])) {
      problems.push(`${METADATA_FILENAME} describes event "${event}" which ${HOOKS_FILENAME} does not define`);
    }
  }

  return problems;
}

/**
 * Return a copy of the sidecar with every fingerprint recomputed from the
 * matcher entry at the same index. Used to refresh the sidecar after hook
 * commands change.
 *
 * @param {object} hooksConfig - Parsed hooks.json.
 * @param {object} metadata - Parsed hooks.metadata.json.
 * @returns {object} a new metadata object
 */
function withRefreshedFingerprints(hooksConfig, metadata) {
  const events = eventsOf(hooksConfig) || {};
  const entriesByEvent = metadataEntriesOf(metadata) || {};
  const refreshed = {};

  // A known fingerprint at another position signals a reorder, not a command
  // edit. Require the author to move its metadata before refreshing anything.
  const positions = new Map();
  for (const [event, entries] of Object.entries(events)) {
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, index) => {
      const fingerprint = fingerprintHookEntry(entry);
      const locations = positions.get(fingerprint) || [];
      positions.set(fingerprint, [...locations, `${event}[${index}]`]);
    });
  }
  for (const [event, entries] of Object.entries(entriesByEvent)) {
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, index) => {
      const locations = positions.get(entry?.fingerprint);
      const location = `${event}[${index}]`;
      if (locations && !locations.includes(location)) {
        throw new Error(`Metadata reorder detected at ${location}; move the matching sidecar entry before refreshing fingerprints`);
      }
    });
  }

  for (const [event, eventMetadata] of Object.entries(entriesByEvent)) {
    const entries = Array.isArray(events[event]) ? events[event] : [];
    refreshed[event] = Array.isArray(eventMetadata)
      ? eventMetadata.map((entry, index) => (
        entry && typeof entry === 'object' && index < entries.length
          ? { ...entry, fingerprint: fingerprintHookEntry(entries[index]) }
          : entry
      ))
      : eventMetadata;
  }

  return { ...metadata, entries: refreshed };
}

function assertMetadataAligned(hooksConfig, metadata, hooksPath) {
  const mismatches = findMetadataMismatches(hooksConfig, metadata);
  if (mismatches.length > 0) {
    throw new Error(
      `${METADATA_FILENAME} does not line up with ${hooksPath}:\n  ${mismatches.join('\n  ')}`
    );
  }
}

/**
 * Merge a sidecar into a hooks config, rejecting a sidecar that does not line
 * up. Shared by the readers below so a truncated or reordered sidecar fails
 * loudly instead of producing entries with the wrong or missing ids.
 *
 * @param {object} hooksConfig - Parsed hooks.json.
 * @param {object} metadata - Parsed hooks.metadata.json.
 * @param {string} hooksPath - Used in the error message.
 * @returns {object} a new merged hooks configuration
 */
function mergeHooksMetadata(hooksConfig, metadata, hooksPath = HOOKS_FILENAME) {
  assertMetadataAligned(hooksConfig, metadata, hooksPath);
  return applyHooksMetadata(hooksConfig, metadata);
}

/**
 * Read hooks.json and return it with sidecar metadata merged in.
 *
 * @param {string} hooksPath - Path to hooks/hooks.json.
 * @param {string} [label] - Label used in error messages.
 * @returns {object} the merged hooks configuration.
 */
function readHooksConfig(hooksPath, label = HOOKS_FILENAME) {
  const hooksConfig = readJsonObject(hooksPath, label);
  const metadataPath = metadataPathFor(hooksPath);
  if (!fs.existsSync(metadataPath)) {
    return hooksConfig;
  }
  return mergeHooksMetadata(hooksConfig, readJsonObject(metadataPath, METADATA_FILENAME), hooksPath);
}

module.exports = {
  HOOKS_FILENAME,
  METADATA_FILENAME,
  applyHooksMetadata,
  findMetadataMismatches,
  fingerprintHookEntry,
  mergeHooksMetadata,
  metadataPathFor,
  readHooksConfig,
  readJsonObject,
  withRefreshedFingerprints,
};
