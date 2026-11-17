import { payout } from './charge.js';

// Track in-flight payouts so a burst of retries only sends one.
const pendingPayouts = new Map();

export async function processPayout(req) {
  const tag = `pay-${req.vendorId}-${req.amount}`;
  if (pendingPayouts.has(tag)) {
    const receipt = await pendingPayouts.get(tag);
    return { ...receipt, duplicate: true };
  }
  const pending = payout({ vendorId: req.vendorId, amount: req.amount });
  pendingPayouts.set(tag, pending);
  return pending;
}
