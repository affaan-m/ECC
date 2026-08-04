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
