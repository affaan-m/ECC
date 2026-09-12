# Plan Canvas loading hang TDD evidence

## Source

No implementation plan was supplied. The journeys and guarantees below were
derived from the reported intermittent localhost loading hang, especially when
opening a second Plan Canvas in one agent chat.

## User journeys

1. As a reviewer opening plans from multiple ECC worktrees, I want every new
   Canvas to use the current server code so an older same-version process cannot
   disable or stall the page.
2. As a reviewer opening a plan with Mermaid diagrams, I want the Canvas page to
   finish loading even when the Mermaid CDN is slow or unavailable.
3. As a reviewer with several Canvas tabs still open, I want the next Canvas to
   receive and render its document instead of waiting forever for a browser
   connection slot.

## Task report

### Replace a stale same-version detached server

- RED: `node tests/integration/plan-canvas-e2e.test.js` produced 9 passes and
  1 failure. The current CLI reused a fake legacy server that reported the same
  package version and sent the session-open request to it.
- RED checkpoint: `5dc6d85c test: add reproducer for stale plan canvas server`.
- GREEN: the health handshake now carries a protocol version and a SHA-256
  fingerprint of every module loaded into the detached Canvas server. The CLI
  retires any process whose package, protocol, or runtime fingerprint differs.
- GREEN: `node tests/integration/plan-canvas-e2e.test.js` produced 10 passes and
  0 failures.
- GREEN checkpoint: `7e0d115e fix: restart stale plan canvas servers`.

### Keep Mermaid enhancement from blocking page load

- RED: `node tests/scripts/plan-canvas.test.js` produced 27 passes and 1
  failure. The generated artifact loaded Mermaid with top-level `await`, which
  allowed an unresolved remote import to hold the document load event open.
- RED checkpoint: `ca0d0415 test: reproduce mermaid page load stall`.
- GREEN: the dynamic Mermaid import now starts from an async `load` listener.
  Browsers do not await that listener, so diagrams remain progressive
  enhancement and the raw Mermaid source remains available during a network
  stall.
- GREEN: `node tests/scripts/plan-canvas.test.js` produced 28 passes and 0
  failures.
- GREEN checkpoint: `7fc31254 fix: keep mermaid from blocking canvas load`.

### Stop open canvases from exhausting the browser connection pool

- RED: the normal Chrome profile showed an `Untitled` blank tab with its load
  indicator running indefinitely. `lsof -nP -iTCP:4517` showed exactly six
  established connections from Chrome's network service to Plan Canvas. Each
  older Canvas tab owned one permanent `EventSource`, exhausting Chromium's
  six-connection HTTP/1 pool before the next document request could receive a
  byte.
- RED: the focused integration test failed because `/client.js` still created
  `EventSource`, `/api/session/:key/state` did not exist, `/events/:key` held
  its response open, and health still advertised protocol 2.
- GREEN: protocol 3 replaces per-tab EventSource streams with one-second,
  finite state requests carrying chat, presence, session status, and artifact
  revision. Polls are sequential and abort after five seconds, so they cannot
  pile up. Legacy `/events/:key` now returns HTTP 204, the status that tells an
  existing EventSource client not to reconnect after the server upgrade.
- GREEN: `node tests/scripts/plan-canvas.test.js` produced 31 passes and 0
  failures, including preservation of the active-browser idle lifecycle.
  Focused ESLint and `git diff --check` passed.
- BROWSER: nine Canvas tabs were opened in one Chrome automation profile on an
  isolated protocol-3 server. Every tab reached `document.readyState =
  complete`, exposed its expected plan heading through the iframe accessibility
  tree, and reported zero EventSource resources. Two shared keep-alive sockets
  served the nine tabs at the observation point.
- DESKTOP: the normal Chrome profile kept the original blank protocol-2 tab
  visible while three protocol-3 canvases on the isolated port rendered the
  Sandbox Execution Fabric, Feature Fleet, and ECC 2 to ECC 3 plans. A captured
  desktop-window image showed all three rendered tabs and live `agent listening`
  presence.

## Test specification

| # | What is guaranteed | Test target | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | A legacy server with the same package version is shut down before the current CLI opens a plan | `same-version legacy server is replaced before a canvas opens` | End to end | PASS |
| 2 | Health exposes package, protocol, and exact Canvas runtime identity | `GET /health identifies the app and version` | Integration | PASS |
| 3 | Mermaid remote enhancement starts only after document load | `a plan containing mermaid serves the themed Mermaid loader` | Integration | PASS |
| 4 | Open, browser load, await, feedback, reply, approval, reopen, end, and stop still work together | `tests/integration/plan-canvas-e2e.test.js` | End to end | PASS |
| 5 | The large ECC 2 to ECC 3 master plan bootstraps under blocked local storage | Headless Chrome DOM and screenshot check against `/canvas/24af75d4c4fe` | Browser | PASS |
| 6 | The browser client never reserves one permanent HTTP connection per open Canvas | `browser client uses finite polling instead of one permanent connection per canvas` | Integration | PASS |
| 7 | Old EventSource clients stop reconnecting after upgrading the server | `legacy EventSource endpoint retires without reconnecting` | Integration | PASS |
| 8 | Browser polling carries chat, presence, end state, and artifact revision | Browser-state integration cases in `tests/scripts/plan-canvas.test.js` | Integration | PASS |
| 9 | More than Chromium's six HTTP/1 connection slots can coexist without blocking a new Canvas | Nine-tab Chrome DOM, accessibility-tree, resource-timing, and screenshot run | Browser | PASS |
| 10 | An actively viewed Canvas keeps the shared server alive through finite polls | `finite browser polls keep an actively viewed canvas server alive` | Integration | PASS |

## Coverage and full-suite evidence

`npm run coverage` passed all 3,996 discovered tests with these project totals:

- Statements: 88.98%
- Branches: 80.65%
- Functions: 94.34%
- Lines: 88.98%

The `scripts/lib/plan-canvas` group reached 98.53% statements, 87.82% branches,
100% functions, and 98.53% lines. Focused ESLint checks passed for every
modified JavaScript test and production file.

## Browser evidence and known gaps

The live shared server was initially process `15351`, started from the older
`ecc-tiered-sandbox` worktree, and served an unguarded `localStorage` client even
when invoked from current main. The first patch replaced it with the isolated
worktree server and restored persisted sessions. That did not establish the
reported bug was fixed: HTTP 200 responses and a fresh-profile screenshot did
not exercise the saturated normal browser profile.

The corrected investigation captured the real blank tab, its six live browser
connections, and the exact release-preview session behind it. The final browser
run used an isolated protocol-3 server on port 4518 so other agents could not
replace the executable under test. It rendered the actual in-progress Sandbox
Execution Fabric from the tiered-sandbox worktree, plus Feature Fleet and the
ECC 2 to ECC 3 master plan, in the normal desktop Chrome profile. Active agent
listeners remained attached to all three.

Chrome was exercised directly on macOS through both the user's normal profile
and a browser-automation profile. Safari and Firefox were not run. The
connection-pool fix relies on ordinary finite `fetch` requests, `AbortController`,
HTTP 204 EventSource retirement behavior, and file metadata for live-reload
revision checks.
