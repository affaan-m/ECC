'use strict';

/**
 * Offline-verifiable capsule receipts.
 *
 * Framework 5 of the eval-harness set (verifiable receipts, local only).
 * A receipt names the capsule root hash, entry count, schema version, the
 * artifact digest under evaluation, and the gate receipt digest. It can be
 * verified on a machine that never sees the source store as long as it has
 * the exported bundle. The signature field is a detached interface: callers
 * pass a signer/verifier pair; nothing here generates or stores keys.
 *
 * Signatures prove who vouched for the bytes, not that the run was correct.
 */

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const { canonicalJson, hashValue, sha256Hex } = require('./canonical');
const capsule = require('./capsule');
const envelope = require('./envelope');

const RECEIPT_SCHEMA = 'capsule-receipt/v1';

function digestFile(filePath) {
  return sha256Hex(fs.readFileSync(filePath));
}

/**
 * Build a receipt and persist its verified projection in the capsule directory.
 * options: { artifact_path | artifact_digest, gate_receipt (object), signer(fn) }
 */
function buildReceipt(capsuleDir, options = {}) {
  if (options.artifact_digest !== undefined && options.artifact_digest !== null
      && (typeof options.artifact_digest !== 'string' || !envelope.HASH_PATTERN.test(options.artifact_digest))) {
    throw new capsule.CapsuleError('receipt.schema_invalid', 'artifact_digest must be a SHA-256 digest or null');
  }
  const artifactDigest = options.artifact_digest
    || (options.artifact_path ? digestFile(options.artifact_path) : null);
  const projection = capsule.writeProjection(capsuleDir);
  const receipt = {
    schema: RECEIPT_SCHEMA,
    envelope_schema: envelope.SCHEMA_VERSION,
    capsule_id: projection.capsule_id,
    run_id: projection.run_id,
    capsule_root: projection.root_hash,
    entry_count: projection.entry_count,
    journal_sha256: projection.journal_sha256,
    projection_hash: projection.projection_hash,
    artifact_digest: artifactDigest,
    gate_receipt_digest: options.gate_receipt ? hashValue(options.gate_receipt) : null,
    gate_verdict: options.gate_receipt ? options.gate_receipt.verdict || null : null,
    created_at: (options.clock ? options.clock() : new Date()).toISOString(),
    signature: null,
  };
  const receiptHash = hashValue(receipt);
  return {
    ...receipt,
    receipt_hash: receiptHash,
    signature: typeof options.signer === 'function' ? options.signer(receiptHash) : null,
  };
}

function validReceiptSchema(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
      || receipt.schema !== RECEIPT_SCHEMA || receipt.envelope_schema !== envelope.SCHEMA_VERSION
      || !Number.isSafeInteger(receipt.entry_count) || receipt.entry_count < 0) return false;
  for (const field of ['run_id', 'capsule_id']) {
    if (typeof receipt[field] !== 'string' || !envelope.ID_PATTERN.test(receipt[field])) return false;
  }
  for (const field of ['capsule_root', 'journal_sha256', 'projection_hash', 'receipt_hash']) {
    if (typeof receipt[field] !== 'string' || !envelope.HASH_PATTERN.test(receipt[field])) return false;
  }
  for (const field of ['artifact_digest', 'gate_receipt_digest']) {
    if (receipt[field] !== null && (typeof receipt[field] !== 'string' || !envelope.HASH_PATTERN.test(receipt[field]))) return false;
  }
  return true;
}

/** Read and compare the supplied projection without writing or regenerating it. */
function projectionMatches(dir, expected, receipt) {
  try {
    const bytes = fs.readFileSync(path.join(path.resolve(dir), capsule.PROJECTION_FILE));
    const raw = bytes.toString('utf8');
    if (!bytes.equals(Buffer.from(raw, 'utf8'))) return false;
    const stored = JSON.parse(raw);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return false;
    const { projection_hash: claimed, ...body } = stored;
    return hashValue(body) === claimed && claimed === receipt.projection_hash
      && isDeepStrictEqual(stored, expected);
  } catch {
    return false;
  }
}

