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

const { canonicalJson, hashValue, sha256Hex } = require('./canonical');
const capsule = require('./capsule');
const envelope = require('./envelope');

const RECEIPT_SCHEMA = 'capsule-receipt/v1';

function digestFile(filePath) {
  return sha256Hex(fs.readFileSync(filePath));
}

/**
 * Build a receipt for a capsule directory.
 * options: { artifact_path | artifact_digest, gate_receipt (object), signer(fn) }
 */
function buildReceipt(capsuleDir, options = {}) {
  const verification = capsule.verify(capsuleDir);
  if (!verification.ok) {
    throw new capsule.CapsuleError(verification.code, `cannot build receipt: ${verification.reason}`, { failed_at: verification.failed_at });
  }
  const projection = capsule.project(capsuleDir);
  const artifactDigest = options.artifact_digest
    || (options.artifact_path ? digestFile(options.artifact_path) : null);
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
  receipt.receipt_hash = hashValue(receipt);
  if (typeof options.signer === 'function') {
    receipt.signature = options.signer(receipt.receipt_hash);
  }
  return receipt;
}

/**
 * Verify a receipt against a capsule directory (or exported bundle).
 * Returns { ok, check, reason }. `check` names the first failing check:
 *   schema, receipt_hash, signature, journal_present, journal_integrity,
 *   truncation, stale_checkpoint, capsule_root, artifact, gate_receipt.
 */
function verifyReceipt(receipt, capsuleDir, options = {}) {
  const fail = (check, reason) => ({ ok: false, check, reason });
  if (!receipt || receipt.schema !== RECEIPT_SCHEMA) {
    return fail('schema', `receipt schema must be ${RECEIPT_SCHEMA}`);
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
  const state = capsule.readJournal(journalPath);
  if (!state.ok) {
    return fail('journal_integrity', `${state.reason} (entry ${state.failed_at})`);
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
  if (receipt.journal_sha256 !== sha256Hex(fs.readFileSync(journalPath))) {
    return fail('journal_integrity', 'journal bytes differ from receipt journal_sha256');
  }
  if (options.artifact_path) {
    const digest = digestFile(options.artifact_path);
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
