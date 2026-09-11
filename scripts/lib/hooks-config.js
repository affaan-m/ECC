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
 */

const fs = require('fs');
const path = require('path');

const HOOKS_FILENAME = 'hooks.json';
const METADATA_FILENAME = 'hooks.metadata.json';

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
 * Merge sidecar metadata into a parsed hooks.json object.
 *
 * @param {object} hooksConfig - Parsed hooks.json, mutated in place.
 * @param {object|null} metadata - Parsed hooks.metadata.json, or null when absent.
 * @returns {object} the same hooksConfig, with id/description restored.
 */
function applyHooksMetadata(hooksConfig, metadata) {
  const events = hooksConfig && typeof hooksConfig.hooks === 'object' && hooksConfig.hooks
    ? hooksConfig.hooks
    : null;
  if (!events || !metadata || typeof metadata.entries !== 'object' || !metadata.entries) {
    return hooksConfig;
  }

  for (const [event, entries] of Object.entries(events)) {
    const eventMetadata = metadata.entries[event];
    if (!Array.isArray(entries) || !Array.isArray(eventMetadata)) continue;

    entries.forEach((entry, index) => {
      const entryMetadata = eventMetadata[index];
      if (!entry || typeof entry !== 'object') return;
      if (!entryMetadata || typeof entryMetadata !== 'object') return;

      if (typeof entryMetadata.id === 'string' && !('id' in entry)) {
        entry.id = entryMetadata.id;
      }
      if (typeof entryMetadata.description === 'string' && !('description' in entry)) {
        entry.description = entryMetadata.description;
      }
    });
  }

  return hooksConfig;
}

/**
 * Report entries whose metadata is missing or misaligned.
 *
 * @param {object} hooksConfig - Parsed hooks.json.
 * @param {object|null} metadata - Parsed hooks.metadata.json.
 * @returns {string[]} human-readable problems; empty when the sidecar lines up.
 */
function findMetadataMismatches(hooksConfig, metadata) {
  const problems = [];
  const events = hooksConfig && typeof hooksConfig.hooks === 'object' && hooksConfig.hooks
    ? hooksConfig.hooks
    : {};
  const entriesByEvent = metadata && typeof metadata.entries === 'object' && metadata.entries
    ? metadata.entries
    : {};

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
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id.trim() === '') {
        problems.push(`${METADATA_FILENAME} ${event}[${index}] is missing a non-empty "id"`);
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
  return applyHooksMetadata(hooksConfig, readJsonObject(metadataPath, METADATA_FILENAME));
}

module.exports = {
  HOOKS_FILENAME,
  METADATA_FILENAME,
  applyHooksMetadata,
  findMetadataMismatches,
  metadataPathFor,
  readHooksConfig,
  readJsonObject,
};
