'use strict';

// A metadata-only routing index for prompt-time suggestions. Each index is
// named by the managed generation it was built for and bound to that state's
// receipt, so a store change retires it. It never authorizes loading: the
// resolver re-verifies canonical sources before returning any skill body.
const path = require('node:path');
const io = require('./context-profile-store-fs');
const { buildRetrievalIndex, searchRetrieval, sparseDense } = require('./context-retrieval');
const { DEFAULT_REPO_ROOT, digestObject, stableStringify } = require('./context-profile-support');

const SCHEMA = 'ecc.context-routing-index.v1';
const POINTER_SCHEMA = 'ecc.context-routing-pointer.v1';
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_SUGGESTIONS = 3;
const MAX_DESCRIPTION = 120;

function checkedRoot(stateRoot) {
  if (typeof stateRoot !== 'string' || !path.isAbsolute(stateRoot) || path.resolve(stateRoot) !== stateRoot) {
    throw new Error('stateRoot must be an absolute managed store directory');
  }
  return stateRoot;
}

// Reads only the ownership marker, state pointer and its receipt: enough to
// bind an index to the current generation without rehashing the payload.
function currentBinding(stateRoot) {
  const root = checkedRoot(stateRoot);
  const marker = { schemaVersion: 'ecc.context-store.v1', destinationDigest: digestObject({ root }) };
  const markerFile = path.join(root, 'store.json');
  if (!io.inspect(markerFile, true).stat || stableStringify(io.readJson(markerFile)) !== stableStringify(marker)) {
    throw new Error('Directory is not an owned ECC managed store');
  }
  const state = io.readJson(path.join(root, 'state.json'));
  if (state.schemaVersion !== 'ecc.context-store-state.v1' || !DIGEST.test(state.receiptDigest) || !DIGEST.test(state.generationDigest)) {
    throw new Error('Managed state integrity mismatch');
  }
  const receipt = io.readJson(path.join(root, 'receipts', `${state.receiptDigest}.json`));
  if (digestObject(receipt) !== state.receiptDigest || receipt.generationDigest !== state.generationDigest) {
    throw new Error('Managed receipt and state integrity mismatch');
  }
  return { root, generationDigest: state.generationDigest, receiptDigest: state.receiptDigest };
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
  const binding = currentBinding(root);
  if (binding.receiptDigest !== status.receiptDigest) throw new Error('Managed state changed during routing index build');
  const carrier = require('./context-carriers').planContextCarrier({ repoRoot, profileId: status.profileId, target: status.target,
    selectionMode: status.selectionMode, include: status.include, exclude: status.exclude });
  if (carrier.carrierDigest !== status.carrierDigest) throw new Error('Stored profile source is stale; set the current generation before indexing');
  const { routingEntries } = require('./context-selection');
  const routing = routingEntries({ repoRoot, profileId: status.profileId, target: status.target,
    selectionMode: status.selectionMode, include: status.include, exclude: status.exclude });
  const bytes = io.jsonBytes({ schemaVersion: SCHEMA, generationDigest: binding.generationDigest, receiptDigest: binding.receiptDigest,
    ...routing, entries: routing.entries.map(entry => ({ ...entry, dense: sparseDense(entry) })) });
  const digest = io.hash(bytes);
  const file = entriesPath(root, digest);
  io.mkdir(path.join(root, 'routing')); io.mkdir(path.dirname(file));
  if (!io.inspect(file, true).stat) io.writeExclusive(file, bytes);
  else if (!io.read(file).equals(bytes)) throw new Error('Routing index content changed under its digest');
  if (currentBinding(root).receiptDigest !== binding.receiptDigest) throw new Error('Managed state changed during routing index build');
  const pointer = { schemaVersion: POINTER_SCHEMA, generationDigest: binding.generationDigest,
    receiptDigest: binding.receiptDigest, indexDigest: digest, bytes: bytes.length };
  io.atomicJson(pointerPath(root, binding.generationDigest), { ...pointer, pointerDigest: digestObject(pointer) });
  return { status: 'written', path: file, generationDigest: binding.generationDigest, entries: routing.entries.length };
}

/** Return the index for the current generation, null when none was built. */
function readRoutingIndex(stateRoot) {
  const binding = currentBinding(stateRoot);
  const file = pointerPath(binding.root, binding.generationDigest);
  if (!io.inspect(path.dirname(file), true).stat || !io.inspect(file, true).stat) return null;
  const invalid = () => new Error('Routing index integrity mismatch; rebuild it with ecc profile routing-index');
  const { pointerDigest, ...pointer } = io.readJson(file);
  if (pointer.schemaVersion !== POINTER_SCHEMA || digestObject(pointer) !== pointerDigest || !DIGEST.test(pointer.indexDigest || '')
    || pointer.generationDigest !== binding.generationDigest || pointer.receiptDigest !== binding.receiptDigest) throw invalid();
  const bytes = io.read(entriesPath(binding.root, pointer.indexDigest));
  if (bytes.length !== pointer.bytes || io.hash(bytes) !== pointer.indexDigest) throw invalid();
  const index = JSON.parse(bytes.toString('utf8'));
  if (index.schemaVersion !== SCHEMA || index.generationDigest !== binding.generationDigest
    || index.receiptDigest !== binding.receiptDigest || !Array.isArray(index.entries)) throw invalid();
  return index;
}

function routingIndexStatus(stateRoot) {
  const binding = currentBinding(stateRoot);
  const index = readRoutingIndex(stateRoot);
  return { status: index ? 'current' : 'missing', path: pointerPath(binding.root, binding.generationDigest),
    generationDigest: binding.generationDigest, entries: index ? index.entries.length : 0 };
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+', 'g');
const singleLine = text => String(text).replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();

/** Rank index entries for a prompt. IDs and one-line descriptions only. */
function suggestContext(index, prompt, { limit = MAX_SUGGESTIONS } = {}) {
  return searchRetrieval(buildRetrievalIndex(index.entries), prompt, { limit: Math.min(limit, MAX_SUGGESTIONS) })
    .filter(candidate => /^skill:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.id))
    .map(candidate => {
      const description = singleLine(candidate.description);
      return { id: candidate.id,
        description: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION - 1)}…` : description };
    });
}

module.exports = { readRoutingIndex, routingIndexStatus, suggestContext, writeRoutingIndex };
