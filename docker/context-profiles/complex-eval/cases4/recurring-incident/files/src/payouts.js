import { payout } from './charge.js';
import * as store from './store.js';

// Processes a vendor payout. Finance's batch job calls this once per payout
// run and has never retried, so the keyless path has never been exercised.
export async function processPayout(req) {
  const key = req.idempotencyKey ? `payout:${req.idempotencyKey}` : null;
  if (key && store.has(key)) {
    return { ...store.get(key), duplicate: true };
  }
  const receipt = await payout({ vendorId: req.vendorId, amount: req.amount });
  if (key) store.set(key, receipt);
  return receipt;
}
