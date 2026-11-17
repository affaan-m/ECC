# Shortlink API

- `POST /links` — body `{ "url": string, "ttlSeconds"?: number }`.
  - `201` → `{ "code", "shortUrl", "expiresAt" }`. `code` is 6–10
    alphanumeric characters; `shortUrl` is `/<code>`; `expiresAt` is an ISO
    timestamp. Default TTL is 7 days; `ttlSeconds` must be an integer between
    1 and 2592000 (30 days).
  - Missing/invalid `url` or out-of-range `ttlSeconds` → `400`.
- `GET /<code>` — `302` with `Location` set to the original URL.
  Unknown code → `404`. Expired link → `410`.
- `DELETE /links/<code>` — `204`. Unknown code → `404`.

All error responses follow the envelope in `CONTRIBUTING.md`.
