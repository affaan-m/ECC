# TCAS hook: pre-merge deconfliction (slice b, design)

Status: design only. Nothing in this document is implemented. Slice (a), the live view and the advisory feed it reads, shipped in `VIEW-CONTRACT.md`.

## Goal

Stop two agents from finishing overlapping edits and meeting at the merge. The scan already knows when two working sets converge; the hook is what turns that knowledge into a maneuver inside the harness, before either agent commits.

Push plan wording: "a PreToolUse/Edit hook that reads the advisory feed and returns steer, pause or wait for the lower-priority agent, logged to the capsule."

## Inputs

1. The event feed: `GET /api/control-plane/events` on the local control pane, or the same document written to a file by `scripts/proximity-tick.js --json` for sessions without a pane. Events of kind `proximity.advisory` with `action.type` `transmit` or `steer` and a deterministic `id`.
2. The hook's own session id. Claude Code passes `session_id` on stdin; the ECC session adapter maps it to the ECC2 `sessions.id` the scan uses. Codex and Hermes use the instruction-backed equivalent (see below).
3. The tool call: `tool_name` and `tool_input.file_path` for Edit, Write and MultiEdit. Bash is out of scope for v1.

## Decision

For each advisory event whose `subject` includes this session:

| Event | This session is | Maneuver | Hook result |
|---|---|---|---|
| `traffic`, action `transmit` | either side | **transmit**: inject the other agent's working set as a system message | exit 0, message on stderr (warn, never block) |
| `resolution`, action `steer` | `hold` | **hold**: continue | exit 0, short note |
| `resolution`, action `steer` | `steer`, and `file_path` is in the other agent's working set | **pause**: stop editing that file until the other agent's diff lands | exit 2 with the reason (blocks this one tool call) |
| `resolution`, action `steer` | `steer`, and `file_path` is not in the other agent's working set | **wait**: allowed, but told to keep to non-overlapping files | exit 0, message on stderr |
| `resolution`, action `steer` | `steer`, and a `steer` target exists | **steer**: suggest the disjoint files or subtree the agent should move to | exit 0, message; exit 2 only if the edit is on the shared file |

The maneuver is deterministic: both agents read the same event, `hold` and `steer` are named in it, so the two sides never pick the same move. This is the TCAS coordination property and it is why the view computes right-of-way once, centrally, rather than each hook deciding.

`pause` blocks a single tool call, not the session. The agent sees the reason and can pick another file. Blocking is bounded by the event's `at`: an event older than the pane's poll interval times three is stale and the hook does not block on it.

## Priority

Right-of-way comes from the event (`action.hold`, `action.steer`). The view computes it as more progress, then earlier start, then stable id (`rightOfWay` in `scripts/lib/agent-proximity/distance.js`). The hook never recomputes it.

## Logging to the capsule

Every decision is one entry in the session's capsule journal (`scripts/lib/eval-harness/capsule.js`, hash-linked NDJSON):

```json
{
  "kind": "tcas.decision",
  "event_id": "proximity.advisory:session-a|session-b:resolution",
  "session": "session-b",
  "tool": "Edit",
  "file": "src/api/users.js",
  "maneuver": "pause",
  "blocked": true,
  "risk": 1,
  "threshold": { "ta": 0.35, "ra": 0.7, "source": "static" },
  "at": "2026-09-11T20:01:03.000Z"
}
```

The capsule is the baseline counter for the 85 percent goal: rebase and merge-conflict triage incidents per week are counted from these entries plus `git rerere` and conflict markers, two weeks before and two weeks after the hook is on. No percentage is claimed before that.

## Where it plugs in

- **Claude Code**: a `PreToolUse` entry in `hooks/hooks.json` with matcher `Edit|Write|MultiEdit`, routed through `scripts/hooks/run-with-flags.js` so `ECC_HOOK_PROFILE` and `ECC_DISABLED_HOOKS` gate it. Script under `scripts/hooks/tcas-pre-edit.js`, helpers in `scripts/lib/control-pane/tcas.js`. Budget: under 200 ms, no network beyond loopback, exit 0 on any parse or fetch error.
- **Codex**: no PreToolUse. The instruction-backed equivalent is the `proximity_steer` / `proximity_hold` message the tick already writes into the ECC2 `messages` table, surfaced on the next turn. `pause` degrades to a strong instruction.
- **Hermes**: gateway hook on the tool-call path, same decision table, same capsule entry.

## Off switch and safety

- Disabled by default. On with `ECC_TCAS_HOOK=1` or the hook profile.
- Read-only against the pane. It never writes to the sessions or messages tables.
- No lease is acquired. Durable leases are slice (c), the worktree lease table in ecc2 `session/store.rs` next to `messages`; until then a `pause` is a per-call block, not a lock, and two hooks racing on the same file is possible but harmless (both see the same event and the same `steer`).
- Fails open. Any error is exit 0 with a `[TCAS]` line on stderr.

## Tests to write with it

- Decision table: one test per row above, driven by a fixture event feed and a stdin payload.
- Staleness: an event older than the window does not block.
- Fail-open: unreachable pane, malformed JSON, missing session id.
- Capsule: one entry per decision, hash chain intact, replay reproduces the same bytes.
- Integration: two fake sessions with overlapping working sets, the lower-priority one gets exit 2 on the shared file and exit 0 on a disjoint file.

## Out of scope for (b)

Learned thresholds, closure-rate escalation, mesh mode, cross-machine airspace, the `x_sem`, `x_vec`, `x_freq` channels (slice g), and the lease table (slice c).
