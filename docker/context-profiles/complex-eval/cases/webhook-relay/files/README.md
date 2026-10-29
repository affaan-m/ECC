# webhook-relay

In-memory webhook relay. Accepts delivery requests over HTTP and POSTs each
payload to its destination URL, retrying failures with exponential backoff.

## HTTP API

- `POST /deliveries` — body `{ "url": string, "payload": any }`. Responds
  `202` with `{ "id" }` and delivers asynchronously. `400` for invalid JSON.
- `GET /deliveries/:id` — `200` with
  `{ "id", "url", "status", "attempts", "lastError" }`, or `404`.
  `status` is `pending`, `delivered`, or `dead`.

## Delivery contract

- The payload is POSTed to `url` with `content-type: application/json`.
- Any 2xx response means success: `status` becomes `delivered`.
- Any other outcome (non-2xx, connection error, timeout) is a failure and is
  retried with exponential backoff: the first retry happens after about
  100ms and the delay doubles each retry. Up to 20% jitter in either
  direction is fine.
- At most 5 attempts are made in total (the initial try plus 4 retries).
- After the final failure the delivery becomes `dead` and `lastError`
  records a short description of the last failure.
- `attempts` always reflects how many delivery attempts were made.

## Module contract

- `src/app.js` is CommonJS and exports `createRelay()`, which returns an
  `http.Server` that is not yet listening.
- `node src/index.js <port>` starts the service.
- No external dependencies; Node.js standard library only.
- Run the tests with `npm test`.
