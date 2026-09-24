'use strict';

const { TextDecoder } = require('util');

const MEMORY_SCHEMA_VERSION = 'ecc.memory.v1';
const MEMORY_KINDS = Object.freeze([
  'context',
  'decision',
  'fact',
  'handoff',
  'lesson',
  'note',
  'preference',
  'runbook',
]);
const MEMORY_SCOPES = Object.freeze(['project', 'team', 'user']);
const MEMORY_TRUST_STATES = Object.freeze(['unreviewed']);
const MEMORY_STATUSES = Object.freeze(['active', 'rejected', 'superseded']);

const MAX_BODY_BYTES = 64 * 1024;
const MAX_DOCUMENT_BYTES = 128 * 1024;
const MAX_TITLE_CHARS = 200;
const MAX_TAGS = 32;
const MAX_LINKS = 64;
const MAX_TARGETS = 32;

const MEMORY_ID_PATTERN = /^mem_[a-z0-9][a-z0-9_-]{2,127}$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const FRONTMATTER_FIELDS = Object.freeze([
  ['schema', 'schema'],
  ['id', 'id'],
  ['title', 'title'],
  ['kind', 'kind'],
  ['scope', 'scope'],
  ['trust', 'trust'],
  ['status', 'status'],
  ['source_harness', 'sourceHarness'],
  ['target_harnesses', 'targetHarnesses'],
  ['tags', 'tags'],
  ['links', 'links'],
  ['created_at', 'createdAt'],
  ['updated_at', 'updatedAt'],
]);
const FRONTMATTER_KEYS = new Map(FRONTMATTER_FIELDS);
const FATAL_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

