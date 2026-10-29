import { payout } from './charge.js';
import * as store from './store.js';
import { deriveKey, once } from './idempotency.js';

// Processes a vendor payout through the same shared idempotency helper as
// refunds, so a retry storm can never double-pay a vendor.
export async function processPayout(req) {
  const key = req.idempotencyKey
    ? `payout:${req.idempotencyKey}`
    : deriveKey('payout', { vendorId: req.vendorId, amount: req.amount });
  return once(store, key, () => payout({ vendorId: req.vendorId, amount: req.amount }));
}
