/**
 * Tests for scripts/lib/eval-harness/envelope.js
 * Run with: node tests/lib/eval-harness/envelope.test.js
 */
'use strict';

const assert = require('assert');
const envelope = require('../../../scripts/lib/eval-harness/envelope');
const { canonicalJson, hashValue } = require('../../../scripts/lib/eval-harness/canonical');
const { test, finish } = require('./helpers');

console.log('\n=== eval-harness envelope ===\n');

function validEntry(overrides = {}) {
  const entry = {
    schema: envelope.SCHEMA_VERSION,
    run_id: 'run-1',
    capsule_id: 'capsule-1',
    seq: 0,
    ts: '2026-09-02T00:00:00.000Z',
    lineage: 'plan',
    kind: 'gate.start',
    effect_class: 'SE0',
    harness_version: 'test/1',
    task_family: 'slugify',
    parent_hash: envelope.GENESIS_HASH,
    payload: { task_id: 't01', status: 'ok' },
    ...overrides,
  };
  entry.entry_hash = envelope.computeEntryHash(entry);
  return entry;
}

test('canonical JSON sorts keys recursively and drops undefined', () => {
  assert.strictEqual(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] }, z: undefined }), '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
  assert.strictEqual(hashValue({ a: 1, b: 2 }), hashValue({ b: 2, a: 1 }));
});

test('a well-formed envelope validates with no errors', () => {
  assert.deepStrictEqual(envelope.validateEnvelope(validEntry()), []);
});

test('lineage and effect_class are closed sets', () => {
  assert.ok(envelope.validateEnvelope(validEntry({ lineage: 'thoughts' })).some((e) => e.includes('lineage')));
  assert.ok(envelope.validateEnvelope(validEntry({ effect_class: 'SE9' })).some((e) => e.includes('effect_class')));
  assert.deepStrictEqual([...envelope.LINEAGES], ['plan', 'attempt', 'interaction', 'environment', 'strategy']);
  assert.deepStrictEqual([...envelope.EFFECT_CLASSES], ['SE0', 'SE1', 'SE2', 'SE3', 'SE4']);
});

test('entry_hash mismatch is reported', () => {
  const entry = validEntry();
  entry.payload.status = 'tampered';
  assert.ok(envelope.validateEnvelope(entry).some((e) => e.includes('entry_hash')));
});

test('a future unknown top-level field is rejected by the hash, not silently accepted', () => {
  const entry = validEntry();
  entry.future_field = 'x';
  const errors = envelope.validateEnvelope(entry);
  assert.ok(errors.some((e) => e.includes('entry_hash')), errors.join('; '));
});

test('redactPayload is default-deny and reports dropped keys', () => {
  const { payload, dropped, findings } = envelope.redactPayload({ task_id: 't', reasoning: 'private', prompt: 'p' });
  assert.deepStrictEqual(payload, { task_id: 't' });
  assert.deepStrictEqual(dropped, ['prompt', 'reasoning']);
  assert.deepStrictEqual(findings, []);
});

test('secret canaries fire on common credential shapes', () => {
  const samples = [
    'AKIAABCDEFGHIJKLMNOP',
    'sk-abcdefghijklmnopqrstuvwxyz123456',
    'ghp_' + 'a'.repeat(36),
    'xoxb-1234567890-abcdefghij',
    'Bearer ' + 'A'.repeat(32),
    '-----BEGIN RSA PRIVATE KEY-----',
    'API_KEY=supersecretvalue',
  ];
  for (const sample of samples) {
    const findings = envelope.scanForCanaries({ message: sample });
    assert.ok(findings.length > 0, `expected canary for ${sample.slice(0, 12)}`);
  }
  assert.deepStrictEqual(envelope.scanForCanaries({ message: 'plain status text' }), []);
});

test('validateEnvelope refuses payloads that trip a canary', () => {
  const entry = validEntry({ payload: { message: 'token AKIAABCDEFGHIJKLMNOP leaked' } });
  assert.ok(envelope.validateEnvelope(entry).some((e) => e.includes('canary')));
});

finish('envelope');
