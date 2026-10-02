'use strict';

// An explicit, private materialization store. It never registers a provider or
// changes a user's install receipts, settings, hooks, or permission grants.
// Receipt, immutable-generation, lock, and recovery concepts are adapted from
// the ECC-029 activation prototype and Jeffrey Montoya's #2788 carrier work.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planContextCarrier } = require('./context-carriers');
const { createSourceReader, digestObject, stableStringify, validateSchema } = require('./context-profile-support');
const io = require('./context-profile-store-fs');

const DIGEST = /^[a-f0-9]{64}$/;
const CARRIER_KEYS = ['repoRoot', 'profileId', 'selectionMode', 'target', 'include', 'exclude'];
const INPUT_KEYS = new Set([...CARRIER_KEYS, 'stateRoot', 'expectedRevision', 'expectedCarrierDigest', 'onCheckpoint']);
const equal = (a, b) => stableStringify(a) === stableStringify(b);
const exists = name => Boolean(fs.lstatSync(name, { throwIfNoEntry: false }));

function rootFor(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Store options must be an object');
  for (const key of Object.keys(options)) if (!INPUT_KEYS.has(key)) throw new Error(`Unknown store option: ${key}`);
  const root = options.stateRoot;
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root
    || root === path.parse(root).root || root === os.homedir()) throw new Error('stateRoot must name an explicit dedicated absolute directory');
  if (options.expectedRevision !== undefined && (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0)) throw new Error('Expected revision must be a nonnegative integer');
  if (options.expectedCarrierDigest !== undefined && !DIGEST.test(options.expectedCarrierDigest)) throw new Error('Invalid expected carrier digest');
  if (options.onCheckpoint !== undefined && typeof options.onCheckpoint !== 'function') throw new Error('Invalid checkpoint callback');
  io.inspect(root, true);
  return root;
}

function ownership(root, create = false) {
  const marker = { schemaVersion: 'ecc.context-store.v1', destinationDigest: digestObject({ root }) };
  if (!exists(root)) {
    if (!create) return false;
    io.mkdir(root);
    io.writeExclusive(path.join(root, 'store.json'), io.jsonBytes(marker));
  }
  const stat = io.inspect(root).stat;
  if (!stat.isDirectory() || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0
    || (process.getuid && stat.uid !== process.getuid())))) throw new Error('Managed store must be a private owned directory');
  if (!exists(path.join(root, 'store.json')) || !equal(io.readJson(path.join(root, 'store.json')), marker)) throw new Error('Directory is not an owned ECC managed store');
  return true;
}

function checkCarrier(carrier, expectedDigest) {
  validateSchema(carrier, 'context-carrier.schema.json');
  const { carrierDigest, ...body } = carrier;
  if (carrier.status !== 'planned' || !DIGEST.test(expectedDigest) || carrierDigest !== expectedDigest
    || digestObject(body) !== expectedDigest) throw new Error('Managed carrier digest integrity mismatch');
  return carrier;
}

function generationPath(root, digest) {
  if (!DIGEST.test(digest)) throw new Error('Invalid generation digest');
  return path.join(root, 'generations', digest);
}

function verifyGeneration(directory, carrier, partial = false) {
  const expected = new Map(carrier.files.map(file => [`payload/${file.destinationPath}`, file]));
  const descriptor = io.jsonBytes(carrier);
  expected.set('carrier.json', { digest: io.hash(descriptor), bytes: descriptor.length });
  const allowedDirectories = new Set(['payload']);
  for (const name of expected.keys()) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) allowedDirectories.add(parts.slice(0, i).join('/'));
  }
  const observed = io.inventory(directory);
  for (const file of observed.files) {
    const wanted = expected.get(file.path);
    if (!wanted || file.digest !== wanted.digest || file.bytes !== wanted.bytes) throw new Error(`Managed generation file changed or has unexpected digest: ${file.path}`);
  }
  if (observed.directories.some(name => !allowedDirectories.has(name))) throw new Error('Managed generation contains an extra directory');
  if (!partial && (observed.files.length !== expected.size || observed.directories.length !== allowedDirectories.size)) throw new Error('Managed generation integrity is incomplete');
  return observed;
}

