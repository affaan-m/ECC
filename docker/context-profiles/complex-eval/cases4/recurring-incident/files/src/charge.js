// Fake payment gateway. Every call is recorded as one JSON line in an
// append-only ledger so side effects can be audited after the fact.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function ledgerPath() {
  return process.env.LEDGER_FILE || path.join(process.cwd(), '.data', 'ledger.jsonl');
}

function append(entry) {
  const file = ledgerPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`);
}

function latency() {
  return new Promise(resolve => setTimeout(resolve, 5 + Math.floor(Math.random() * 10)));
}

export async function charge({ orderId, amount }) {
  await latency();
  const receipt = { id: `chg_${crypto.randomUUID()}`, type: 'charge', orderId, amount };
  append(receipt);
  return receipt;
}

export async function refund({ orderId, amount }) {
  await latency();
  const receipt = { id: `rfnd_${crypto.randomUUID()}`, type: 'refund', orderId, amount };
  append(receipt);
  return receipt;
}

export async function payout({ vendorId, amount }) {
  await latency();
  const receipt = { id: `pay_${crypto.randomUUID()}`, type: 'payout', vendorId, amount };
  append(receipt);
  return receipt;
}

export function readLedger(file = ledgerPath()) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
}
