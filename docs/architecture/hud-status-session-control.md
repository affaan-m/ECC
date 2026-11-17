# HUD Status And Session Control Contract

This contract defines the portable status payload ECC uses for local operator
surfaces, handoffs, and future HUDs. It is intentionally harness-neutral: a
Claude Code statusline, Codex pane, dmux session, OpenCode run, or terminal-only
workflow can emit partial data without changing field names.

The canonical example lives at
[`examples/hud-status-contract.json`](../../examples/hud-status-contract.json).

## Payload Shape

Every status payload uses `schema_version: "ecc.hud-status.v1"` and keeps these
top-level sections stable:

| Field | Purpose | Primary Source |
|---|---|---|
| `context` | Model, harness, repo, branch, worktree, session id, and context-window pressure | statusline stdin, git, session adapters |
| `toolCalls` | Recent tool counts, pending calls, stale calls, and last tool event | `loop-status`, `tool-usage.jsonl`, hook bridge |
| `activeAgents` | Current workers/subagents, runtime state, branch, worktree, objective, and handoff paths | dmux/orchestration snapshots |
| `todos` | Current in-progress task and todo counts | Claude todos, local task files, plan metadata |
| `checks` | Local and remote validation status with command/check URLs when available | CI, local commands, release gates |
| `cost` | Session spend, token counts, budget, and trend | cost tracker, metrics bridge |
| `risk` | Attention state, conflict pressure, stale calls, dirty worktree, and manual-review flags | readiness gates, git, queue state |
| `queueState` | GitHub PR/issue/discussion counts, conflict queue, merge queue, and stale-salvage queue | GitHub sync, work items |
| `sessionControls` | Supported operator actions for the current target | ECC CLI, dmux, git/GitHub |
| `sync` | Linear, GitHub, and handoff publication state | status updates, work items, handoff writer |

Fields can be `null`, empty arrays, or `"unknown"` when a harness cannot expose
the signal. Producers should not invent incompatible names. Consumers should
render missing sections as unavailable, not as green.

## Session Controls

The minimum session-control vocabulary is:

| Control | Meaning |
|---|---|
| `create` | Start a new isolated run, worktree, or orchestration plan |
| `resume` | Reattach to an existing session or historical target |
| `status` | Emit the current payload without mutating state |
| `stop` | Request a graceful stop or mark the session completed |
| `diff` | Show current working-tree or worker diff |
| `pr` | Open or inspect the linked pull request |
| `mergeQueue` | Show merge-ready, blocked, and waiting-check items |
| `conflictQueue` | Show dirty/conflicting PRs or worktrees needing integration |

`sessionControls.supported` lists the controls available for the current
harness. `sessionControls.blocked` explains unavailable controls, for example a
missing GitHub token, no tmux session, or a read-only adapter.

## Sync Contract

The sync section separates durable trackers:

- `Linear` records project status update id, health, and whether issue creation
  is blocked by workspace capacity.
- `GitHub` records the current repo, PR/issue/discussion queue counts, and the
  latest merged or open PR tied to the session.
- `handoff` records the durable Markdown handoff path and whether it has been
  written after the latest batch.

This makes real-time progress tracking explicit without requiring every run to
create Linear issues or GitHub comments. When Linear issue capacity is blocked,
the status payload can still prove progress through project updates and repo
handoffs.

## Current Implementations

- `ecc status --json` exposes readiness, active sessions, skill runs, install
  health, governance, and linked work items from the SQLite state store.
- `ecc loop-status --json --write-dir <dir>` writes live transcript snapshots
  and attention signals for long-running loops.
- `ecc session-inspect <target> --write <path>` emits canonical session
  snapshots from dmux and Claude-history adapters.
- `scripts/hooks/ecc-statusline.js` renders compact model, task, cost, tool,
  file, duration, directory, and context pressure signals inside Claude Code.

The `ecc.hud-status.v1` payload is the common outer contract these surfaces can
project into before ECC grows a dedicated full-screen HUD.

## State Store Concurrency And Recovery

ECC's file-backed state store serializes each synchronous query or transaction
with a sibling `<database>.ecc-state.lock` file. It checks the current database
under that lock and publishes successful writes before releasing it. A handle
can reuse its last successful read snapshot when the file identity, size, and
modification/change timestamps match. Fixed SELECTs in the query API avoid
reloading or exporting an unchanged database; query results are still computed
afresh. Generic SQL, transactions, exports, and failed operations invalidate
reuse. Changes from another writer trigger a reload on the next operation.
Queries use one snapshot; closing a handle never writes an older snapshot back.
All concurrent writers must use this adapter; older ECC versions and external
SQLite writers do not participate in this locking protocol.

An operation waits up to five seconds before reporting `STATE_STORE_BUSY`.
Retry when the other operation finishes. Locks are never stolen based on age:
a paused process may still be writing. After an abnormal exit, stop all ECC
processes using that database, inspect the PID and hostname in the lock file,
and remove only the leftover `.ecc-state.lock` file before retrying. Do not
remove the database itself. In-memory stores do not create lock files.

The control-pane HTTP server runs board claims and moves in one-shot workers,
so waiting for another writer does not stall health checks or snapshots. A
mutation that times out while lock creation reports `EEXIST` returns HTTP 503
with `code: STATE_STORE_BUSY` and `Retry-After: 1`. On Windows, lock creation
also retries `EPERM` within the same deadline because deletion may still be
pending. If the final attempt still reports `EPERM`, the original permission
error is preserved rather than replaced with busy or leftover-lock recovery
advice. Invalid mutations continue to return HTTP 400. Each worker
closes its store before reporting the result and exits naturally, including
when the requesting browser disconnects, to avoid interrupting a write.

At most two board-mutation workers may exist in a server process, shared
across database paths and server instances. Admission happens before worker
creation. When both slots are occupied, extra requests receive the same
retryable HTTP 503 immediately; they are not queued or executed later.
A slot remains occupied until the worker actually exits, including after a
result, error, or browser disconnect. Construction failure releases the slot
immediately. This bounds waiting workers even while the database is locked.
