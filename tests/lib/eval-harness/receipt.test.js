/**
 * Tests for scripts/lib/eval-harness/receipt.js
 * Run with: node tests/lib/eval-harness/receipt.test.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const capsule = require('../../../scripts/lib/eval-harness/capsule');
const receiptLib = require('../../../scripts/lib/eval-harness/receipt');
const { test, tempDir, cleanup, finish, fixedClock } = require('./helpers');

console.log('\n=== eval-harness receipt ===\n');

function seeded(dir) {
  const c = capsule.Capsule.create(dir, { clock: fixedClock, task_family: 'f' });
  c.append('plan', 'start', { task_id: 'a' });
  c.append('attempt', 'run', { status: 'pass' });
  c.append('strategy', 'verdict', { verdict: 'PROMOTE' });
  return c;
}

test('build and verify a receipt with artifact and gate digests', () => {
  const dir = tempDir('receipt');
  try {
    seeded(dir);
    const artifact = path.join(dir, 'artifact.txt');
    fs.writeFileSync(artifact, 'candidate bytes');
    const gateReceipt = { verdict: 'PROMOTE', candidate: { digest: 'x' } };
    const receipt = receiptLib.buildReceipt(dir, { artifact_path: artifact, gate_receipt: gateReceipt, clock: fixedClock });
    assert.strictEqual(receipt.schema, receiptLib.RECEIPT_SCHEMA);
    assert.strictEqual(receipt.entry_count, 3);
    assert.strictEqual(receipt.gate_verdict, 'PROMOTE');
    const ok = receiptLib.verifyReceipt(receipt, dir, { artifact_path: artifact, gate_receipt: gateReceipt });
    assert.ok(ok.ok, ok.reason);
    const out = receiptLib.writeReceipt(receipt, path.join(dir, 'out', 'receipt.json'));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).capsule_root, receipt.capsule_root);
  } finally {
    cleanup(dir);
  }
});

test('altered receipt, artifact, gate receipt, and journal each fail at the named check', () => {
  const dir = tempDir('receipt-fail');
  try {
    seeded(dir);
    const artifact = path.join(dir, 'artifact.txt');
    fs.writeFileSync(artifact, 'candidate bytes');
    const gateReceipt = { verdict: 'PROMOTE' };
    const receipt = receiptLib.buildReceipt(dir, { artifact_path: artifact, gate_receipt: gateReceipt });

    const forged = { ...receipt, entry_count: 2 };
    assert.strictEqual(receiptLib.verifyReceipt(forged, dir).check, 'receipt_hash');

    fs.writeFileSync(artifact, 'different bytes');
    assert.strictEqual(receiptLib.verifyReceipt(receipt, dir, { artifact_path: artifact }).check, 'artifact');
    fs.writeFileSync(artifact, 'candidate bytes');

    assert.strictEqual(receiptLib.verifyReceipt(receipt, dir, { gate_receipt: { verdict: 'REJECT' } }).check, 'gate_receipt');

    const journal = path.join(dir, capsule.JOURNAL_FILE);
    const original = fs.readFileSync(journal, 'utf8');
    fs.writeFileSync(journal, original.replace('"status":"pass"', '"status":"fail"'));
    assert.strictEqual(receiptLib.verifyReceipt(receipt, dir).check, 'journal_integrity');

    const lines = original.split('\n');
    fs.writeFileSync(journal, lines.slice(0, 2).join('\n') + '\n');
    assert.strictEqual(receiptLib.verifyReceipt(receipt, dir).check, 'truncation');
    fs.writeFileSync(journal, original);

    fs.rmSync(journal);
    assert.strictEqual(receiptLib.verifyReceipt(receipt, dir).check, 'journal_present');
    assert.strictEqual(receiptLib.verifyReceipt({ schema: 'nope' }, dir).check, 'schema');
  } finally {
    cleanup(dir);
  }
});

test('a journal that advanced past the receipt is a stale checkpoint, and the prefix still verifies', () => {
  const dir = tempDir('receipt-stale');
  try {
    const c = seeded(dir);
    const receipt = receiptLib.buildReceipt(dir);
    c.append('attempt', 'run', { status: 'pass' });
    const result = receiptLib.verifyReceipt(receipt, dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.check, 'stale_checkpoint');
    assert.match(result.reason, /prefix verified/);
  } finally {
    cleanup(dir);
  }
});

test('detached signature interface: wrong key fails at the signature check', () => {
  const dir = tempDir('receipt-sign');
  try {
    seeded(dir);
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const other = crypto.generateKeyPairSync('ed25519').publicKey;
    const signer = (hash) => crypto.sign(null, Buffer.from(hash, 'hex'), privateKey).toString('base64');
    const verifierFor = (key) => (hash, signature) => crypto.verify(null, Buffer.from(hash, 'hex'), key, Buffer.from(signature, 'base64'));
    const receipt = receiptLib.buildReceipt(dir, { signer });
    assert.ok(receipt.signature);
    assert.ok(receiptLib.verifyReceipt(receipt, dir, { verifier: verifierFor(publicKey) }).ok);
    assert.strictEqual(receiptLib.verifyReceipt(receipt, dir, { verifier: verifierFor(other) }).check, 'signature');
    const unsigned = receiptLib.buildReceipt(dir);
    assert.strictEqual(receiptLib.verifyReceipt(unsigned, dir, { verifier: verifierFor(publicKey) }).check, 'signature');
  } finally {
    cleanup(dir);
  }
});

test('receipt refuses to build over a broken journal', () => {
  const dir = tempDir('receipt-broken');
  try {
    seeded(dir);
    const journal = path.join(dir, capsule.JOURNAL_FILE);
    fs.writeFileSync(journal, fs.readFileSync(journal, 'utf8').replace('"status":"pass"', '"status":"fail"'));
    assert.throws(() => receiptLib.buildReceipt(dir), (error) => error.code === 'capsule.invalid_entry');
  } finally {
    cleanup(dir);
  }
});


function rehashReceipt(receipt, changes) {
  const { receipt_hash: _hash, signature: _signature, ...body } = receipt;
  const altered = { ...body, ...changes, signature: null };
  return { ...altered, receipt_hash: require('../../../scripts/lib/eval-harness/canonical').hashValue(altered) };
}

test('producer persists projection and source and exported receipts verify', () => {
  const dir = tempDir('projection-producer');
  const out = tempDir('projection-bundle');
  try {
    seeded(dir);
    const projectionPath = path.join(dir, capsule.PROJECTION_FILE);
    assert.ok(!fs.existsSync(projectionPath));
    const receipt = receiptLib.buildReceipt(dir);
    assert.ok(fs.existsSync(projectionPath));
    assert.strictEqual(JSON.parse(fs.readFileSync(projectionPath)).projection_hash, receipt.projection_hash);
    assert.ok(receiptLib.verifyReceipt(receipt, dir).ok);
    capsule.exportBundle(dir, out);
    assert.ok(receiptLib.verifyReceipt(receipt, out).ok);
  } finally { cleanup(dir); cleanup(out); }
});

test('verifier rejects missing corrupt or forged projections without healing input', () => {
  const dir = tempDir('projection-fail');
  try {
    seeded(dir);
    const receipt = receiptLib.buildReceipt(dir);
    const file = path.join(dir, capsule.PROJECTION_FILE);
    capsule.writeProjection(dir); // Establish a valid fixture on the old implementation too.
    const original = JSON.parse(fs.readFileSync(file));
    const { hashValue } = require('../../../scripts/lib/eval-harness/canonical');
    const { projection_hash: _hash, ...body } = original;
    const forged = { ...body, run_id: 'forged' };
    const cases = ['{broken', JSON.stringify(null), JSON.stringify({ ...original, run_id: 'forged' }),
      JSON.stringify({ ...forged, projection_hash: hashValue(forged) }),
      JSON.stringify({ ...original, extra: 'unverified' }),
      JSON.stringify({ ...original, ['__proto__']: { hidden: true } }),
      JSON.stringify({ ...original, by_lineage: { ...original.by_lineage, ['__proto__']: { hidden: true } } })];
    for (const raw of cases) {
      fs.writeFileSync(file, raw);
      assert.strictEqual(receiptLib.verifyReceipt(receipt, dir).check, 'projection');
      assert.strictEqual(fs.readFileSync(file, 'utf8'), raw);
    }
    fs.unlinkSync(file);
    assert.strictEqual(receiptLib.verifyReceipt(receipt, dir).check, 'projection');
    assert.ok(!fs.existsSync(file));
  } finally { cleanup(dir); }
});

test('projection and receipt identities are checked against validated metadata', () => {
  const dir = tempDir('receipt-identity');
  try {
    seeded(dir);
    const receipt = receiptLib.buildReceipt(dir);
    for (const field of ['run_id', 'capsule_id']) {
      assert.strictEqual(receiptLib.verifyReceipt(rehashReceipt(receipt, { [field]: 'forged' }), dir).check, 'metadata');
    }
    assert.strictEqual(receiptLib.verifyReceipt(rehashReceipt(receipt, { projection_hash: '0'.repeat(64) }), dir).check, 'projection');
    const file = path.join(dir, capsule.META_FILE);
    const original = JSON.parse(fs.readFileSync(file));
    fs.writeFileSync(file, JSON.stringify({ ...original, run_id: 'forged' }));
    assert.strictEqual(receiptLib.verifyReceipt(receipt, dir).check, 'metadata');
    assert.throws(() => receiptLib.buildReceipt(dir), error => error.code === 'capsule.metadata_mismatch');
    fs.unlinkSync(file);
    assert.strictEqual(receiptLib.verifyReceipt(receipt, dir).check, 'metadata');
  } finally { cleanup(dir); }
});

test('receipt schema rejects invalid counts, identities and required digests before indexing', () => {
  const dir = tempDir('receipt-schema');
  try {
    seeded(dir);
    const receipt = receiptLib.buildReceipt(dir);
    const changes = [-1, 0.5, '3', null, Number.MAX_SAFE_INTEGER + 1].map(entry_count => ({ entry_count }));
    changes.push({ run_id: '../bad' }, { capsule_id: 7 }, { envelope_schema: 'wrong' });
    for (const field of ['capsule_root', 'journal_sha256', 'projection_hash', 'artifact_digest', 'gate_receipt_digest']) {
      changes.push({ [field]: 'bad' });
    }
    for (const change of changes) {
      assert.strictEqual(receiptLib.verifyReceipt(rehashReceipt(receipt, change), dir).check, 'schema');
    }
  } finally { cleanup(dir); }
});

test('unreadable artifact input returns a named failure without an exception', () => {
  const dir = tempDir('receipt-artifact');
  try {
    seeded(dir);
    const receipt = receiptLib.buildReceipt(dir);
    for (const artifact_path of [path.join(dir, 'missing'), dir]) {
      const result = receiptLib.verifyReceipt(receipt, dir, { artifact_path });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.check, 'artifact');
    }
  } finally { cleanup(dir); }
});

test('empty journals verify with a persisted projection and bound receipt identity', () => {
  const dir = tempDir('receipt-empty');
  try {
    capsule.Capsule.create(dir);
    const receipt = receiptLib.buildReceipt(dir);
    assert.strictEqual(receipt.entry_count, 0);
    assert.ok(receiptLib.verifyReceipt(receipt, dir).ok);
    const file = path.join(dir, capsule.META_FILE);
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file)), run_id: 'changed' }));
    assert.strictEqual(receiptLib.verifyReceipt(receipt, dir).check, 'metadata');
  } finally { cleanup(dir); }
});


test('journal receipt digest covers raw bytes, including invalid UTF-8 substitutions', () => {
  const dir = tempDir('receipt-bytes');
  try {
    capsule.Capsule.create(dir).append('plan', 'start', { message: '\ufffd' });
    const receipt = receiptLib.buildReceipt(dir);
    const file = path.join(dir, capsule.JOURNAL_FILE);
    const bytes = fs.readFileSync(file);
    const index = bytes.indexOf(Buffer.from('\ufffd'));
    assert.ok(index >= 0);
    fs.writeFileSync(file, Buffer.concat([bytes.subarray(0, index), Buffer.from([0xff]), bytes.subarray(index + 3)]));
    assert.strictEqual(receiptLib.verifyReceipt(receipt, dir).check, 'journal_integrity');
  } finally { cleanup(dir); }
});

test('producer validates explicit artifact digest before persisting projection', () => {
  const dir = tempDir('producer-schema');
  try {
    seeded(dir);
    for (const artifact_digest of ['', 'bad', 1]) {
      assert.throws(() => receiptLib.buildReceipt(dir, { artifact_digest }), error => error.code === 'receipt.schema_invalid');
      assert.ok(!fs.existsSync(path.join(dir, capsule.PROJECTION_FILE)));
    }
  } finally { cleanup(dir); }
});


for (const [fileName, check] of [[capsule.META_FILE, 'metadata'], [capsule.PROJECTION_FILE, 'projection']]) {
  test(`invalid UTF-8 in ${fileName} is rejected without rewriting the file`, () => {
    const dir = tempDir('receipt-encoding');
    try {
      capsule.Capsule.create(dir, { task_family: '\ufffd' }).append('plan', 'start', {});
      const receipt = receiptLib.buildReceipt(dir);
      const file = path.join(dir, fileName);
      const bytes = fs.readFileSync(file);
      const index = bytes.indexOf(Buffer.from('\ufffd'));
      assert.ok(index >= 0);
      const altered = Buffer.concat([bytes.subarray(0, index), Buffer.from([0xff]), bytes.subarray(index + 3)]);
      fs.writeFileSync(file, altered);
      assert.strictEqual(receiptLib.verifyReceipt(receipt, dir).check, check);
      assert.deepStrictEqual(fs.readFileSync(file), altered);
    } finally { cleanup(dir); }
  });
}


// Exact bytes captured from clean5141 before the own-property repair.
const compatibilityFiles = {
  "capsule.json": "{\"capsule_id\":\"cap-canonical\",\"created_at\":\"2026-09-02T00:00:00.000Z\",\"harness_version\":\"test/1\",\"run_id\":\"run-canonical\",\"schema\":\"capsule-envelope/v1\",\"task_family\":\"compatibility\"}\n",
  "journal.ndjson": "{\"capsule_id\":\"cap-canonical\",\"effect_class\":\"SE0\",\"entry_hash\":\"fcd830e206d3732ad19d87e6cfebcb04a03bd8cc6f90f181d44af3de035f9b67\",\"harness_version\":\"test/1\",\"kind\":\"start\",\"lineage\":\"plan\",\"parent_hash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"payload\":{\"message\":\"snow ☃\",\"task_id\":\"alpha\"},\"run_id\":\"run-canonical\",\"schema\":\"capsule-envelope/v1\",\"seq\":0,\"task_family\":\"compatibility\",\"ts\":\"2026-09-02T00:00:00.000Z\"}\n{\"capsule_id\":\"cap-canonical\",\"effect_class\":\"SE0\",\"entry_hash\":\"0c8dcb85ab9282775188d293863964c77ebf85e6c08f42526dd14a7e2021dc3d\",\"harness_version\":\"test/1\",\"kind\":\"result\",\"lineage\":\"attempt\",\"parent_hash\":\"fcd830e206d3732ad19d87e6cfebcb04a03bd8cc6f90f181d44af3de035f9b67\",\"payload\":{\"exit_code\":null,\"passed\":2,\"score\":-1.5},\"run_id\":\"run-canonical\",\"schema\":\"capsule-envelope/v1\",\"seq\":1,\"task_family\":\"compatibility\",\"ts\":\"2026-09-02T00:00:00.000Z\"}\n",
  "projection.json": "{\"by_effect_class\":{\"SE0\":2,\"SE1\":0,\"SE2\":0,\"SE3\":0,\"SE4\":0},\"by_lineage\":{\"attempt\":1,\"environment\":0,\"interaction\":0,\"plan\":1,\"strategy\":0},\"capsule_id\":\"cap-canonical\",\"entry_count\":2,\"harness_version\":\"test/1\",\"journal_sha256\":\"36c5df0c9b513d460b5140600a55aa922599dac8a21bcf5ac917ad9ab3101984\",\"last_seq\":1,\"max_effect_class\":\"SE0\",\"projection_hash\":\"824cfe2b2b42728100b61460de8711d2abb81dd592afe37afcebadd9532571cc\",\"root_hash\":\"0c8dcb85ab9282775188d293863964c77ebf85e6c08f42526dd14a7e2021dc3d\",\"run_id\":\"run-canonical\",\"schema\":\"capsule-envelope/v1\",\"task_family\":\"compatibility\"}\n",
  "unsigned.json": "{\"artifact_digest\":null,\"capsule_id\":\"cap-canonical\",\"capsule_root\":\"0c8dcb85ab9282775188d293863964c77ebf85e6c08f42526dd14a7e2021dc3d\",\"created_at\":\"2026-09-02T00:00:00.000Z\",\"entry_count\":2,\"envelope_schema\":\"capsule-envelope/v1\",\"gate_receipt_digest\":null,\"gate_verdict\":null,\"journal_sha256\":\"36c5df0c9b513d460b5140600a55aa922599dac8a21bcf5ac917ad9ab3101984\",\"projection_hash\":\"824cfe2b2b42728100b61460de8711d2abb81dd592afe37afcebadd9532571cc\",\"receipt_hash\":\"002d0efd23308fac70b408175dac9273a517ce512c5add4ad9b4a7c8aeab25ce\",\"run_id\":\"run-canonical\",\"schema\":\"capsule-receipt/v1\",\"signature\":null}\n",
  "signed.json": "{\"artifact_digest\":null,\"capsule_id\":\"cap-canonical\",\"capsule_root\":\"0c8dcb85ab9282775188d293863964c77ebf85e6c08f42526dd14a7e2021dc3d\",\"created_at\":\"2026-09-02T00:00:00.000Z\",\"entry_count\":2,\"envelope_schema\":\"capsule-envelope/v1\",\"gate_receipt_digest\":null,\"gate_verdict\":null,\"journal_sha256\":\"36c5df0c9b513d460b5140600a55aa922599dac8a21bcf5ac917ad9ab3101984\",\"projection_hash\":\"824cfe2b2b42728100b61460de8711d2abb81dd592afe37afcebadd9532571cc\",\"receipt_hash\":\"002d0efd23308fac70b408175dac9273a517ce512c5add4ad9b4a7c8aeab25ce\",\"run_id\":\"run-canonical\",\"schema\":\"capsule-receipt/v1\",\"signature\":\"synthetic-signature\"}\n"
};

test('pre-fix v1 bundle and unsigned/synthetic-signed receipt bytes are unchanged', () => {
  const dir = tempDir('base-compatibility');
  try {
    const legacy = path.join(dir, 'legacy'); fs.mkdirSync(legacy);
    for (const [name, bytes] of Object.entries(compatibilityFiles)) fs.writeFileSync(path.join(legacy, name), bytes);
    const unsigned = JSON.parse(compatibilityFiles['unsigned.json']);
    const signed = JSON.parse(compatibilityFiles['signed.json']);
    assert.strictEqual(receiptLib.verifyReceipt(unsigned, legacy).ok, true);
    assert.strictEqual(receiptLib.verifyReceipt(signed, legacy, { verifier: (hash, signature) => hash === unsigned.receipt_hash && signature === 'synthetic-signature' }).ok, true);
    for (const [name, bytes] of Object.entries(compatibilityFiles)) assert.strictEqual(fs.readFileSync(path.join(legacy, name), 'utf8'), bytes);
    const current = path.join(dir, 'current');
    const c = capsule.Capsule.create(current, { run_id: 'run-canonical', capsule_id: 'cap-canonical', harness_version: 'test/1', task_family: 'compatibility', clock: fixedClock });
    c.append('plan', 'start', { task_id: 'alpha', message: 'snow ☃' });
    c.append('attempt', 'result', { exit_code: null, score: -1.5, passed: 2 });
    const fresh = receiptLib.buildReceipt(current, { clock: fixedClock });
    const freshSigned = receiptLib.buildReceipt(current, { clock: fixedClock, signer: () => 'synthetic-signature' });
    const bundle = capsule.exportBundle(current, path.join(dir, 'bundle'));
    receiptLib.writeReceipt(fresh, path.join(bundle.dir, 'unsigned.json'));
    receiptLib.writeReceipt(freshSigned, path.join(bundle.dir, 'signed.json'));
    for (const [name, bytes] of Object.entries(compatibilityFiles)) assert.strictEqual(fs.readFileSync(path.join(bundle.dir, name), 'utf8'), bytes);
  } finally { cleanup(dir); }
});

test('legacy receipt hash cannot authenticate an added own __proto__ field', () => {
  const dir = tempDir('receipt-own-key');
  try {
    seeded(dir);
    const receipt = receiptLib.buildReceipt(dir, { clock: fixedClock });
    const changed = { ...receipt, ...JSON.parse('{"__proto__":{"note":"unbound fixture"}}') };
    const projectionBefore = fs.readFileSync(path.join(dir, capsule.PROJECTION_FILE));
    const result = receiptLib.verifyReceipt(changed, dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.check, 'receipt_hash');
    assert.deepStrictEqual(fs.readFileSync(path.join(dir, capsule.PROJECTION_FILE)), projectionBefore);
    // Generic hashing preserves this field; this does not add a receipt schema ban.
    const { receipt_hash: _ignored, signature: _signature, ...body } = changed;
    const rehashed = { ...changed, receipt_hash: require('../../../scripts/lib/eval-harness/canonical').hashValue({ ...body, signature: null }) };
    assert.strictEqual(receiptLib.verifyReceipt(rehashed, dir).ok, true);
  } finally { cleanup(dir); }
});

finish('receipt');
