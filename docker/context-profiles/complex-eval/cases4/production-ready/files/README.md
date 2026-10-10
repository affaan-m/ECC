# notes-service

Tiny notes API. Hobby prototype state: it works on the happy path and that's
about all that can be said for it.

## API

- `POST /notes` — body `{ "title": string, "body": string }` → `201` with
  `{ "id", "title", "body" }`.
- `GET /notes/:id` — `200` with the note, or `404`.
- `GET /notes` — `200` with `{ "notes": [...] }`.

`src/app.js` exports `createApp()` returning an `http.Server` that is not yet
listening; `node src/index.js` starts the service. `npm test` runs the tests.

## Operations

`docs/production-bar.md` lists what every production service here must meet.
`CHANGELOG.md` records every shipped change.
