'use strict';

// Pure synthetic checks: no subprocess, filesystem fixture, provider or server.
const assert = require('node:assert/strict');
const { encodeEvidence, verifyEvidence } = require('./evidence.cjs');
const sourceRef = 'fixture:orbit';
const source = Object.freeze({ workspace: 'alpha', scope: 'project',
  text: 'Synthetic orbit evidence: calibration color is amber.',
  observedAt: '2026-01-01T00:00:00.000Z', sessionId: 'fixture-session', checkpointId: 'fixture-checkpoint' });
const context = Object.freeze({ workspace: 'alpha', scope: 'project' });
const catalog = new Map([[sourceRef, source]]);
const body = () => encodeEvidence(sourceRef, catalog, context);
const edit = change => JSON.stringify({ ...JSON.parse(body()), ...change });
let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; }
  catch { throw new Error(`Synthetic evidence check failed: ${name}`); }
}
function rejects(fn, code) {
  assert.throws(fn, error => error.code === code
    && error.message === `Memory example evidence: ${code}`);
}

test('valid source content and provenance match', () => {
  const result = verifyEvidence(body(), catalog, context);
  assert.equal(result.status, 'source-content-match');
  assert.equal(result.sourceRef, sourceRef);
  assert.equal(result.sha256, JSON.parse(body()).sha256);
  assert.ok(Object.isFrozen(result));
});
test('deterministic encoding preserves input catalog', () => {
  const before = JSON.stringify([...catalog]);
  assert.equal(body(), body());
  assert.equal(JSON.stringify([...catalog]), before);
});
for (const [name, change] of [
  ['changed text', { text: 'Synthetic altered content.' }],
  ['changed digest', { sha256: '0'.repeat(64) }],
  ['changed observation', { observedAt: '2026-01-02T00:00:00.000Z' }],
  ['changed session', { sessionId: 'other-session' }],
  ['changed checkpoint', { checkpointId: 'other-checkpoint' }],
]) {
  test(name, () => rejects(() => verifyEvidence(edit(change), catalog, context), 'SOURCE_MISMATCH'));
}
test('missing source never becomes successful empty evidence', () => {
  rejects(() => verifyEvidence(body(), new Map(), context), 'SOURCE_UNAVAILABLE');
});
test('same reference in another workspace is denied', () => {
  rejects(() => verifyEvidence(body(), catalog, { ...context, workspace: 'beta' }), 'CONTEXT_MISMATCH');
});
test('project evidence cannot be relabeled as user evidence', () => {
  rejects(() => verifyEvidence(body(), catalog, { ...context, scope: 'user' }), 'CONTEXT_MISMATCH');
});
test('creation enforces host context too', () => {
  rejects(() => encodeEvidence(sourceRef, catalog, { ...context, workspace: 'beta' }), 'CONTEXT_MISMATCH');
});
for (const [name, value] of [
  ['unknown schema', () => edit({ schema: 'unrecognized' })],
  ['unknown authority field', () => edit({ trust: 'verified' })],
  ['external URL is not a source lookup', () => edit({ sourceRef: 'https://example.invalid/source' })],
  ['path is not a source lookup', () => edit({ sourceRef: '../private-source' })],
  ['invalid timestamp', () => edit({ observedAt: '2026-02-30T00:00:00.000Z' })],
  ['missing checkpoint', () => { const value = JSON.parse(body()); delete value.checkpointId; return JSON.stringify(value); }],
  ['malformed JSON', () => '{'],
  ['non-object JSON', () => 'null'],
  ['oversized body', () => 'x'.repeat(16385)],
]) {
  test(name, () => rejects(() => verifyEvidence(value(), catalog, context), 'INVALID_ENVELOPE'));
}
test('unavailable source is also denied during creation', () => {
  rejects(() => encodeEvidence(sourceRef, new Map(), context), 'SOURCE_UNAVAILABLE');
});
test('changed catalog content invalidates a previously encoded body', () => {
  const changed = new Map([[sourceRef, { ...source, text: 'Synthetic revised evidence.' }]]);
  rejects(() => verifyEvidence(body(), changed, context), 'SOURCE_MISMATCH');
});
test('recomputed attacker digest does not replace host source binding', () => {
  const crypto = require('node:crypto');
  const text = 'Synthetic attacker replacement.';
  const sha256 = crypto.createHash('sha256').update(text).digest('hex');
  rejects(() => verifyEvidence(edit({ text, sha256 }), catalog, context), 'SOURCE_MISMATCH');
});
test('invalid host source is not a record success', () => {
  const invalid = new Map([[sourceRef, { ...source, text: '' }]]);
  rejects(() => encodeEvidence(sourceRef, invalid, context), 'INVALID_SOURCE');
});
test('invalid host context is denied before source lookup', () => {
  rejects(() => verifyEvidence(body(), catalog, { workspace: 'alpha', scope: 'all' }), 'INVALID_CONTEXT');
});
test('rejects forbidden C0 controls and DEL in source and recalled text', () => {
  const codes = [...Array.from({ length: 32 }, (_, code) => code), 127]
    .filter(code => ![9, 10, 13].includes(code));
  for (const code of codes) {
    const text = `Synthetic ${String.fromCodePoint(code)} content.`;
    const invalid = new Map([[sourceRef, { ...source, text }]]);
    rejects(() => encodeEvidence(sourceRef, invalid, context), 'INVALID_SOURCE');
    rejects(() => verifyEvidence(edit({ text }), catalog, context), 'INVALID_ENVELOPE');
  }
});
test('preserves allowed whitespace, printable boundaries and non-C0 Unicode', () => {
  for (const code of [9, 10, 13, 32, 126, 128, 0x2028, 0x1f642]) {
    const text = `Synthetic ${String.fromCodePoint(code)} content.`;
    const allowed = new Map([[sourceRef, { ...source, text }]]);
    const encoded = encodeEvidence(sourceRef, allowed, context);
    assert.equal(verifyEvidence(encoded, allowed, context).status, 'source-content-match');
  }
});
process.stdout.write(`${JSON.stringify({ status: 'passed', checks: passed,
  boundary: 'Synthetic in-memory evidence checks; no authentication or runtime-service verification.' })}\n`);
