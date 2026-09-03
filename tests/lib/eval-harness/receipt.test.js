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

finish('receipt');
