# Changelog

- 2026-09-25: Initial shortlink core — create, redirect, expiry, and delete per API.md.
- 2026-09-25: Persistence — links survive restarts via the DATA_FILE JSON store; missing or corrupt data files start clean.
- 2026-09-25: Abuse protection — URL validation (http/https only, length cap), request body limits, and per-client rate limiting with 429 responses.
- 2026-09-25: Analytics — per-link redirect hit counts exposed at GET /links/:code/stats.
