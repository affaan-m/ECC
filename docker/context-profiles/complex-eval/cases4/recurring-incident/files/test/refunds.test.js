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

test('processRefund refunds once and returns the gateway receipt', async (t) => {
  freshEnv(t);
  const { processRefund } = await import('../src/refunds.js');
  const receipt = await processRefund({ orderId: 'ord-1', amount: 1200 });
  assert.equal(receipt.type, 'refund');
  assert.equal(receipt.orderId, 'ord-1');
  assert.equal(receipt.amount, 1200);
});

test('processRefund with an explicit key returns the stored receipt on a repeat call', async (t) => {
  freshEnv(t);
  const { processRefund } = await import('../src/refunds.js');
  const first = await processRefund({ orderId: 'ord-2', amount: 900, idempotencyKey: 'key-2' });
  const second = await processRefund({ orderId: 'ord-2', amount: 900, idempotencyKey: 'key-2' });
  assert.equal(second.duplicate, true);
  assert.equal(second.id, first.id);
});
