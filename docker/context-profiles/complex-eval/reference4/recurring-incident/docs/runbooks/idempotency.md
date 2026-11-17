# Runbook: idempotency for money-moving operations

## The incident class

INC-201, INC-214, INC-227 (refunds) and the payout double-pay risk flagged by
finance are one class of bug: a caller retries a money-moving request that
carries no idempotency key, and the service executes it again. Asking clients
to retry less has failed three times; prevention must live in the service.

## The pattern

Every money-moving entry point routes through the shared helper in
`src/idempotency.js`:

- `deriveKey(scope, parts)` builds a stable key from the request payload when
  the caller did not supply one.
- `once(store, key, produce)` claims the key synchronously (concurrent retries
  share one execution) and persists the receipt (retries after a restart get
  the stored receipt back).

`src/refunds.js` and `src/payouts.js` both use it. Do not add a second inline
implementation of key derivation or seen-tracking in another module.

## Prevention procedure

For any new operation that moves money (charges, refunds, payouts, credits,
adjustments):

1. Route the side effect through `once()` from `src/idempotency.js` — never
   call the gateway directly from the entry point.
2. Add a regression test that retries the operation without a key (including
   a concurrent retry storm) and asserts the ledger shows exactly one effect.
3. Run `npm test` before merging.
4. If this class of bug recurs anywhere, log it in `docs/incidents.md` and
   extend this runbook instead of fixing silently.
