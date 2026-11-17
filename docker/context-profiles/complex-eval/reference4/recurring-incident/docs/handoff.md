# Handoff: refunds & payouts idempotency

## What happened

Two incidents, one root cause family:

- **Refunds** (INC-201, INC-214, INC-227 in docs/incidents.md): refund requests
  arriving without an idempotency key were double-processed whenever the
  storefront retried, refunding customers twice.
- **Payouts**: finance's batch job is about to start retrying on timeouts, and
  keyless payout retries would double-pay vendors the same way.

## The fix

Both entry points now route through a single shared helper,
`src/idempotency.js` (`deriveKey` + `once`). `src/refunds.js` and
`src/payouts.js` derive a stable key from the request payload when the caller
sends none, claim it synchronously so concurrent retries share one execution,
and persist the receipt in `src/store.js` so retries after a restart return the
stored receipt. Gateway side effects all go through `src/charge.js`, so the
ledger is the source of truth for "did this actually happen".

## Regression coverage

`test/idempotency.test.js` covers keyless refund retries, restart durability,
and a 20-way concurrent payout storm. The pre-existing `test/refunds.test.js`
and `test/payouts.test.js` still cover the keyed contract. Everything is wired
into `npm test`; run it before touching any of this.

## Prevention

`docs/runbooks/idempotency.md` is the runbook: any new money-moving operation
must go through `src/idempotency.js`, ship with a retry regression test, and
log recurrences in `docs/incidents.md`. Do not bolt a second inline key-check
into a new module — extend the helper instead.
