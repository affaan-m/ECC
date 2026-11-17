# Engineering conventions

These conventions apply to every ticket, every route, every change:

- **Errors**: every error response is JSON with the envelope
  `{ "error": { "code": "<SCREAMING_SNAKE>", "message": "<human readable>" } }`
  and the matching HTTP status. No HTML error pages, no stack traces.
- **Layering**: HTTP handling in `src/routes.js`, business logic in
  `src/service.js`, storage in `src/store.js`. `src/app.js` wires them.
- **Runtime config** comes from environment variables, read at startup.
- **Every ticket**: add tests under `test/`, add a `CHANGELOG.md` entry
  describing what shipped, and keep `README.md` accurate.
- No external dependencies.
