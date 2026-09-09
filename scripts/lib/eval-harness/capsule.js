'use strict';

/**
 * Local execution capsule: an append-only, hash-linked NDJSON journal with
 * five typed lineages and a deterministic projection.
 *
 * Framework 2 of the eval-harness set. Properties the tests pin down:
 *   - every entry links to its predecessor by sha256 (parent_hash);
 *   - verify() fails closed at the exact entry for tamper, truncation, and
 *     reordering, and reports a partial trailing write as truncation;
 *   - project() rebuilds the same bytes from the same journal every time;
 *   - exportBundle() copies the journal and projection only, never the
 *     workspace the run touched.
 *
 * What this does not claim: a hash chain does not stop an operator who
 * replaces the whole log. Witnessing is a later, opt-in layer.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { canonicalJson, hashValue, sha256Hex } = require('./canonical');
const envelope = require('./envelope');

const JOURNAL_FILE = 'journal.ndjson';
const PROJECTION_FILE = 'projection.json';
const META_FILE = 'capsule.json';
const APPEND_LOCK_FILE = '.append.lock';

class CapsuleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CapsuleError';
    this.code = code;
    Object.assign(this, details);
  }
}

function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

function nowIso(clock) {
  return (clock ? clock() : new Date()).toISOString();
}

/** Validate metadata before persistence, and bind identity to every journal entry. */
function metadataFailure(meta, entries = []) {
  const invalid = reason => ({ ok: false, code: 'capsule.metadata_invalid', reason, failed_at: null });
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) || meta.schema !== envelope.SCHEMA_VERSION) {
    return invalid('capsule metadata has an invalid schema');
  }
  for (const field of ['run_id', 'capsule_id']) {
    if (typeof meta[field] !== 'string' || !envelope.ID_PATTERN.test(meta[field])) return invalid(`invalid metadata ${field}`);
  }
  for (const field of ['harness_version', 'task_family']) {
    if (typeof meta[field] !== 'string' || !meta[field].trim()) return invalid(`invalid metadata ${field}`);
  }
  const date = typeof meta.created_at === 'string' ? new Date(meta.created_at) : new Date(NaN);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== meta.created_at) return invalid('metadata created_at must be a canonical ISO timestamp');
  const fields = ['schema', 'run_id', 'capsule_id', 'harness_version', 'task_family'];
  for (const [index, entry] of entries.entries()) {
    if (fields.some(field => entry[field] !== meta[field])) {
      return { ok: false, code: 'capsule.metadata_mismatch', reason: `metadata identity differs from journal entry ${index}`, failed_at: index };
    }
  }
  return null;
}

