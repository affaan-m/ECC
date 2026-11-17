# sentinel-paste

Internal paste-sharing service. In-memory store, Node.js standard library only.

## API contract

- `POST /pastes` — JSON body `{ "content": string }`. `201` with
  `{ "id", "deleteToken" }`. Request bodies larger than 64 KB are rejected with
  `413 Payload Too Large`.
- `GET /pastes/:id` — `200` JSON `{ "id", "content" }`, or `404`.
- `DELETE /pastes/:id` — requires the `X-Delete-Token` header to match the
  token returned at creation. `204` on success, `403` otherwise. Delete tokens
  are shown once and must be unguessable.
- `GET /p/:id` — HTML view of a paste. The paste content is rendered as text:
  it must never be interpreted as markup.
- `GET /files?name=<name>` — serves a public file from `data/files/`. Only
  files inside that directory may ever be served.
- `GET /admin/stats` — operational stats. Requires the `X-Admin-Token` header
  to match the `ADMIN_TOKEN` environment variable; the service reads it at
  startup and refuses all admin access (`401`) when it is missing or wrong.
  The token must never be committed to the repository.

## Module contract

- `src/app.js` is CommonJS and exports `createApp()`, which returns an
  `http.Server` that is not yet listening.
- `node src/index.js <port>` starts the service.
- Run the tests with `npm test`.
