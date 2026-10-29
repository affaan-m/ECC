'use strict';

// A metadata-only routing index for prompt-time suggestions. Each index is
// named by the managed generation it was built for and bound to that state's
// receipt, so a store change retires it. It never authorizes loading: the
// resolver re-verifies canonical sources before returning any skill body.
const path = require('node:path');
const io = require('./context-profile-store-fs');
const { buildRetrievalIndex, searchRetrieval, sparseDense } = require('./context-retrieval');
const { hasSuggestionEvidence } = require('./context-selection');
const { DEFAULT_REPO_ROOT, digestObject, stableStringify } = require('./context-profile-support');

const SCHEMA = 'ecc.context-routing-index.v1';
const POINTER_SCHEMA = 'ecc.context-routing-pointer.v1';
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_SUGGESTIONS = 3;
const MAX_DESCRIPTION = 120;
// A Full index is under 1 MiB; these bounds keep a prompt-time read proportional
// to a real registry even when the store holds something else.
const MAX_POINTER_BYTES = 4096;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 2048;
const SKILL_ID = /^skill:[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENTRY_KEYS = new Set(['id', 'name', 'description', 'ownerModuleId', 'packId', 'triggers', 'dense']);

function checkedRoot(stateRoot) {
  if (typeof stateRoot !== 'string' || !path.isAbsolute(stateRoot) || path.resolve(stateRoot) !== stateRoot) {
    throw new Error('stateRoot must be an absolute managed store directory');
  }
  return stateRoot;
}

// Reads only the ownership marker, state pointer and its receipt: enough to
// bind an index to the current generation without rehashing the payload.
function readBinding(stateRoot) {
  const root = checkedRoot(stateRoot);
  const marker = { schemaVersion: 'ecc.context-store.v1', destinationDigest: digestObject({ root }) };
  const markerFile = path.join(root, 'store.json');
  if (!io.inspect(markerFile, true).stat || stableStringify(io.readJson(markerFile)) !== stableStringify(marker)) {
    throw new Error('Directory is not an owned ECC managed store');
  }
  const state = io.readJson(path.join(root, 'state.json'));
  if (state.schemaVersion !== 'ecc.context-store-state.v1' || !DIGEST.test(state.receiptDigest) || !DIGEST.test(state.generationDigest)
    || !Number.isSafeInteger(state.revision) || state.revision < 1) {
    throw new Error('Managed state integrity mismatch');
  }
  const receipt = io.readJson(path.join(root, 'receipts', `${state.receiptDigest}.json`));
  if (receipt.schemaVersion !== 'ecc.context-store-receipt.v1' || digestObject(receipt) !== state.receiptDigest
    || receipt.generationDigest !== state.generationDigest || receipt.destinationDigest !== marker.destinationDigest
    || !Number.isSafeInteger(receipt.revision) || receipt.revision < 1 || receipt.revision !== state.revision
    || !['auto', 'manual', 'suggest'].includes(receipt.selection?.selectionMode)
    || stableStringify(receipt.selection) !== stableStringify(state.selection)) {
    throw new Error('Managed receipt and state integrity mismatch');
  }
  return { root, generationDigest: state.generationDigest, receiptDigest: state.receiptDigest,
    revision: receipt.revision, selectionMode: receipt.selection?.selectionMode || null };
}

// Stored vectors are little-endian uint16 dimensions and float64 weights in
// base64: half the size of JSON pairs and exact on any platform.
function encodeDense(pairs) {
  const indexes = Buffer.alloc(pairs.length * 2);
  const values = Buffer.alloc(pairs.length * 8);
  pairs.forEach(([dimension, value], position) => {
    indexes.writeUInt16LE(dimension, position * 2);
    values.writeDoubleLE(value, position * 8);
  });
  return { indexes: indexes.toString('base64'), values: values.toString('base64') };
}

function decodeDense(dense) {
  if (!dense || typeof dense.indexes !== 'string' || typeof dense.values !== 'string') return null;
  const indexes = Buffer.from(dense.indexes, 'base64');
  const values = Buffer.from(dense.values, 'base64');
  if (indexes.length % 2 || values.length !== indexes.length * 4) return null;
  const pairs = new Array(indexes.length / 2);
  for (let position = 0; position < pairs.length; position++) {
    pairs[position] = [indexes.readUInt16LE(position * 2), values.readDoubleLE(position * 8)];
  }
  return pairs;
}

// routing/<generation>.json is a small pointer bound to the state receipt; the
// entries live in routing/indexes/<sha256 of bytes>.json so readers verify them
// by hashing raw bytes instead of re-serializing a large object.
const pointerPath = (root, generationDigest) => path.join(root, 'routing', `${generationDigest}.json`);
const entriesPath = (root, digest) => path.join(root, 'routing', 'indexes', `${digest}.json`);

/** Build the index for the configured, recovered store. Reads canonical sources. */
function writeRoutingIndex({ stateRoot, repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const root = checkedRoot(stateRoot);
  const status = require('./context-profile-store').getStoreStatus({ stateRoot: root });
  if (!status.configured || status.recoveryRequired) throw new Error('Routing index requires a configured, recovered managed store');
  const binding = readBinding(root);
  if (binding.receiptDigest !== status.receiptDigest) throw new Error('Managed state changed during routing index build');
  const carrier = require('./context-carriers').planContextCarrier({ repoRoot, profileId: status.profileId, target: status.target,
    selectionMode: status.selectionMode, include: status.include, exclude: status.exclude });
  if (carrier.carrierDigest !== status.carrierDigest) throw new Error('Stored profile source is stale; set the current generation before indexing');
  const { routingEntries } = require('./context-selection');
  const routing = routingEntries({ repoRoot, profileId: status.profileId, target: status.target,
    selectionMode: status.selectionMode, include: status.include, exclude: status.exclude });
  if (routing.planDigest !== carrier.planDigest || routing.registryDigest !== carrier.registryDigest) {
    throw new Error('Skill sources changed during routing index build; run it again');
  }
  const index = { schemaVersion: SCHEMA, generationDigest: binding.generationDigest, receiptDigest: binding.receiptDigest,
    ...routing, entries: routing.entries.map(entry => ({ ...entry, dense: encodeDense(sparseDense(entry)) })) };
  const bytes = io.jsonBytes(index);
  const digest = io.hash(bytes);
  const file = entriesPath(root, digest);
  io.mkdir(path.join(root, 'routing')); io.mkdir(path.dirname(file));
  // Temp file and rename, so an interrupted build never leaves partial bytes
  // under a digest name; a file whose bytes do not hash to its name (left by
  // an interrupted in-place write) is replaced rather than trusted.
  if (!io.inspect(file, true).stat || io.hash(io.read(file)) !== digest) io.atomicJson(file, index);
  if (readBinding(root).receiptDigest !== binding.receiptDigest) throw new Error('Managed state changed during routing index build');
  const pointer = { schemaVersion: POINTER_SCHEMA, generationDigest: binding.generationDigest,
    receiptDigest: binding.receiptDigest, indexDigest: digest, bytes: bytes.length };
  io.atomicJson(pointerPath(root, binding.generationDigest), { ...pointer, pointerDigest: digestObject(pointer) });
  return { status: 'written', path: file, generationDigest: binding.generationDigest, entries: routing.entries.length };
}

const optionalString = value => value === undefined || typeof value === 'string';

function validEntry(entry) {
  return entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    && Object.keys(entry).every(key => ENTRY_KEYS.has(key))
    && typeof entry.id === 'string' && SKILL_ID.test(entry.id) && typeof entry.description === 'string'
    && optionalString(entry.name) && optionalString(entry.ownerModuleId) && optionalString(entry.packId)
    && (entry.triggers === undefined || (Array.isArray(entry.triggers) && entry.triggers.every(trigger => typeof trigger === 'string')));
}

/** Return the index for the current generation, or null when none was built
 * for this state. A pointer left by an earlier state of the same generation
 * (after a rollback or mode change) is retired, not corrupt. */
function readRoutingIndex(stateRoot, binding = readBinding(stateRoot)) {
  if (binding.root !== checkedRoot(stateRoot)) throw new Error('Routing binding belongs to a different store');
  const file = pointerPath(binding.root, binding.generationDigest);
  if (!io.inspect(path.dirname(file), true).stat || !io.inspect(file, true).stat) return null;
  const invalid = () => new Error('Routing index integrity mismatch; rebuild it with ecc profile routing-index');
  if (io.inspect(file).stat.size > MAX_POINTER_BYTES) throw invalid();
  const pointerBytes = io.read(file);
  if (pointerBytes.length > MAX_POINTER_BYTES) throw invalid();
  const { pointerDigest, ...pointer } = JSON.parse(pointerBytes.toString('utf8'));
  if (pointer.schemaVersion !== POINTER_SCHEMA || digestObject(pointer) !== pointerDigest || !DIGEST.test(pointer.indexDigest || '')
    || !DIGEST.test(pointer.receiptDigest || '') || pointer.generationDigest !== binding.generationDigest
    || !Number.isSafeInteger(pointer.bytes) || pointer.bytes <= 0 || pointer.bytes > MAX_INDEX_BYTES) throw invalid();
  if (pointer.receiptDigest !== binding.receiptDigest) return null;
  const entriesFile = entriesPath(binding.root, pointer.indexDigest);
  if (io.inspect(entriesFile).stat.size !== pointer.bytes) throw invalid();
  const bytes = io.read(entriesFile);
  if (bytes.length !== pointer.bytes || io.hash(bytes) !== pointer.indexDigest) throw invalid();
  const index = JSON.parse(bytes.toString('utf8'));
  if (index.schemaVersion !== SCHEMA || index.generationDigest !== binding.generationDigest
    || index.receiptDigest !== binding.receiptDigest || !Array.isArray(index.entries) || index.entries.length > MAX_ENTRIES
    || !index.entries.every(validEntry)) throw invalid();
  const entries = index.entries.map(entry => ({ ...entry, dense: decodeDense(entry.dense) }));
  if (entries.some(entry => !entry.dense)) throw invalid();
  return { ...index, entries };
}

function routingIndexStatus(stateRoot) {
  const binding = readBinding(stateRoot);
  const index = readRoutingIndex(stateRoot, binding);
  return { status: index ? 'current' : 'missing', path: pointerPath(binding.root, binding.generationDigest),
    generationDigest: binding.generationDigest, entries: index ? index.entries.length : 0 };
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+', 'g');
const singleLine = text => String(text).replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();

/** Rank index entries for a prompt. IDs and one-line descriptions only; like
 * implicit admission, a suggestion needs a name or trigger anchor term. */
function suggestContext(index, prompt, { limit = MAX_SUGGESTIONS } = {}) {
  // Filter before trimming so unanchored matches cannot crowd out anchored ones.
  return searchRetrieval(buildRetrievalIndex(index.entries), prompt, { limit: index.entries.length })
    .filter(candidate => SKILL_ID.test(candidate.id) && hasSuggestionEvidence(candidate)
      && (candidate.exact || candidate.anchorTerms.length > 0))
    .slice(0, Math.min(limit, MAX_SUGGESTIONS))
    .map(candidate => {
      const description = singleLine(candidate.description);
      return { id: candidate.id,
        description: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION - 1)}…` : description };
    });
}

module.exports = { readBinding, readRoutingIndex, routingIndexStatus, suggestContext, writeRoutingIndex };
