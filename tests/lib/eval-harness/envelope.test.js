/**
 * Tests for scripts/lib/eval-harness/envelope.js
 * Run with: node tests/lib/eval-harness/envelope.test.js
 */
'use strict';

const assert = require('assert');
const envelope = require('../../../scripts/lib/eval-harness/envelope');
const { canonicalJson, hashValue } = require('../../../scripts/lib/eval-harness/canonical');
const { test, finish } = require('./helpers');

// Generated synthetic fixture; no credential values are loaded from the host.
const awsCanary = 'AKIA' + 'A'.repeat(16);

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

test('valid v1 entry keeps the pinned pre-validation hash and serialized payload', () => {
  const entry = validEntry();
  assert.strictEqual(entry.entry_hash, 'b24439ebdbd58c19e3128d496a47739c59c7736cc82cecaacb00814d54c0c782');
  assert.deepStrictEqual(JSON.parse(canonicalJson(entry)).payload, entry.payload);
  assert.deepStrictEqual(envelope.validateEnvelope(Object.assign(Object.create(null), entry)), []);
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

test('unknown top-level fields are rejected even with a matching hash', () => {
  for (const extra of [{ future_field: 'x' }, JSON.parse('{"__proto__":{"note":"owned fixture"}}')]) {
    const errors = envelope.validateEnvelope(validEntry(extra));
    assert.ok(errors.some(error => error.includes('unknown')), errors.join('; '));
  }
});

test('redactPayload is default-deny and reports dropped keys', () => {
  const { payload, dropped, findings } = envelope.redactPayload({ task_id: 't', reasoning: 'private', prompt: 'p' });
  assert.deepStrictEqual(payload, { task_id: 't' });
  assert.deepStrictEqual(dropped, ['prompt', 'reasoning']);
  assert.deepStrictEqual(findings, []);
});

test('secret canaries fire on common credential shapes', () => {
  const samples = [
    ['aws_access_key', awsCanary],
    ['openai_style_key', 'sk-' + 'a'.repeat(24)],
    ['github_token', 'ghp_' + 'a'.repeat(36)],
    ['slack_token', 'xoxb-' + 'a'.repeat(24)],
    ['stripe_key', 'sk_test_' + 'a'.repeat(24)],
    ['private_key_block', ['-----BEGIN ', 'RSA PRIVATE KEY', '-----'].join('')],
    ['bearer_header', 'Bearer ' + 'a'.repeat(24)],
    ['jwt', ['eyJ' + 'a'.repeat(12), 'b'.repeat(12), 'c'.repeat(12)].join('.')],
    ['env_assignment', 'API_KEY=' + 'a'.repeat(24)],
  ];
  assert.deepStrictEqual(samples.map(([name]) => name).sort(), envelope.SECRET_CANARIES.map(({ name }) => name).sort());
  for (const [name, sample] of samples) {
    const findings = envelope.scanForCanaries({ message: sample });
    assert.ok(findings.some(finding => finding.canary === name), `expected canary family ${name}`);
  }
  assert.deepStrictEqual(envelope.scanForCanaries({ message: 'plain status text' }), []);
});

test('validateEnvelope refuses payloads that trip a canary', () => {
  const entry = validEntry({ payload: { message: 'token ' + awsCanary + ' leaked' } });
  assert.ok(envelope.validateEnvelope(entry).some((e) => e.includes('canary')));
});

test('every declared payload field enforces its schema scalar type', () => {
  const schema = require('../../../schemas/capsule-envelope.schema.json');
  const properties = schema.properties.payload.properties;
  assert.deepStrictEqual([...envelope.DEFAULT_PAYLOAD_ALLOWLIST].sort(), Object.keys(properties).sort());
  const specimens = [['string', 'sample'], ['number', -1.5], ['integer', -2], ['null', null],
    ['boolean', true], ['object', {}], ['array', []], ['undefined', undefined]];
  for (const [key, rule] of Object.entries(properties)) {
    const types = [].concat(rule.type);
    for (const [type, value] of specimens) {
      const accepted = types.includes(type) || (type === 'integer' && types.includes('number'));
      const result = envelope.redactPayload({ [key]: value });
      assert.ok(Array.isArray(result.errors), 'redaction exposes validation errors');
      assert.strictEqual(result.errors.length === 0, accepted, `${key}: ${type}`);
      const entry = validEntry();
      entry.payload = { [key]: value };
      if (value !== undefined) entry.entry_hash = envelope.computeEntryHash(entry);
      assert.strictEqual(envelope.validateEnvelope(entry).length === 0, accepted, `envelope ${key}: ${type}`);
    }
  }
});

test('payload containers and non-JSON values are refused without recursion', () => {
  for (const value of [null, [], 'invalid', 4, true, undefined, new Date(), new Map(), Object.create({ inherited: 1 })]) {
    assert.ok(envelope.redactPayload(value).errors.length > 0);
  }
  const cyclic = {}; cyclic.message = cyclic;
  for (const value of [undefined, () => 1, Symbol('synthetic'), 1n, NaN, Infinity, -Infinity, { note: 'synthetic-input-marker' }, [], cyclic]) {
    const result = envelope.redactPayload({ message: value });
    assert.ok(result.errors.length > 0);
    assert.deepStrictEqual(result.findings, []);
    assert.ok(!result.errors.join('; ').includes('synthetic-input-marker'));
    const entry = validEntry(); entry.payload = { message: value };
    assert.ok(envelope.validateEnvelope(entry).some(error => error.includes('payload')));
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.ok(envelope.redactPayload({ score: value }).errors.length > 0);
  }
});

test('payload accessors and hidden fields are rejected without evaluating them', () => {
  let reads = 0;
  for (const key of ['message', 'unknown']) {
    const value = Object.defineProperty({}, key, { enumerable: true, get() { reads += 1; throw new Error('must not execute'); } });
    assert.ok(envelope.redactPayload(value).errors.length > 0);
  }
  for (const value of [Object.defineProperty({}, 'message', { value: 'hidden' }), { [Symbol('hidden')]: 'value' }]) {
    assert.ok(envelope.redactPayload(value).errors.length > 0);
  }
  assert.strictEqual(reads, 0);
  const plain = Object.assign(Object.create(null), { message: 'plain', exit_code: null });
  assert.deepStrictEqual(envelope.redactPayload(plain), { payload: { message: 'plain', exit_code: null }, dropped: [], findings: [], errors: [] });
});

test('custom allowlists narrow v1 fields and never widen persisted payloads', () => {
  const narrowed = envelope.redactPayload({ message: 'text', status: 'ok' }, { allowlist: ['status'] });
  assert.deepStrictEqual(narrowed.payload, { status: 'ok' });
  assert.deepStrictEqual(narrowed.dropped, ['message']);
  const widened = envelope.redactPayload({ future: 'text', status: 'ok' }, { allowlist: ['future', 'status'] });
  assert.deepStrictEqual(widened.payload, { status: 'ok' });
  assert.deepStrictEqual(widened.dropped, ['future']);
  assert.ok(envelope.redactPayload({ status: 42 }, { allowlist: ['status'], strict: false }).errors.length > 0);
});

test('top-level accessors, missing own fields and exotic envelopes return errors', () => {
  let reads = 0;
  const accessor = validEntry();
  Object.defineProperty(accessor, 'payload', { enumerable: true, get() { reads += 1; throw new Error('must not execute'); } });
  assert.ok(envelope.validateEnvelope(accessor).length > 0);
  assert.strictEqual(reads, 0);
  const missing = validEntry(); delete missing.payload;
  for (const entry of [missing, Object.create(validEntry()), new Date(), { ...validEntry(), [Symbol('extra')]: 'x' }]) {
    assert.ok(envelope.validateEnvelope(entry).length > 0);
  }
});

finish('envelope');
