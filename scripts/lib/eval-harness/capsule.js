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
    fs.mkdirSync(resolved, { recursive: true });
    if (fs.existsSync(path.join(resolved, META_FILE))) {
      throw new CapsuleError('capsule.exists', `capsule already exists at ${resolved}`);
    }
    const meta = {
      schema: envelope.SCHEMA_VERSION,
      run_id: options.run_id || newId('run'),
      capsule_id: options.capsule_id || newId('capsule'),
      harness_version: options.harness_version || 'unknown',
      task_family: options.task_family || 'unspecified',
      created_at: nowIso(options.clock),
    };
    fs.writeFileSync(path.join(resolved, META_FILE), canonicalJson(meta) + '\n', 'utf8');
    fs.writeFileSync(path.join(resolved, JOURNAL_FILE), '', 'utf8');
    return new Capsule(resolved, meta, options);
  }

  static open(dir, options = {}) {
    const resolved = path.resolve(dir);
    const metaPath = path.join(resolved, META_FILE);
    if (!fs.existsSync(metaPath)) {
      throw new CapsuleError('capsule.missing', `no capsule at ${resolved}`);
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const capsule = new Capsule(resolved, meta, options);
    const state = readJournal(capsule.journalPath);
    if (!state.ok) {
      throw new CapsuleError(state.code, state.reason, { failed_at: state.failed_at });
    }
    if (state.entries.length > 0) {
      const last = state.entries[state.entries.length - 1];
      capsule.lastHash = last.entry_hash;
      capsule.nextSeq = last.seq + 1;
    }
    return capsule;
  }

  /**
   * Append one entry. Refuses non-allowlisted payload keys and secret
   * canaries; the journal is never partially advanced on refusal.
   */
  append(lineage, kind, payload = {}, options = {}) {
    if (!envelope.LINEAGES.includes(lineage)) {
      throw new CapsuleError('capsule.bad_lineage', `unknown lineage ${lineage}`);
    }
    const effectClass = options.effect_class || 'SE0';
    const { payload: clean, dropped, findings } = envelope.redactPayload(payload, options);
    if (findings.length > 0) {
      throw new CapsuleError('capsule.secret_canary', `payload tripped secret canary ${findings[0].canary} at ${findings[0].path}`, { findings });
    }
    if (dropped.length > 0 && options.strict !== false) {
      throw new CapsuleError('capsule.payload_denied', `payload keys not allowlisted: ${dropped.join(', ')}`, { dropped });
    }
    const entry = {
      schema: envelope.SCHEMA_VERSION,
      run_id: this.meta.run_id,
      capsule_id: this.meta.capsule_id,
      seq: this.nextSeq,
      ts: nowIso(this.clock),
      lineage,
      kind,
      effect_class: effectClass,
      harness_version: this.meta.harness_version,
      task_family: this.meta.task_family,
      parent_hash: this.lastHash,
      payload: clean,
    };
    entry.entry_hash = envelope.computeEntryHash(entry);
    const errors = envelope.validateEnvelope(entry);
    if (errors.length > 0) {
      throw new CapsuleError('capsule.invalid_entry', errors.join('; '));
    }
    const line = canonicalJson(entry) + '\n';
    const fd = fs.openSync(this.journalPath, 'a');
    try {
      fs.writeSync(fd, line, null, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    this.lastHash = entry.entry_hash;
    this.nextSeq += 1;
    return entry;
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
  const raw = fs.readFileSync(journalPath, 'utf8');
  const entries = [];
  if (raw.length === 0) {
    return { ok: true, entries, root_hash: envelope.GENESIS_HASH };
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
  return { ok: true, entries, root_hash: expectedParent };
}

function verify(dir) {
  const state = readJournal(path.join(path.resolve(dir), JOURNAL_FILE));
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
  const resolved = path.resolve(dir);
  const meta = JSON.parse(fs.readFileSync(path.join(resolved, META_FILE), 'utf8'));
  const state = readJournal(path.join(resolved, JOURNAL_FILE));
  if (!state.ok) {
    throw new CapsuleError(state.code, state.reason, { failed_at: state.failed_at });
  }
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
    journal_sha256: sha256Hex(fs.readFileSync(path.join(resolved, JOURNAL_FILE))),
    by_lineage: byLineage,
    by_effect_class: byEffect,
    max_effect_class: maxEffectClass(state.entries),
  };
  projection.projection_hash = hashValue(projection);
  return projection;
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
  verify,
  project,
  writeProjection,
  exportBundle,
};