const SECRET_PATTERNS = Object.freeze([
  { label: 'provider API key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/i },
  { label: 'Stripe key', pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/ },
  { label: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{20,}\b/ },
  { label: 'Hugging Face token', pattern: /\bhf_[A-Za-z0-9]{20,}\b/ },
  { label: 'GitHub token', pattern: /\bgh[pors]_[A-Za-z0-9]{16,}\b/ },
  { label: 'GitHub token', pattern: /\bgithub_pat_[A-Za-z0-9_]{16,}\b/ },
  { label: 'Google API key', pattern: /\bAIza[A-Za-z0-9_-]{16,}\b/ },
  { label: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { label: 'private key', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
]);

function hasUnsafeControlCharacters(value, allowBodyWhitespace = false) {
  return Array.from(value).some(character => {
    const codePoint = character.codePointAt(0);
    const allowedWhitespace = allowBodyWhitespace
      && (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d);
    const isControl = (codePoint <= 0x1f && !allowedWhitespace)
      || (codePoint >= 0x7f && codePoint <= 0x9f);
    const isBidirectionalFormatting = (
      (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069)
    );
    return isControl || isBidirectionalFormatting;
  });
}

function asNonEmptyString(value, label, maxChars = 10_000) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxChars) {
    throw new Error(`${label} is too long (maximum ${maxChars} characters).`);
  }
  if (hasUnsafeControlCharacters(normalized)) {
    throw new Error(`${label} must not contain control or bidirectional formatting characters.`);
  }
  return normalized;
}

function validateEnum(value, allowed, label) {
  const normalized = asNonEmptyString(value, label, 64);
  if (!allowed.includes(normalized)) {
    throw new Error(`${label} must be one of: ${allowed.join(', ')}.`);
  }
  return normalized;
}

function validateSlug(value, label) {
  const normalized = asNonEmptyString(value, label, 64);
  if (!SLUG_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a lowercase letters/numbers slug.`);
  }
  return normalized;
}

function validateMemoryId(value) {
  const normalized = asNonEmptyString(value, 'memory id', 132);
  if (!MEMORY_ID_PATTERN.test(normalized)) {
    throw new Error('memory id must match mem_<lowercase-id> and cannot contain a path.');
  }
  return normalized;
}

function uniqueStrings(values, { label, limit, validator }) {
  if (!Array.isArray(values)) {
    throw new Error(`${label} must be an array.`);
  }
  if (values.length > limit) {
    throw new Error(`${label} has too many values (maximum ${limit}).`);
  }
  return values.reduce((result, value) => {
    const normalized = validator(value);
    if (result.includes(normalized)) {
      throw new Error(`${label} must not contain duplicate values.`);
    }
    return [...result, normalized];
  }, []);
}

function validateTimestamp(value, label) {
  const normalized = asNonEmptyString(value, label, 64);
  const parsed = new Date(normalized);
  if (
    !ISO_TIMESTAMP_PATTERN.test(normalized)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString() !== normalized
  ) {
    throw new Error(`${label} must be an ISO-8601 timestamp.`);
  }
  return normalized;
}

function normalizeBody(value) {
  if (typeof value !== 'string') {
    throw new Error('memory body must be a string.');
  }
  if (hasUnsafeControlCharacters(value, true)) {
    throw new Error('memory body must not contain unsafe control or bidirectional formatting characters.');
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error('memory body must contain non-whitespace context.');
  }
  if (Buffer.byteLength(normalized, 'utf8') > MAX_BODY_BYTES) {
    throw new Error(`memory body is too large (maximum ${MAX_BODY_BYTES} bytes).`);
  }
  return normalized;
}

function normalizeMemory(memory) {
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new Error('memory must be an object.');
  }

  const targetHarnesses = uniqueStrings(memory.targetHarnesses, {
    label: 'target harnesses',
    limit: MAX_TARGETS,
    validator: value => validateSlug(value, 'target harness'),
  });
  if (targetHarnesses.length === 0) {
    throw new Error('target harnesses must contain at least one harness or "all".');
  }

  if (memory.schema !== MEMORY_SCHEMA_VERSION) {
    throw new Error('Unsupported memory schema.');
  }

  return {
    schema: memory.schema,
    id: validateMemoryId(memory.id),
    title: asNonEmptyString(memory.title, 'memory title', MAX_TITLE_CHARS),
    kind: validateEnum(memory.kind, MEMORY_KINDS, 'memory kind'),
    scope: validateEnum(memory.scope, MEMORY_SCOPES, 'memory scope'),
    trust: validateEnum(memory.trust, MEMORY_TRUST_STATES, 'memory trust'),
    status: validateEnum(memory.status, MEMORY_STATUSES, 'memory status'),
    sourceHarness: validateSlug(memory.sourceHarness, 'source harness'),
    targetHarnesses,
    tags: uniqueStrings(memory.tags, {
      label: 'tags',
      limit: MAX_TAGS,
      validator: value => validateSlug(value, 'tag'),
    }),
    links: uniqueStrings(memory.links, {
      label: 'links',
      limit: MAX_LINKS,
      validator: validateMemoryId,
    }),
    createdAt: validateTimestamp(memory.createdAt, 'created_at'),
    updatedAt: validateTimestamp(memory.updatedAt, 'updated_at'),
    body: normalizeBody(memory.body),
  };
}

function serializeMemoryDocument(memory) {
  const normalized = normalizeMemory(memory);
  const metadata = FRONTMATTER_FIELDS.map(([serializedKey, objectKey]) => (
    `${serializedKey}: ${JSON.stringify(normalized[objectKey])}`
  )).join('\n');
  const body = normalized.body.length > 0 ? `\n\n${normalized.body}` : '';
  return `---\n${metadata}\n---${body}\n`;
}

function decodeUtf8(buffer, label = 'text') {
  try {
    return FATAL_UTF8_DECODER.decode(buffer);
  } catch {
    throw new Error(`${label} must contain valid UTF-8 text.`);
  }
}

function parseFrontmatterLine(line, sourcePath, seen) {
  const separator = line.indexOf(':');
  if (separator <= 0) {
    throw new Error(`Invalid memory frontmatter line in ${sourcePath}.`);
  }
  const serializedKey = line.slice(0, separator).trim();
  const objectKey = FRONTMATTER_KEYS.get(serializedKey);
  if (!objectKey) {
    throw new Error(`Unknown memory frontmatter field in ${sourcePath}.`);
  }
  if (seen.has(objectKey)) {
    throw new Error(`Duplicate memory frontmatter field in ${sourcePath}.`);
  }
  const rawValue = line.slice(separator + 1).trim();
  try {
    return { objectKey, value: JSON.parse(rawValue) };
  } catch {
    throw new Error(`Memory frontmatter field in ${sourcePath} must use a JSON value.`);
  }
}

function parseMemoryDocument(source, sourcePath = '<memory>') {
  const openingMarker = typeof source === 'string'
    ? /^---\r?\n/.exec(source)
    : null;
  if (!openingMarker) {
    throw new Error(`Memory document ${sourcePath} must start with --- frontmatter.`);
  }
  if (Buffer.byteLength(source, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new Error(`Memory document ${sourcePath} is too large.`);
  }

  const frontmatterStart = openingMarker[0].length;
  const remainder = source.slice(frontmatterStart);
  const closingMarker = /\r?\n---(?=\r?\n|$)/.exec(remainder);
  if (!closingMarker) {
    throw new Error(`Memory document ${sourcePath} has no closing frontmatter marker.`);
  }

  const frontmatterSource = remainder.slice(0, closingMarker.index);
  const parsed = frontmatterSource.split(/\r?\n/).reduce((state, line) => {
    const next = parseFrontmatterLine(line, sourcePath, state.seen);
    return {
      values: { ...state.values, [next.objectKey]: next.value },
      seen: new Set([...state.seen, next.objectKey]),
    };
  }, { values: {}, seen: new Set() });

  const missing = FRONTMATTER_FIELDS
    .map(([, objectKey]) => objectKey)
    .filter(objectKey => !parsed.seen.has(objectKey));
  if (missing.length > 0) {
    throw new Error(`Memory document ${sourcePath} is missing fields: ${missing.join(', ')}.`);
  }

  const afterMarker = remainder.slice(closingMarker.index + closingMarker[0].length);
  const body = afterMarker.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  return normalizeMemory({ ...parsed.values, body });
}

function findPotentialSecrets(value) {
  const text = typeof value === 'string' ? value : '';
  return SECRET_PATTERNS
    .filter(item => item.pattern.test(text))
    .map(item => item.label)
    .filter((label, index, labels) => labels.indexOf(label) === index);
}

module.exports = {
  MAX_BODY_BYTES,
  MAX_DOCUMENT_BYTES,
  MEMORY_KINDS,
  MEMORY_SCHEMA_VERSION,
  MEMORY_SCOPES,
  MEMORY_STATUSES,
  MEMORY_TRUST_STATES,
  asNonEmptyString,
  decodeUtf8,
  findPotentialSecrets,
  hasUnsafeControlCharacters,
  normalizeMemory,
  parseMemoryDocument,
  serializeMemoryDocument,
  uniqueStrings,
  validateEnum,
  validateMemoryId,
  validateSlug,
};
