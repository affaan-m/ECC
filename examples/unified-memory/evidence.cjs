'use strict';

// Example-only integrity checks. A host-owned catalog is not an identity provider.
const { createHash } = require('node:crypto');
const SCHEMA = 'ecc.memory.example-evidence.v1';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_TEXT_BYTES = 8 * 1024;
const ENVELOPE_KEYS = ['schema', 'sourceRef', 'sha256', 'text', 'observedAt', 'sessionId', 'checkpointId'];
const SOURCE_KEYS = ['workspace', 'scope', 'text', 'observedAt', 'sessionId', 'checkpointId'];
const slug = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const sourceRefIsValid = value => typeof value === 'string' && /^fixture:[a-z][a-z0-9-]{0,63}$/.test(value);
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');

function fail(code) {
  const error = new Error(`Memory example evidence: ${code}`);
  error.code = code;
  throw error;
}
function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function validObservation(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function validSourceFields(value) {
  return typeof value.text === 'string' && value.text.length > 0 && value.text.length <= MAX_TEXT_BYTES
    && Buffer.byteLength(value.text, 'utf8') <= MAX_TEXT_BYTES
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.text)
    && validObservation(value.observedAt) && slug(value.sessionId) && slug(value.checkpointId);
}
function validateEnvelope(value) {
  if (!hasExactKeys(value, ENVELOPE_KEYS) || value.schema !== SCHEMA || !sourceRefIsValid(value.sourceRef)
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || !validSourceFields(value)) {
    fail('INVALID_ENVELOPE');
  }
}
function getSource(sourceRef, catalog, context) {
  if (!hasExactKeys(context, ['workspace', 'scope']) || !slug(context.workspace)
    || !['project', 'team', 'user'].includes(context.scope)) fail('INVALID_CONTEXT');
  if (!(catalog instanceof Map) || !sourceRefIsValid(sourceRef)) fail('INVALID_SOURCE');
  const source = catalog.get(sourceRef);
  if (source === undefined) fail('SOURCE_UNAVAILABLE');
  if (!hasExactKeys(source, SOURCE_KEYS) || !validSourceFields(source) || !slug(source.workspace)
    || !['project', 'team', 'user'].includes(source.scope)) fail('INVALID_SOURCE');
  if (source.workspace !== context.workspace || source.scope !== context.scope) fail('CONTEXT_MISMATCH');
  return source;
}
function decode(body) {
  if (typeof body !== 'string' || body.length > MAX_BODY_BYTES || Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    fail('INVALID_ENVELOPE');
  }
  let value;
  try { value = JSON.parse(body); } catch { fail('INVALID_ENVELOPE'); }
  validateEnvelope(value);
  return value;
}

function encodeEvidence(sourceRef, catalog, context) {
  const source = getSource(sourceRef, catalog, context);
  const body = JSON.stringify({ schema: SCHEMA, sourceRef, sha256: digest(source.text), text: source.text,
    observedAt: source.observedAt, sessionId: source.sessionId, checkpointId: source.checkpointId });
  decode(body);
  return body;
}

function verifyEvidence(body, catalog, context) {
  const value = decode(body);
  const source = getSource(value.sourceRef, catalog, context);
  if (value.sha256 !== digest(source.text) || value.text !== source.text
    || value.observedAt !== source.observedAt || value.sessionId !== source.sessionId
    || value.checkpointId !== source.checkpointId) fail('SOURCE_MISMATCH');
  return Object.freeze({ status: 'source-content-match', sourceRef: value.sourceRef, sha256: value.sha256 });
}

module.exports = { encodeEvidence, verifyEvidence };
