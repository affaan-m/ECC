import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLedger } from '../src/charge.js';

function freshEnv(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payments-idem-'));
  process.env.LEDGER_FILE = path.join(dir, 'ledger.jsonl');
  process.env.STORE_FILE = path.join(dir, 'store.json');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a refund retried without an idempotency key refunds exactly once', async (t) => {
  const dir = freshEnv(t);
  const { processRefund } = await import('../src/refunds.js');
  await processRefund({ orderId: 'ord-retry', amount: 2500 });
  await processRefund({ orderId: 'ord-retry', amount: 2500 });
  const refunds = readLedger().filter(e => e.type === 'refund' && e.orderId === 'ord-retry');
  assert.equal(refunds.length, 1);
  assert.equal(fs.readdirSync(dir).includes('ledger.jsonl'), true);
});

test('refund idempotency survives a restart (fresh module, same store)', async (t) => {
  freshEnv(t);
  const first = await import('../src/refunds.js');
  await first.processRefund({ orderId: 'ord-restart', amount: 3100 });
  const reloaded = await import(`../src/refunds.js?restart=${Date.now()}`);
  await reloaded.processRefund({ orderId: 'ord-restart', amount: 3100 });
  const refunds = readLedger().filter(e => e.type === 'refund' && e.orderId === 'ord-restart');
  assert.equal(refunds.length, 1);
});

test('a concurrent keyless payout retry storm pays exactly once', async (t) => {
  freshEnv(t);
  const { processPayout } = await import('../src/payouts.js');
  await Promise.all(Array.from({ length: 20 },
    () => processPayout({ vendorId: 'ven-storm', amount: 9000 })));
  const payouts = readLedger().filter(e => e.type === 'payout' && e.vendorId === 'ven-storm');
  assert.equal(payouts.length, 1);
});

test('payout idempotency survives a restart (fresh module, same store)', async (t) => {
  freshEnv(t);
  const first = await import('../src/payouts.js');
  await first.processPayout({ vendorId: 'ven-restart', amount: 4000 });
  const reloaded = await import(`../src/payouts.js?restart=${Date.now()}`);
  await reloaded.processPayout({ vendorId: 'ven-restart', amount: 4000 });
  const payouts = readLedger().filter(e => e.type === 'payout' && e.vendorId === 'ven-restart');
  assert.equal(payouts.length, 1);
});
