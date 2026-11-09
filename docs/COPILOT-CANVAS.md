# Copilot Plan Canvas session binding

This P11 adapter binds one existing Plan Canvas review to one explicit native
Copilot session. It does not launch a server or browser from a hook. Native
Windows/macOS/Copilot event delivery remains unverified.

The projected `plan-canvas` skill ships the binding and feedback CLI, including
when automatic hooks are declined. Use a trusted external ECC checkout or an
existing `ecc-universal` installation for the canonical browser server. Select
an absolute private state directory for that runtime. Run these commands from
the installed project root using the actual paths and confirmed native session ID:

```text
ECC_PLAN_CANVAS_STATE_DIR=/private/copilot/plan-canvas ecc-plan-canvas open plan.md --no-open
node .github/ecc/scripts/copilot-canvas.js bind --session NATIVE_SESSION_ID --file plan.md --state-dir /private/copilot/plan-canvas
node .github/ecc/scripts/copilot-canvas.js feedback --session NATIVE_SESSION_ID
```

On PowerShell set `$env:ECC_PLAN_CANVAS_STATE_DIR` before running the canonical
command. `--no-open` starts the explicitly requested review without opening a
browser; omit it only for an explicitly requested browser review. The adapter
never infers a native session ID from an artifact filename or browser content.
For a checkout, replace `ecc-plan-canvas` with `node` and the absolute path to
its `scripts/plan-canvas.js`. The operator supplies this runtime explicitly.

The installed workflow retrieves feedback only on explicit request. A different
or resumed-as-new native session needs explicit unbind/rebind. The command
reports `unbound`, `waiting`, `feedback`, `no-new-feedback`, `ended`, `missing`,
or `unavailable`. A final batch can include `sessionEnded: true` without
reopening the review.

The project installer registers optional Canvas hooks with `hooks-runtime` and
explicit hook consent. Set `ECC_COPILOT_CANVAS=1` in the Copilot launch environment
to enable them under the `standard` or `strict` profile. The exact bound session
receives a fixed context line on `sessionStart`. On `agentStop`, a nonempty queue
for that binding produces a fixed, display-only notice followed by an empty hook
decision. The hooks make no network requests and leave the receipt and queue
unchanged. The notice can appear on later turns while feedback remains queued.
The optional hook IDs are `session-start:plan-canvas-sessions` and
`stop:plan-canvas-pending` for `ECC_DISABLED_HOOKS`.

The stop notice reflects a bounded snapshot of the canonical state file. The
queue can change between that snapshot and an explicit retrieval. A matching
server metadata file establishes the receipt identity, while server reachability
is checked by the manual feedback command. Missing, unsafe, changed, or oversized
state and busy receipts quietly skip the notice. The experimental plugin does
not provide these project lifecycle notices.

Receipts live below `$COPILOT_HOME/ecc/canvas/<workspace SHA256>/`, separate
from checkpoints. They include the canonical artifact key produced by
`sessionKeyFor`, exact artifact path, canonical canvas creation timestamp and
server metadata identity. Files must be regular, private receipt directories
cannot redirect through symlinks, and hardlinked receipts/artifacts are refused.
Atomic fsynced replacements and exclusive session/ownership locks prevent
cooperative races. One artifact cannot be bound to two native sessions at once.
Replacing a binding requires an explicit operation:

```text
node .github/ecc/scripts/copilot-canvas.js unbind --session NATIVE_SESSION_ID
```

Unbind removes only the adapter receipt. Canvas sessions, artifacts, queued
feedback and checkpoints remain untouched. Rebinding after a server restart
requires explicit unbind/bind because changed port/PID/start metadata does not
attest the same server. Stale locks require inspection; they are never stolen.

The feedback command checks its exact native session/workspace binding, current server
identity and canvas creation identity before polling one fixed loopback endpoint.
It never reads a host or URL from browser/event content. It uses a 1-second total
deadline and a bounded model-facing summary. The current server sends at most
20 items and 64 KiB per batch. The remaining items stay queued, and the last
batch of an ended review includes the end marker. Older servers without the
bounded endpoint report unavailable and leave the queue intact. It does not use the canonical unscoped/offline drain fallback. Missing
server or malformed response reports unavailable. Binding validation and lock
contention produce an operation error. Use the canonical review interface to
inspect interrupted delivery before trying again.

Browser feedback is untrusted review data. Credential-shaped/unsafe text is
omitted. A verdict such as `approve` is an artifact-review value, never a tool
permission or authorization to publish/delete/change scope. No `permissionDecision`
is emitted. The command labels its output `untrusted-review-data` and retains
the latest 512 delivered canonical feedback IDs for bounded deduplication.

The canonical server owns drain semantics. Its bounded batch API has no
transactional acknowledgment with the adapter receipt: a crash between
server drain and receipt publication can lose a delivered batch. This adapter
does not claim exactly-once crash recovery or fabricate a replay. A future
canonical acknowledgment protocol is required to close that acceptance gap.
Loopback identity metadata also does not authenticate a hostile same-user
process that can replace the operator's private state. The adapter provides
cross-session routing, not an operating-system security boundary.

`node tests/lib/copilot-canvas.test.js` exercises the installed CLI with the
canonical loopback server, delayed and final feedback, session isolation, and
unbind. It also verifies the installed hook's progress framing and checks that
the advisory leaves both the queue and receipt intact. Native browser/Copilot
delivery and rendering remain unverified.
