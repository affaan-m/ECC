import { refund } from './charge.js';

// Remember which refunds we already sent so we don't send them twice.
const seenRefunds = new Set();

export async function processRefund(req) {
  const key = req.idempotencyKey || `${req.orderId}:${req.amount}`;
  if (seenRefunds.has(key)) {
    return { id: `dup_${key}`, type: 'refund', orderId: req.orderId, amount: req.amount, duplicate: true };
  }
  seenRefunds.add(key);
  return refund({ orderId: req.orderId, amount: req.amount });
}
