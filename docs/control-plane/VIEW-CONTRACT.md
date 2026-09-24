# ECC control-plane live view: `ecc.control-plane.view.v1`

Status: shipped with the control pane (`scripts/lib/control-pane/control-plane-view.js`). Read-only. Advisory only.

The view joins three things the repo already computes separately and serves them as one JSON document shaped as tasks, lanes and events, so another control plane (the Ito ops board, a Hermes or Codex reader, a hook) can consume it without knowing ECC internals.

| Input | Where it comes from |
|---|---|
| Sessions | `scripts/lib/control-pane/state.js`, the ECC2 `sessions` table |
| Pairwise proximity | `scripts/lib/agent-proximity/` (noisy-OR over `x_tree`, `x_overlap`, `x_dep`) via `scripts/lib/control-pane/proximity.js` |
| 2D projection | `scripts/lib/agent-proximity/projection.js` (rolling z-score, tails clipped at 2.5 / 97.5, PCA) |
| Coordination inventory | `scripts/lib/coordination-inventory.js` (PR #3028): declared tasks and sessions, heartbeat freshness, lease conflicts |

## Endpoints

Served by `node scripts/control-pane.js` (loopback only, same Host and Origin gate as the rest of the pane):

| Route | Returns |
|---|---|
| `GET /control-plane` | Self-contained HTML page: 2D projection canvas, lanes and tasks, event feed. No external scripts. |
| `GET /api/control-plane` | The full view document below. |
| `GET /api/control-plane/events` | `{ schemaVersion, generatedAt, thresholds, events, counts }` only, for hooks and pollers. |

The server keeps one projection window per process. Both API routes share a snapshot cached for five seconds, and concurrent refresh requests are coalesced. Reads within that interval do not add samples. After expiry, the next read refreshes the snapshot once; idle intervals do not generate synthetic samples. Failed refreshes return errors rather than healthy empty data. The page rejects failed HTTP responses and invalid view envelopes and shows `offline`. Options on `createControlPaneServer`: `projection` (`windowSize`, `clipPercentiles`), `viewOptions` (`thresholds`, `manifest`, `channelWeights`, `minWindowForZscore`), `proximityOptions` (passed to the scan).

## Document

```json
{
  "schemaVersion": "ecc.control-plane.view.v1",
  "generatedAt": "2026-09-11T20:01:00.000Z",
  "source": { "snapshotSchema": "ecc.control-pane.snapshot.v1", "repoRoot": "...", "dbPath": "..." },
  "thresholds": { "ta": 0.35, "ra": 0.7, "source": "static" },
  "lanes": [ { "id": "harness:codex", "label": "codex", "kind": "harness", "taskIds": ["session-a"] } ],
  "tasks": [ { "...": "see Task" } ],
  "pairs": [ { "...": "see Pair" } ],
  "events": [ { "...": "see Event" } ],
  "projection": { "...": "see Projection" },
  "inventory": { "...": "see Inventory" },
  "counts": { "lanes": 1, "tasks": 1, "agents": 1, "pairs": 0, "events": 0, "advisories": 0, "resolutions": 0 },
  "limits": [ "..." ]
}
```

### Task

One task per session. A session with no changed files is still a task; it has no projection point and no pairs.

| Field | Meaning |
|---|---|
| `id` | Session id, unchanged. |
| `lane` | Lane id this task belongs to. |
| `label` | Session task text, or the id. |
| `harness`, `agentType`, `state`, `pid` | From the session row. |
| `worktree` | `{ path, branch, base }` or `null`. |
| `heartbeatAt`, `updatedAt` | ISO timestamps or `null`. |
| `workingSet` | `{ fileCount, files }`: the worktree diff against its base. |
| `projection` | `{ point, pairs, maxRisk }` where `point` is `[x, y]` or `null`. `point` is the risk-weighted centroid of the task's pair points in PCA space. |
| `inventory` | `{ id, heartbeat, process, authority: "declared-only" }`. `id` is the sanitized identifier used in the inventory manifest; `heartbeat` and `process` are the #3028 observations. |

### Lane

A grouping of tasks. Precedence: `task-group` (session `task_group`), then `project`, then `harness`. Ids are prefixed (`group:`, `project:`, `harness:`) so a consumer can tell the kinds apart without reading `kind`.

### Pair

One row per agent pair from the airspace scan (only sessions with edits participate).

| Field | Meaning |
|---|---|
| `a`, `b` | Session ids. |
| `risk`, `level` | Noisy-OR risk and the scan's level (`clear`, `advisory`, `resolution`) at the scan's thresholds. |
| `channels` | Raw `{ x_tree, x_overlap, x_dep }` in [0, 1]. |
| `normalized` | The same after z-score, clip and map-back, or equal to `channels` while the window is cold. |
| `point` | `[pc1, pc2]` PCA scores. |

### Event

Something an operator or a hook may act on. Ids are deterministic across polls so a consumer can dedupe.

```json
{
  "id": "proximity.advisory:session-a|session-b:resolution",
  "kind": "proximity.advisory",
  "level": "resolution",
  "severity": "critical",
  "at": "2026-09-11T20:01:00.000Z",
  "subject": { "a": "session-a", "b": "session-b", "aLabel": "...", "bLabel": "..." },
  "risk": 1,
  "distance": 0,
  "channels": { "x_tree": 1, "x_overlap": 1, "x_dep": 0 },
  "threshold": { "ta": 0.35, "ra": 0.7, "crossed": "ra", "source": "static" },
  "action": { "type": "steer", "steer": "session-b", "hold": "session-a" },
  "message": "Resolution advisory: session-b steers, session-a holds (risk 100%, static threshold 0.7)."
}
```

| Kind | Levels | Action types | Source |
|---|---|---|---|
| `proximity.advisory` | `traffic` (risk at or above `ta`), `resolution` (at or above `ra`) | `transmit` (both agents share intent), `steer` (`steer` moves, `hold` keeps course) | Every pair link, evaluated against the view's thresholds. Right-of-way: more progress, then earlier start, then stable id. |
| `inventory.lease-conflict` | `conflict` | `review` | #3028 `leaseConflicts`. Declared-only, never a lock. |

Thresholds are static per view (`source: "static"`). A learned threshold, closure-rate escalation, and the `pause` and `wait` maneuvers are slice (b), see `TCAS-HOOK.md`.

### Projection

```json
{
  "method": "pca",
  "channels": ["x_tree", "x_overlap", "x_dep"],
  "weights": { "x_tree": 0.25, "x_overlap": 1, "x_dep": 0.9 },
  "normalization": "zscore-clipped",
  "window": { "samples": 12, "percentiles": [2.5, 97.5], "channels": [ { "channel": "x_tree", "mean": 0.39, "stddev": 0.42, "clipLow": -0.92, "clipHigh": 1.45 } ] },
  "pca": { "loadings": [ { "x_tree": 0.12, "x_overlap": 0.87, "x_dep": -0.47 }, { "...": "..." } ], "explainedVariance": [0.6, 0.39] },
  "agents": [ { "agentId": "session-a", "point": [0.18, 0.41], "pairs": 3, "maxRisk": 1 } ]
}
```

Pipeline per poll: every pair's channel vector is pushed into a rolling window (default 512 samples). Once the window holds at least 8 samples, each channel is z-scored against the window, clipped to the window's 2.5th and 97.5th percentile (in z units), mapped back to [0, 1], multiplied by the static channel weight, and the weighted matrix goes through PCA (Jacobi on the 3x3 covariance). Below 8 samples the raw channel values are used and `normalization` says `raw`. A channel with zero variance maps to 0.5. Degenerate inputs (fewer than two pairs, zero total variance) give zero scores, never NaN.

The projection is a display. It never changes `risk`, the advisory level, or right-of-way.

### Inventory

The #3028 report with the per-task rows folded into `tasks[].inventory`. Kept at the top level: `status` (`ok` or `unavailable` with `reason`), `truncated` (more than 64 sessions), `observedAt`, `mode: "read-only"`, `activity`, `leaseConflicts`, `warnings`, `coverage`, `limits`. The manifest is built from the live sessions (ids sanitized to the inventory alphabet, paths from the working set, heartbeat from the session row, declared session status `open` for running/pending/idle, `closed` for completed/failed/stopped). An external manifest (`viewOptions.manifest`) can add `goals`, `leases`, `repositories` and extra `tasks`; the inventory then reports lease conflicts and goal activity for them.

## Reuse in the Ito ops control plane

The shape to copy is `task`, `lane`, `event`:

- a **task** has an `id`, a `lane`, a `state`, an optional position, and an observation block whose `authority` says how much to trust it;
- a **lane** is a named group with ordered `taskIds`;
- an **event** has a stable `id`, a `kind`, a `level`, a `severity`, an `at`, a `subject`, an `action` with a `type`, and a human `message`.

Nothing in the shape is ECC-specific except the event kinds. An ops board that renders lanes of tasks and a feed of events can render this document as-is, and can emit its own kinds (`deal.stalled`, `bridge.down`) into the same feed.

## What this does not do

- No leases are acquired, no agent is paused or steered. Consumers act; the view reports.
- No conflict-reduction percentage is claimed. The 85 percent goal in the push plan is measured two weeks before and after slice (b), not here.
- No semantic, call-graph or frequency channel yet (slice (g)). PCA picks new channels up automatically when they land in the scan.
