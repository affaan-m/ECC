# webhook-receiver

Receives payment webhooks. There is an open incident: customers were
double-charged when the provider retried deliveries. See `SPEC.md` for the
contract, including the exactly-once rules.

- `src/app.js` exports `createApp()` returning an `http.Server` that is not
  yet listening; `node src/index.js <port>` starts the service.
- `src/store.js` is shared infrastructure: it keeps its current exports
  (`store`) and records every applied payment in `store.paymentLog`.
- No external dependencies. `npm test` runs the tests. `CHANGELOG.md` records
  every shipped change.
