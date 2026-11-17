import { refund } from './charge.js';
import * as store from './store.js';

// Processes a customer refund. Callers that have one pass an idempotencyKey;
// plenty of callers (the storefront retry loop among them) do not.
export async function processRefund(req) {
  const key = req.idempotencyKey ? `refund:${req.idempotencyKey}` : null;
  if (key && store.has(key)) {
    return { ...store.get(key), duplicate: true };
  }
  const receipt = await refund({ orderId: req.orderId, amount: req.amount });
  if (key) store.set(key, receipt);
  return receipt;
}
