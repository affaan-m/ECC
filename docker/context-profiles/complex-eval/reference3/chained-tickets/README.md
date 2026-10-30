# shortlink

Internal link shortener service. Node.js standard library only, CommonJS.

- `API.md` — the HTTP contract.
- `CONTRIBUTING.md` — engineering conventions. Every ticket follows them.
- `src/app.js` exports `createApp()` returning an `http.Server` that is not yet
  listening; `node src/index.js <port>` starts the service.
- Links persist to the JSON file named by the `DATA_FILE` environment variable
  (default `./data/links.json`).
- `GET /links/<code>/stats` returns `{ "code", "hits", "expiresAt" }` —
  `hits` counts redirects.
- The API is rate limited per client and validates URLs (http/https only).
- Run the tests with `npm test`.