function releaseOwnedLock(lockPath, fd, identity) {
  try {
    // Keep the original descriptor open while checking ownership so its inode
    // cannot be reused. Preserve a replacement detected before release; this
    // check is not atomic against noncooperating filesystem mutation.
    if (identity) {
      let current;
      try { current = fs.lstatSync(lockPath); } catch (error) {
        if (error.code === 'ENOENT') throw new CapsuleError('capsule.lock_lost', 'append lock disappeared before release');
        throw error;
      }
      if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino) {
        throw new CapsuleError('capsule.lock_lost', 'append lock ownership changed before release');
      }
      fs.unlinkSync(lockPath);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Exclusive cooperative append lock. Never waits or infers stale ownership. */
function withAppendLock(dir, operation) {
  const lockPath = path.join(dir, APPEND_LOCK_FILE);
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new CapsuleError('capsule.busy', 'capsule append lock is already held');
    throw error;
  }
  let identity;
  try {
    identity = fs.fstatSync(fd);
    return operation();
  } finally {
    releaseOwnedLock(lockPath, fd, identity);
  }
}

class Capsule {
  /**
   * @param {string} dir capsule root (created if missing)
   * @param {object} meta { run_id, capsule_id, harness_version, task_family }
   */
  constructor(dir, meta, options = {}) {
    this.dir = path.resolve(dir);
    this.meta = meta;
    this.clock = options.clock || null;
    this.journalPath = path.join(this.dir, JOURNAL_FILE);
    this.lastHash = envelope.GENESIS_HASH;
    this.nextSeq = 0;
  }

  static create(dir, options = {}) {
    const resolved = path.resolve(dir);
    if (fs.existsSync(path.join(resolved, META_FILE))) {
      throw new CapsuleError('capsule.exists', `capsule already exists at ${resolved}`);
    }
    const meta = {
      schema: envelope.SCHEMA_VERSION,
      run_id: options.run_id === undefined ? newId('run') : options.run_id,
      capsule_id: options.capsule_id === undefined ? newId('capsule') : options.capsule_id,
      harness_version: options.harness_version === undefined ? 'unknown' : options.harness_version,
      task_family: options.task_family === undefined ? 'unspecified' : options.task_family,
      created_at: nowIso(options.clock),
    };
    const failure = metadataFailure(meta);
    if (failure) throw new CapsuleError(failure.code, failure.reason);
    fs.mkdirSync(resolved, { recursive: true });
    fs.writeFileSync(path.join(resolved, META_FILE), canonicalJson(meta) + '\n', 'utf8');
    fs.writeFileSync(path.join(resolved, JOURNAL_FILE), '', 'utf8');
    return new Capsule(resolved, meta, options);
  }

  static open(dir, options = {}) {
    const resolved = path.resolve(dir);
    const state = readCapsule(resolved);
    if (!state.ok) {
      throw new CapsuleError(state.code, state.reason, { failed_at: state.failed_at });
    }
    const capsule = new Capsule(resolved, state.meta, options);
    if (state.entries.length > 0) {
      const last = state.entries[state.entries.length - 1];
      capsule.lastHash = last.entry_hash;
      capsule.nextSeq = last.seq + 1;
    }
    return capsule;
  }

  /**
   * Serialize cooperating appenders and validate current disk state under lock.
   * A partial I/O failure is preserved for diagnosis, never silently rolled back.
   */
  append(lineage, kind, payload = {}, options = {}) {
    return withAppendLock(this.dir, () => {
      const state = readCapsule(this.dir);
      if (!state.ok) throw new CapsuleError(state.code, state.reason, { failed_at: state.failed_at });
      if (!envelope.LINEAGES.includes(lineage)) {
        throw new CapsuleError('capsule.bad_lineage', `unknown lineage ${lineage}`);
      }
      const effectClass = options.effect_class || 'SE0';
      const { payload: clean, dropped, findings, errors: payloadErrors } = envelope.redactPayload(payload, options);
      if (payloadErrors.length > 0) {
        throw new CapsuleError('capsule.payload_invalid', payloadErrors.join('; '));
      }
      if (findings.length > 0) {
        throw new CapsuleError('capsule.secret_canary', `payload tripped secret canary ${findings[0].canary} at ${findings[0].path}`, { findings });
      }
      if (dropped.length > 0 && options.strict !== false) {
        throw new CapsuleError('capsule.payload_denied', `payload keys not allowlisted: ${dropped.join(', ')}`, { dropped });
      }
      const body = {
        schema: envelope.SCHEMA_VERSION,
        run_id: state.meta.run_id,
        capsule_id: state.meta.capsule_id,
        seq: state.entries.length,
        ts: nowIso(this.clock),
        lineage,
        kind,
        effect_class: effectClass,
        harness_version: state.meta.harness_version,
        task_family: state.meta.task_family,
        parent_hash: state.root_hash,
        payload: clean,
      };
      const entry = { ...body, entry_hash: envelope.computeEntryHash(body) };
      const errors = envelope.validateEnvelope(entry);
      if (errors.length > 0) throw new CapsuleError('capsule.invalid_entry', errors.join('; '));
      const bytes = Buffer.from(canonicalJson(entry) + '\n', 'utf8');
      const fd = fs.openSync(this.journalPath, 'a');
      try {
        let offset = 0;
        while (offset < bytes.length) {
          const written = fs.writeSync(fd, bytes, offset, bytes.length - offset, null);
          if (written <= 0) throw new CapsuleError('capsule.write_failed', 'journal write made no progress');
          offset += written;
        }
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      // These fields remain observable for compatibility, but are never used as
      // authoritative append state. A preopened handle always reloads above.
      this.meta = state.meta;
      this.lastHash = entry.entry_hash;
      this.nextSeq = entry.seq + 1;
      return entry;
    });
  }

  entries() {
    const state = readJournal(this.journalPath);
    if (!state.ok) {
      throw new CapsuleError(state.code, state.reason, { failed_at: state.failed_at });
    }
    return state.entries;
  }
}

/**
 * Read and verify a journal file. Never throws for content problems; the
 * result names the first failing entry index and a stable reason code.
 */
function readJournal(journalPath) {
  if (!fs.existsSync(journalPath)) {
    return { ok: false, code: 'capsule.missing_journal', reason: 'journal file missing', failed_at: null, entries: [] };
  }
  let bytes;
  try { bytes = fs.readFileSync(journalPath); } catch {
    return { ok: false, code: 'capsule.unreadable_journal', reason: 'journal file could not be read', failed_at: null, entries: [] };
  }
  const raw = bytes.toString('utf8');
  if (!bytes.equals(Buffer.from(raw, 'utf8'))) {
    return { ok: false, code: 'capsule.non_canonical', reason: 'journal is not valid UTF-8', failed_at: null, entries: [] };
  }
  const journalDigest = sha256Hex(bytes);
  const entries = [];
  if (raw.length === 0) {
    return { ok: true, entries, root_hash: envelope.GENESIS_HASH, journal_sha256: journalDigest };
  }
  if (!raw.endsWith('\n')) {
    const index = raw.split('\n').length - 1;
    return { ok: false, code: 'capsule.truncated_tail', reason: 'last entry is incomplete (no terminating newline)', failed_at: index, entries };
  }
  const lines = raw.slice(0, -1).split('\n');
  let expectedParent = envelope.GENESIS_HASH;
  for (let index = 0; index < lines.length; index += 1) {
    let entry;
    try {
      entry = JSON.parse(lines[index]);
    } catch (_error) {
      return { ok: false, code: 'capsule.corrupt_entry', reason: `entry ${index} is not valid JSON`, failed_at: index, entries };
    }
    const errors = envelope.validateEnvelope(entry);
    if (errors.length > 0) {
      return { ok: false, code: 'capsule.invalid_entry', reason: `entry ${index}: ${errors[0]}`, failed_at: index, entries };
    }
    if (entry.seq !== index) {
      return { ok: false, code: 'capsule.reordered', reason: `entry ${index} carries seq ${entry.seq}`, failed_at: index, entries };
    }
    if (entry.parent_hash !== expectedParent) {
      return { ok: false, code: 'capsule.broken_link', reason: `entry ${index} parent_hash does not match predecessor`, failed_at: index, entries };
    }
    if (canonicalJson(entry) !== lines[index]) {
      return { ok: false, code: 'capsule.non_canonical', reason: `entry ${index} is not canonical JSON`, failed_at: index, entries };
    }
    expectedParent = entry.entry_hash;
    entries.push(entry);
  }
  return { ok: true, entries, root_hash: expectedParent, journal_sha256: journalDigest };
}

/** Read one journal snapshot and validate its capsule metadata. Never writes. */
function readCapsule(dir) {
  const resolved = path.resolve(dir);
  const state = readJournal(path.join(resolved, JOURNAL_FILE));
  if (!state.ok) return state;
  let meta;
  try {
    const bytes = fs.readFileSync(path.join(resolved, META_FILE));
    const raw = bytes.toString('utf8');
    if (!bytes.equals(Buffer.from(raw, 'utf8'))) throw new Error('invalid UTF-8 metadata');
    meta = JSON.parse(raw);
  } catch {
    return { ...state, ok: false, code: 'capsule.metadata_invalid', reason: 'capsule metadata is missing, unreadable or corrupt', failed_at: null };
  }
  const failure = metadataFailure(meta, state.entries);
  if (failure) return { ...state, ...failure };
  return { ...state, meta, projection: projectState(meta, state) };
}

function verify(dir) {
  const state = readCapsule(dir);
  return {
    ok: state.ok,
    code: state.ok ? 'ok' : state.code,
    reason: state.ok ? 'journal verified' : state.reason,
    failed_at: state.ok ? null : state.failed_at,
    entry_count: state.entries.length,
    root_hash: state.ok ? state.root_hash : null,
  };
}

/**
 * Deterministic projection: the same journal always yields the same bytes.
 * Includes per-lineage counts, last seq, root hash, and the journal digest.
 */
function project(dir) {
  const state = readCapsule(dir);
  if (!state.ok) throw new CapsuleError(state.code, state.reason, { failed_at: state.failed_at });
  return state.projection;
}

/** Derive the projection only from the metadata and journal snapshot just verified. */
function projectState(meta, state) {
  const byLineage = {};
  for (const lineage of envelope.LINEAGES) {
    byLineage[lineage] = 0;
  }
  const byEffect = {};
  for (const effectClass of envelope.EFFECT_CLASSES) {
    byEffect[effectClass] = 0;
  }
  for (const entry of state.entries) {
    byLineage[entry.lineage] += 1;
    byEffect[entry.effect_class] += 1;
  }
  const projection = {
    schema: envelope.SCHEMA_VERSION,
    run_id: meta.run_id,
    capsule_id: meta.capsule_id,
    harness_version: meta.harness_version,
    task_family: meta.task_family,
    entry_count: state.entries.length,
    last_seq: state.entries.length === 0 ? null : state.entries.length - 1,
    root_hash: state.root_hash,
    journal_sha256: state.journal_sha256,
    by_lineage: byLineage,
    by_effect_class: byEffect,
    max_effect_class: maxEffectClass(state.entries),
  };
  return { ...projection, projection_hash: hashValue(projection) };
}

function maxEffectClass(entries) {
  let rank = 0;
  for (const entry of entries) {
    rank = Math.max(rank, envelope.effectRank(entry.effect_class));
  }
  return envelope.EFFECT_CLASSES[rank];
}

function writeProjection(dir) {
  const projection = project(dir);
  fs.writeFileSync(path.join(path.resolve(dir), PROJECTION_FILE), canonicalJson(projection) + '\n', 'utf8');
  return projection;
}

/**
 * Export a minimal bundle: capsule.json, journal.ndjson, projection.json.
 * Workspace contents are never copied.
 */
function exportBundle(dir, outDir) {
  const resolved = path.resolve(dir);
  const target = path.resolve(outDir);
  fs.mkdirSync(target, { recursive: true });
  writeProjection(resolved);
  for (const name of [META_FILE, JOURNAL_FILE, PROJECTION_FILE]) {
    fs.copyFileSync(path.join(resolved, name), path.join(target, name));
  }
  return { dir: target, files: [META_FILE, JOURNAL_FILE, PROJECTION_FILE] };
}

module.exports = {
  Capsule,
  CapsuleError,
  JOURNAL_FILE,
  PROJECTION_FILE,
  META_FILE,
  readJournal,
  readCapsule,
  verify,
  project,
  writeProjection,
  exportBundle,
};
