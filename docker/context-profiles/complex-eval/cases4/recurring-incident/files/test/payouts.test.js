import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function freshEnv(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payments-test-'));
  process.env.LEDGER_FILE = path.join(dir, 'ledger.jsonl');
  process.env.STORE_FILE = path.join(dir, 'store.json');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
}

test('processPayout pays once and returns the gateway receipt', async (t) => {
  freshEnv(t);
  const { processPayout } = await import('../src/payouts.js');
  const receipt = await processPayout({ vendorId: 'ven-1', amount: 5000 });
  assert.equal(receipt.type, 'payout');
  assert.equal(receipt.vendorId, 'ven-1');
  assert.equal(receipt.amount, 5000);
});

test('processPayout with an explicit key returns the stored receipt on a repeat call', async (t) => {
  freshEnv(t);
  const { processPayout } = await import('../src/payouts.js');
  const first = await processPayout({ vendorId: 'ven-2', amount: 7000, idempotencyKey: 'key-7' });
  const second = await processPayout({ vendorId: 'ven-2', amount: 7000, idempotencyKey: 'key-7' });
  assert.equal(second.duplicate, true);
  assert.equal(second.id, first.id);
});
