'use strict';

/**
 * capsule-envelope/v1: the portable record contract for one journal entry.
 *
 * Framework 1 of the eval-harness set (telemetry and capsule contract).
 * The envelope is deliberately small. It carries identity, lineage, effect
 * class, a hash link to its predecessor, and an allowlisted payload. Raw
 * secrets, credentials, and unrestricted reasoning text never enter the
 * default envelope: the payload passes through a default-deny property
 * allowlist and a secret canary scan before it is written.
 */

const { hashValue } = require('./canonical');

const SCHEMA_VERSION = 'capsule-envelope/v1';

/** The five append-only lineages a capsule records. */
const LINEAGES = Object.freeze(['plan', 'attempt', 'interaction', 'environment', 'strategy']);

/**
 * Side-effect classes, ordered from pure to irreversible.
 * SE0 read-only evaluation. SE1 reversible local writes inside a capsule root.
 * SE2 sandboxed process or filesystem mutation, no live network writes.
 * SE3 append-only remote evidence publication. SE4 economic or external effects.
 */
const EFFECT_CLASSES = Object.freeze(['SE0', 'SE1', 'SE2', 'SE3', 'SE4']);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const GENESIS_HASH = '0'.repeat(64);

/** Scalar types mirror schemas/capsule-envelope.schema.json. */
const PAYLOAD_TYPES = Object.freeze({
  task_id: 'string',
  task_family: 'string',
  tool: 'string',
  tool_call_id: 'string',
  args_hash: 'string',
  response_hash: 'string',
  status: 'string',
  exit_code: 'integer|null',
  duration_ms: 'number',
  tokens_in: 'integer',
  tokens_out: 'integer',
  cost_usd: 'number',
  model: 'string',
  message: 'string',
  note: 'string',
  decision: 'string',
  reason: 'string',
  score: 'number',
  passed: 'integer',
  failed: 'integer',
  total: 'integer',
  variant: 'string',
  digest: 'string',
  path: 'string',
  fixture_key: 'string',
  stage: 'string',
  verdict: 'string',
  hits: 'integer',
  branch_id: 'string',
  parent_branch_id: 'string',
  summary: 'string',
});
const DEFAULT_PAYLOAD_ALLOWLIST = Object.freeze(Object.keys(PAYLOAD_TYPES));
const ENVELOPE_FIELDS = new Set([
  'schema', 'run_id', 'capsule_id', 'seq', 'ts', 'lineage', 'kind',
  'effect_class', 'harness_version', 'task_family', 'parent_hash', 'entry_hash', 'payload',
]);

/**
 * Secret and credential canaries. A match anywhere in a payload string is
 * a hard refusal: the entry is not written and the caller sees which
 * canary fired. Patterns are intentionally broad and cheap.
 */
const SECRET_CANARIES = Object.freeze([
  { name: 'private_key_block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'aws_access_key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'openai_style_key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'github_token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'slack_token', pattern: /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'stripe_key', pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: 'bearer_header', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/ },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'env_assignment', pattern: /\b(?:API_KEY|SECRET|TOKEN|PASSWORD|PASSWD)\s*=\s*\S{8,}/i },
]);

function scanForCanaries(value, findings = [], trail = '$') {
  if (typeof value === 'string') {
    for (const canary of SECRET_CANARIES) {
      if (canary.pattern.test(value)) {
        findings.push({ canary: canary.name, path: trail });
      }
    }
    return findings;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForCanaries(item, findings, `${trail}[${index}]`));
    return findings;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      scanForCanaries(value[key], findings, `${trail}.${key}`);
    }
  }
  return findings;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Inspect descriptors before reading values; this is not a boundary for proxies. */
function dataObjectErrors(value, label) {
  if (!isPlainObject(value)) return [`${label} must be a plain data object`];
  const errors = [];
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      errors.push(`${label} must contain only enumerable string data properties`);
    }
  }
  return errors;
}

