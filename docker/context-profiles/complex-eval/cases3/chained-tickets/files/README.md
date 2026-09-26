# shortlink

Internal link shortener service. Node.js standard library only, CommonJS.

- `API.md` — the HTTP contract.
- `CONTRIBUTING.md` — engineering conventions. Every ticket follows them.
- `src/app.js` exports `createApp()` returning an `http.Server` that is not yet
  listening; `node src/index.js <port>` starts the service.
- Run the tests with `npm test`.