function loadGeneration(root, digest) {
  const directory = generationPath(root, digest);
  const carrier = checkCarrier(io.readJson(path.join(directory, 'carrier.json')), digest);
  verifyGeneration(directory, carrier);
  return carrier;
}

function readState(root) {
  if (!exists(path.join(root, 'state.json'))) return null;
  const state = io.readJson(path.join(root, 'state.json'));
  if (state.schemaVersion !== 'ecc.context-store-state.v1' || !Number.isSafeInteger(state.revision)
    || state.revision < 1 || !DIGEST.test(state.receiptDigest)) throw new Error('Invalid managed state');
  const receipt = io.readJson(path.join(root, 'receipts', `${state.receiptDigest}.json`));
  if (digestObject(receipt) !== state.receiptDigest || receipt.destinationDigest !== digestObject({ root })
    || !equal(state, stateFor(receipt))) throw new Error('Managed receipt and state integrity mismatch');
  checkSelection(receipt.selection, loadGeneration(root, state.generationDigest));
  return state;
}

function selectionFor(carrier, options) {
  return { profileId: carrier.profileId, target: carrier.target, selectionMode: carrier.selectionMode,
    include: [...(options.include || [])].sort(), exclude: [...(options.exclude || [])].sort() };
}

function checkSelection(selection, carrier) {
  if (!selection || selection.profileId !== carrier.profileId || selection.target !== carrier.target
    || selection.selectionMode !== carrier.selectionMode || !Array.isArray(selection.include)
    || selection.include.some(id => !carrier.selectedIds.includes(id))
    || !equal(selection.exclude, carrier.excludedIds)) throw new Error('Managed selection does not match its carrier');
}

function stateFor(receipt) {
  return { schemaVersion: 'ecc.context-store-state.v1', revision: receipt.revision,
    generationDigest: receipt.generationDigest, previousGenerationDigest: receipt.previousGenerationDigest,
    selection: receipt.selection,
    receiptDigest: digestObject(receipt) };
}

function result(root, state, pending = false) {
  const carrier = state ? loadGeneration(root, state.generationDigest) : null;
  return { schemaVersion: 'ecc.context-store-status.v1', status: pending ? 'recovery-required' : state ? 'configured' : 'unconfigured',
    stateRoot: root, revision: state?.revision || 0, configured: Boolean(state), active: false,
    activation: 'unobserved', recoveryRequired: pending,
    profileId: carrier?.profileId || null, target: carrier?.target || null, selectionMode: carrier?.selectionMode || null,
    include: state?.selection.include || [], exclude: state?.selection.exclude || [],
    carrierDigest: carrier?.carrierDigest || null, selectedIds: carrier?.selectedIds || [],
    generationRoot: state ? path.join(generationPath(root, state.generationDigest), 'payload') : null,
    receiptDigest: state?.receiptDigest || null };
}

function getStoreStatus(options) {
  const root = rootFor(options);
  if (!ownership(root)) return result(root, null);
  return result(root, readState(root), exists(path.join(root, 'pending.json')) || exists(path.join(root, '.lock')));
}

function selectedCarrier(options) {
  const carrierOptions = Object.fromEntries(CARRIER_KEYS.filter(key => Object.hasOwn(options, key)).map(key => [key, options[key]]));
  const carrier = planContextCarrier(carrierOptions);
  if (carrier.status !== 'planned') throw new Error('Unsupported carrier target cannot be materialized');
  if (options.expectedCarrierDigest !== undefined && options.expectedCarrierDigest !== carrier.carrierDigest) throw new Error('Carrier digest changed since preview');
  return { carrier, carrierOptions };
}

function revisionCheck(options, state) {
  if (options.expectedRevision !== undefined && options.expectedRevision !== (state?.revision || 0)) throw new Error('Managed state revision changed since preview');
}

function previewStore(options) {
  const root = rootFor(options);
  const { carrier } = selectedCarrier(options);
  const state = ownership(root) ? readState(root) : null;
  revisionCheck(options, state);
  return { ...result(root, state, exists(path.join(root, 'pending.json'))), status: 'proposed',
    carrierDigest: carrier.carrierDigest, proposedProfileId: carrier.profileId,
    proposedSelectedIds: carrier.selectedIds, proposedGenerationRoot: path.join(generationPath(root, carrier.carrierDigest), 'payload') };
}

