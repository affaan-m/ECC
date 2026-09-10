'use strict';

const fs = require('fs');
const path = require('path');
const STATUS_PATTERN = /^\[ECC:([a-z0-9][a-z0-9:._-]*)]\s*(.*)$/s;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hookMetadata(entry) {
  if (!isObject(entry)) return null;
  if (typeof entry.id === 'string' && entry.id.trim()) {
    return {
      id: entry.id.trim(),
      description: typeof entry.description === 'string' ? entry.description.trim() : '',
    };
  }
  for (const handler of Array.isArray(entry.hooks) ? entry.hooks : []) {
    const match = isObject(handler) && typeof handler.statusMessage === 'string'
      ? handler.statusMessage.match(STATUS_PATTERN)
      : null;
    if (match) return { id: match[1], description: match[2].trim() };
  }
  return null;
}

function isHookIdentityStatusMessage(handler, id) {
  if (!isObject(handler) || typeof handler.statusMessage !== 'string' || !id) return false;
  const match = handler.statusMessage.match(STATUS_PATTERN);
  return Boolean(match && match[1] === id);
}

function attachHookMetadata(config) {
  if (!isObject(config) || !isObject(config.hooks)) {
    throw new Error('Invalid hooks config: expected a JSON object with a hooks object');
  }
  const seen = new Set();
  const hooks = Object.fromEntries(Object.entries(config.hooks).map(([event, entries]) => {
    if (!Array.isArray(entries)) throw new Error(`Invalid hooks config: ${event} must be an array`);
    return [event, entries.map((entry, index) => {
      const details = hookMetadata(entry);
      if (!details) throw new Error(`Missing ECC hook identity at ${event}[${index}] statusMessage`);
      if (seen.has(details.id)) throw new Error(`Duplicate ECC hook id '${details.id}'`);
      seen.add(details.id);
      return { ...entry, id: details.id, description: details.description };
    })];
  }));
  return { ...config, hooks };
}

function stripHookEntryMetadata(entry) {
  const metadata = hookMetadata(entry);
  const usesStatusIdentity = metadata && Array.isArray(entry.hooks)
    && entry.hooks.some(handler => isHookIdentityStatusMessage(handler, metadata.id));
  if (!usesStatusIdentity) return { ...entry };
  return Object.fromEntries(
    Object.entries(entry).filter(([key]) => key !== 'id' && key !== 'description')
  );
}

function stripHookMetadata(hooks) {
  return Object.fromEntries(Object.entries(hooks).map(([event, entries]) => [
    event,
    entries.map(stripHookEntryMetadata),
  ]));
}

function loadHookRegistry(root) {
  const filePath = path.join(root, 'hooks', 'hooks.json');
  return attachHookMetadata(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

module.exports = {
  STATUS_PATTERN,
  attachHookMetadata,
  hookMetadata,
  isHookIdentityStatusMessage,
  loadHookRegistry,
  stripHookEntryMetadata,
  stripHookMetadata,
};
