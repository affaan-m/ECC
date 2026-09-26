# The production bar

Every production service here meets all of the following, all the time:

- **Validation**: malformed JSON, missing fields, and wrong types are rejected
  with `400` and a structured JSON error body
  `{ "error": { "code": "<SCREAMING_SNAKE>", "message": "..." } }`. Unknown
  resources are `404` in the same envelope. No stack traces, no HTML errors,
  no hanging connections.
- **Body limits**: request bodies over 64 KB are rejected with `413`, same
  envelope.
- **Health**: `GET /health` returns `200` with `{ "status": "ok" }`.
- **Logging**: one structured JSON log line per request with at least
  `method`, `path`, and `status` fields.
- **Configuration**: runtime configuration (port, limits) comes from
  environment variables, read at startup. Nothing secret is hardcoded.
- **Shutdown**: the service closes cleanly on `SIGTERM` (stops accepting,
  drains, exits).
- **Headers**: responses carry `X-Content-Type-Options: nosniff`.
- **Tests**: the suite covers error paths, not just the happy path.
- **Changelog**: every shipped change has a `CHANGELOG.md` entry.