function withLock(root, recover, run) {
  const lockPath = path.join(root, '.lock');
  if (exists(lockPath)) {
    const lock = io.readJson(lockPath);
    if (!recover || lock.hostname !== os.hostname() || !Number.isSafeInteger(lock.pid) || lock.pid < 1) throw new Error('Managed store lock requires recovery');
    try { process.kill(lock.pid, 0); throw new Error('Managed store lock is held by a live process'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    if (!equal(io.readJson(lockPath), lock)) throw new Error('Managed store lock changed');
    fs.unlinkSync(lockPath);
  }
  const lock = { pid: process.pid, hostname: os.hostname(), nonce: crypto.randomUUID() };
  io.writeExclusive(lockPath, io.jsonBytes(lock));
  try { return run(); }
  finally {
    if (equal(io.readJson(lockPath), lock)) { fs.unlinkSync(lockPath); io.syncDirectory(root); }
  }
}

function checkpoint(options, name, detail = {}) { if (options.onCheckpoint) options.onCheckpoint(name, detail); }

function publishGeneration(root, pending, options, carrierOptions) {
  const final = generationPath(root, pending.carrier.carrierDigest);
  if (exists(final)) { loadGeneration(root, pending.carrier.carrierDigest); return; }
  const staging = path.join(root, 'generations', `stage-${pending.transactionDigest}`);
  io.mkdir(staging); io.mkdir(path.join(staging, 'payload'));
  const reader = createSourceReader(options.repoRoot);
  for (const file of pending.carrier.files) {
    const resource = file.kind === 'copy' ? reader.read(file.sourcePath) : { content: Buffer.from(file.content, 'utf8') };
    if (io.hash(resource.content) !== file.digest || resource.content.length !== file.bytes) throw new Error('Canonical source digest changed during materialization');
    const relative = `payload/${file.destinationPath}`;
    io.ensureParents(staging, relative);
    const destination = path.join(staging, relative);
    io.writeExclusive(destination, resource.content);
    checkpoint(options, 'file-written', { path: destination });
  }
  if (!equal(planContextCarrier(carrierOptions), pending.carrier)) throw new Error('Canonical source changed during materialization');
  io.writeExclusive(path.join(staging, 'carrier.json'), io.jsonBytes(pending.carrier));
  verifyGeneration(staging, pending.carrier);
  io.inspect(final, true);
  if (exists(final)) throw new Error('Generation appeared during materialization');
  fs.renameSync(staging, final); io.syncDirectory(path.dirname(final));
}

function publishReceipt(root, receipt) {
  const file = path.join(root, 'receipts', `${digestObject(receipt)}.json`);
  if (exists(file)) {
    if (!equal(io.readJson(file), receipt)) throw new Error('Managed immutable receipt changed');
  } else io.writeExclusive(file, io.jsonBytes(receipt));
}

function transaction(root, before, carrier, operation, options, carrierOptions) {
  const receipt = { schemaVersion: 'ecc.context-store-receipt.v1', destinationDigest: digestObject({ root }),
    operation, revision: (before?.revision || 0) + 1, generationDigest: carrier.carrierDigest,
    previousGenerationDigest: before?.generationDigest || null, previousReceiptDigest: before?.receiptDigest || null,
    selection: selectionFor(carrier, carrierOptions) };
  const body = { schemaVersion: 'ecc.context-store-transaction.v1', before, after: stateFor(receipt), receipt, carrier };
  const pending = { ...body, transactionDigest: digestObject(body) };
  io.atomicJson(path.join(root, 'pending.json'), pending); checkpoint(options, 'prepared');
  publishGeneration(root, pending, options, carrierOptions); checkpoint(options, 'generation-published');
  publishReceipt(root, receipt); checkpoint(options, 'receipt-published');
  if (!equal(readState(root), before)) throw new Error('Managed state changed during transaction');
  loadGeneration(root, carrier.carrierDigest);
  io.atomicJson(path.join(root, 'state.json'), pending.after); checkpoint(options, 'state-published');
  fs.unlinkSync(path.join(root, 'pending.json')); io.syncDirectory(root);
  return result(root, readState(root));
}

function applyStore(options) {
  const root = rootFor(options);
  const { carrier, carrierOptions } = selectedCarrier(options);
  if (ownership(root)) { revisionCheck(options, readState(root)); }
  else revisionCheck(options, null);
  ownership(root, true);
  return withLock(root, false, () => {
    if (exists(path.join(root, 'pending.json'))) throw new Error('Managed transaction requires recovery');
    const before = readState(root); revisionCheck(options, before);
    if (!equal(planContextCarrier(carrierOptions), carrier)) throw new Error('Canonical source digest changed before apply');
    if (before?.generationDigest === carrier.carrierDigest
      && equal(before.selection, selectionFor(carrier, carrierOptions))) return result(root, before);
    io.mkdir(path.join(root, 'generations')); io.mkdir(path.join(root, 'receipts'));
    return transaction(root, before, carrier, 'apply', options, carrierOptions);
  });
}

function rollbackStore(options) {
  const root = rootFor(options);
  if (!ownership(root)) throw new Error('Managed store has no previous generation');
  return withLock(root, false, () => {
    if (exists(path.join(root, 'pending.json'))) throw new Error('Managed transaction requires recovery');
    const before = readState(root); revisionCheck(options, before);
    if (!before?.previousGenerationDigest) throw new Error('Managed store has no previous generation');
    const carrier = loadGeneration(root, before.previousGenerationDigest);
    const receipt = io.readJson(path.join(root, 'receipts', `${before.receiptDigest}.json`));
    if (!DIGEST.test(receipt.previousReceiptDigest)) throw new Error('Previous receipt digest is invalid');
    const previous = io.readJson(path.join(root, 'receipts', `${receipt.previousReceiptDigest}.json`));
    if (digestObject(previous) !== receipt.previousReceiptDigest || previous.generationDigest !== carrier.carrierDigest) throw new Error('Previous receipt integrity mismatch');
    return transaction(root, before, carrier, 'rollback', options, previous.selection);
  });
}

function readPending(root) {
  const pending = io.readJson(path.join(root, 'pending.json'));
  const { transactionDigest, ...body } = pending;
  if (!DIGEST.test(transactionDigest) || digestObject(body) !== transactionDigest
    || pending.schemaVersion !== 'ecc.context-store-transaction.v1'
    || pending.receipt.destinationDigest !== digestObject({ root })
    || !equal(pending.after, stateFor(pending.receipt))
    || pending.after.revision !== (pending.before?.revision || 0) + 1
    || pending.receipt.previousGenerationDigest !== (pending.before?.generationDigest || null)
    || pending.receipt.previousReceiptDigest !== (pending.before?.receiptDigest || null)) throw new Error('Pending transaction integrity mismatch');
  checkCarrier(pending.carrier, pending.after.generationDigest);
  checkSelection(pending.receipt.selection, pending.carrier);
  return pending;
}

function recoverStore(options) {
  const root = rootFor(options);
  if (!ownership(root)) return result(root, null);
  return withLock(root, true, () => {
    const before = readState(root); revisionCheck(options, before);
    if (!exists(path.join(root, 'pending.json'))) return result(root, before);
    const pending = readPending(root);
    if (!equal(before, pending.before) && !equal(before, pending.after)) throw new Error('State changed outside the pending transaction');
    const final = generationPath(root, pending.after.generationDigest);
    const staging = path.join(root, 'generations', `stage-${pending.transactionDigest}`);
    if (exists(final)) {
      loadGeneration(root, pending.after.generationDigest);
      if (exists(staging)) throw new Error('Ambiguous pending generation requires inspection');
      publishReceipt(root, pending.receipt);
      io.atomicJson(path.join(root, 'state.json'), pending.after);
    } else {
      if (!equal(before, pending.before)) throw new Error('Committed generation is missing');
      if (exists(staging)) io.removeTree(staging, verifyGeneration(staging, pending.carrier, true));
    }
    fs.unlinkSync(path.join(root, 'pending.json')); io.syncDirectory(root);
    return result(root, readState(root));
  });
}

module.exports = { applyStore, getStoreStatus, previewStore, recoverStore, rollbackStore };
