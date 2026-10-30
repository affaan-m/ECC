import { refund } from './charge.js';
import * as store from './store.js';
import { deriveKey, once } from './idempotency.js';

// Processes a customer refund. Requests without an idempotencyKey get a key
// derived from the payload, so a retried call can never refund twice — see
// docs/runbooks/idempotency.md.
export async function processRefund(req) {
  const key = req.idempotencyKey
    ? `refund:${req.idempotencyKey}`
    : deriveKey('refund', { orderId: req.orderId, amount: req.amount });
  return once(store, key, () => refund({ orderId: req.orderId, amount: req.amount }));
}
