// Shared idempotency helper for money-moving entry points. Any operation that
// must not happen twice derives a stable key (from the caller's idempotencyKey
// or from the request payload) and routes through once().
import crypto from 'node:crypto';

const inflight = new Map();

export function deriveKey(scope, parts) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
  return `${scope}:${hash}`;
}

// Runs produce() at most once per key. The key is claimed synchronously, so
// concurrent callers share one execution, and the receipt is persisted, so a
// retry after a restart returns the stored receipt instead of re-running.
export async function once(store, key, produce) {
  const existing = store.get(key);
  if (existing) return { ...existing, duplicate: true };
  if (inflight.has(key)) return { ...(await inflight.get(key)), duplicate: true };
  const pending = (async () => {
    const receipt = await produce();
    store.set(key, receipt);
    return receipt;
  })();
  inflight.set(key, pending);
  try {
    return await pending;
  } finally {
    inflight.delete(key);
  }
}