/**
 * Verify a receipt against a capsule directory (or exported bundle).
 * Returns { ok, check, reason }. `check` names the first failing check:
 *   schema, receipt_hash, signature, journal_present, journal_integrity,
 *   truncation, stale_checkpoint, capsule_root, metadata, projection, artifact, gate_receipt.
 */
function verifyReceipt(receipt, capsuleDir, options = {}) {
  const fail = (check, reason) => ({ ok: false, check, reason });
  if (!validReceiptSchema(receipt)) {
    return fail('schema', 'receipt schema, count, identity or digest fields are invalid');
  }
  const { receipt_hash: claimedHash, signature, ...unsigned } = receipt;
  const recomputed = hashValue({ ...unsigned, signature: null });
  if (recomputed !== claimedHash) {
    return fail('receipt_hash', 'receipt content does not match receipt_hash');
  }
  if (typeof options.verifier === 'function') {
    if (!signature) {
      return fail('signature', 'receipt is unsigned but a verifier was supplied');
    }
    if (!options.verifier(claimedHash, signature)) {
      return fail('signature', 'signature does not verify for this receipt_hash');
    }
  }
  const journalPath = path.join(path.resolve(capsuleDir), capsule.JOURNAL_FILE);
  if (!fs.existsSync(journalPath)) {
    return fail('journal_present', 'journal.ndjson missing from capsule directory');
  }
  const state = capsule.readCapsule(capsuleDir);
  if (!state.ok) {
    const check = state.code.startsWith('capsule.metadata_') ? 'metadata' : 'journal_integrity';
    return fail(check, `${state.reason} (entry ${state.failed_at})`);
  }
  if (state.entries.length < receipt.entry_count) {
    return fail('truncation', `journal has ${state.entries.length} entries, receipt names ${receipt.entry_count}`);
  }
  const rootAtReceipt = receipt.entry_count === 0
    ? envelope.GENESIS_HASH
    : state.entries[receipt.entry_count - 1].entry_hash;
  if (rootAtReceipt !== receipt.capsule_root) {
    return fail('capsule_root', 'journal prefix does not reproduce the receipt capsule_root');
  }
  if (state.entries.length > receipt.entry_count) {
    return fail('stale_checkpoint', `journal advanced to ${state.entries.length} entries after the receipt (prefix verified)`);
  }
  if (receipt.journal_sha256 !== state.journal_sha256) {
    return fail('journal_integrity', 'journal bytes differ from receipt journal_sha256');
  }
  if (receipt.run_id !== state.meta.run_id || receipt.capsule_id !== state.meta.capsule_id) {
    return fail('metadata', 'receipt identity differs from the verified capsule');
  }
  if (!projectionMatches(capsuleDir, state.projection, receipt)) {
    return fail('projection', 'projection is missing, unreadable, corrupt or differs from the verified capsule and receipt');
  }
  if (options.artifact_path) {
    let digest;
    try { digest = digestFile(options.artifact_path); } catch {
      return fail('artifact', 'artifact could not be read');
    }
    if (digest !== receipt.artifact_digest) {
      return fail('artifact', 'artifact digest does not match receipt');
    }
  } else if (options.artifact_digest && options.artifact_digest !== receipt.artifact_digest) {
    return fail('artifact', 'artifact digest does not match receipt');
  }
  if (options.gate_receipt && hashValue(options.gate_receipt) !== receipt.gate_receipt_digest) {
    return fail('gate_receipt', 'gate receipt digest does not match receipt');
  }
  return { ok: true, check: null, reason: 'receipt verified' };
}

function writeReceipt(receipt, filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, canonicalJson(receipt) + '\n', 'utf8');
  return path.resolve(filePath);
}

module.exports = {
  RECEIPT_SCHEMA,
  buildReceipt,
  verifyReceipt,
  writeReceipt,
  digestFile,
};
