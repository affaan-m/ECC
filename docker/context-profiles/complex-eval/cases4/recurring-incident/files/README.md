# payments-lite

A small dependency-free payments service core: refunds to customers and payouts
to vendors, executed against a fake gateway that records every call in an
append-only ledger.

## Layout

- `src/charge.js` — the gateway client. `charge()`, `refund()`, and `payout()`
  simulate network latency and append one JSON line per call to the ledger at
  `LEDGER_FILE` (default `.data/ledger.jsonl`). `readLedger()` parses it.
- `src/store.js` — a tiny JSON-file store at `STORE_FILE` (default
  `.data/store.json`): `get`, `has`, `set`. Reads and writes are synchronous.
- `src/refunds.js` — `processRefund(req)` for customer refunds.
- `src/payouts.js` — `processPayout(req)` for vendor payouts.

## API contract

`processRefund({ orderId, amount, idempotencyKey? })` and
`processPayout({ vendorId, amount, idempotencyKey? })` each return the gateway
receipt (`{ id, type, amount, ... }`). When the caller supplies an
`idempotencyKey`, a repeated call with the same key must not hit the gateway
again; it returns the stored receipt with `duplicate: true`. Keep these
signatures stable — the dashboard and the finance batch job call them directly.

## Working here

- No external dependencies. `npm test` runs the tests.
- Incident notes live in `docs/incidents.md`; add an entry when you work one.