function matchesPayloadType(value, type) {
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer|null' && value === null) return true;
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Return { payload, dropped, findings, errors } without coercing retained fields.
 * Custom allowlists only narrow v1. Invalid data is never scanned or hashed.
 */
function redactPayload(payload, options = {}) {
  const errors = dataObjectErrors(payload, 'payload');
  if (errors.length) return { payload: {}, dropped: [], findings: [], errors };
  const allowlist = new Set(options.allowlist || DEFAULT_PAYLOAD_ALLOWLIST);
  const kept = {};
  const dropped = [];
  for (const key of Object.keys(payload)) {
    if (!Object.hasOwn(PAYLOAD_TYPES, key) || !allowlist.has(key)) {
      dropped.push(key);
    } else if (!matchesPayloadType(payload[key], PAYLOAD_TYPES[key])) {
      errors.push(`payload field ${key} must have type ${PAYLOAD_TYPES[key]}`);
    } else {
      kept[key] = payload[key];
    }
  }
  const findings = errors.length ? [] : scanForCanaries(kept);
  return { payload: kept, dropped: dropped.sort(), findings, errors };
}

/**
 * Validate one envelope. Returns an array of error strings; empty means valid.
 * The check is structural and independent of the journal it came from.
 * Hash-link correctness is verified by the capsule reader, not here.
 */
function validateEnvelope(entry) {
  const errors = dataObjectErrors(entry, 'envelope');
  if (errors.length) return errors;
  if (Object.keys(entry).some(key => !ENVELOPE_FIELDS.has(key))) {
    errors.push('envelope has unknown top-level fields');
  }
  if ([...ENVELOPE_FIELDS].some(key => !Object.hasOwn(entry, key))) {
    errors.push('envelope is missing required own fields');
  }
  if (errors.length) return errors;
  if (entry.schema !== SCHEMA_VERSION) {
    errors.push(`schema must be ${SCHEMA_VERSION}`);
  }
  for (const field of ['run_id', 'capsule_id']) {
    if (typeof entry[field] !== 'string' || !ID_PATTERN.test(entry[field])) {
      errors.push(`${field} must match ${ID_PATTERN}`);
    }
  }
  if (!Number.isInteger(entry.seq) || entry.seq < 0) {
    errors.push('seq must be a non-negative integer');
  }
  if (typeof entry.ts !== 'string' || Number.isNaN(Date.parse(entry.ts))) {
    errors.push('ts must be an ISO-8601 timestamp');
  }
  if (!LINEAGES.includes(entry.lineage)) {
    errors.push(`lineage must be one of ${LINEAGES.join(', ')}`);
  }
  if (typeof entry.kind !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/.test(entry.kind)) {
    errors.push('kind must be a short lowercase identifier');
  }
  if (!EFFECT_CLASSES.includes(entry.effect_class)) {
    errors.push(`effect_class must be one of ${EFFECT_CLASSES.join(', ')}`);
  }
  if (typeof entry.harness_version !== 'string' || entry.harness_version.length === 0) {
    errors.push('harness_version must be a non-empty string');
  }
  if (typeof entry.task_family !== 'string' || entry.task_family.length === 0) {
    errors.push('task_family must be a non-empty string');
  }
  if (typeof entry.parent_hash !== 'string' || !HASH_PATTERN.test(entry.parent_hash)) {
    errors.push('parent_hash must be a 64-char hex sha256');
  }
  if (typeof entry.entry_hash !== 'string' || !HASH_PATTERN.test(entry.entry_hash)) {
    errors.push('entry_hash must be a 64-char hex sha256');
  }
  if (!isPlainObject(entry.payload)) {
    errors.push('payload must be an object');
  } else {
    const { dropped, findings, errors: payloadErrors } = redactPayload(entry.payload);
    errors.push(...payloadErrors);
    if (dropped.length > 0) {
      errors.push(`payload has non-allowlisted keys: ${dropped.join(', ')}`);
    }
    for (const finding of findings) {
      errors.push(`payload tripped secret canary ${finding.canary} at ${finding.path}`);
    }
  }
  if (errors.length === 0) {
    const expected = computeEntryHash(entry);
    if (expected !== entry.entry_hash) {
      errors.push('entry_hash does not match entry content');
    }
  }
  return errors;
}

/** The hash covers every field except entry_hash itself. */
function computeEntryHash(entry) {
  const { entry_hash: _ignored, ...rest } = entry;
  return hashValue(rest);
}

module.exports = {
  SCHEMA_VERSION,
  LINEAGES,
  EFFECT_CLASSES,
  GENESIS_HASH,
  DEFAULT_PAYLOAD_ALLOWLIST,
  SECRET_CANARIES,
  ID_PATTERN,
  HASH_PATTERN,
  redactPayload,
  scanForCanaries,
  validateEnvelope,
  computeEntryHash,
  effectRank: (effectClass) => EFFECT_CLASSES.indexOf(effectClass),
};
