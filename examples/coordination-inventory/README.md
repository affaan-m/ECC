# Read-only coordination inventory

One local JSON report joins declared task IDs and parent IDs, heartbeat age,
optional process metadata, OS RAM, declared resource leases and path/import
warnings. It reuses ECC's orchestration status parser and agent-proximity
scoring. It does not start a server or send messages.

From the repository root, with Node 18 or newer and no dependency install:

```sh
node scripts/coordination-inventory.js --manifest examples/coordination-inventory/manifest.json --now 2026-09-08T06:30:00.000Z
node scripts/coordination-inventory.js --coordination /path/to/coordination --live
node examples/coordination-inventory/evaluate.js
node --test tests/scripts/coordination-inventory.test.js
```

The first command uses a **synthetic** fixed-time fixture. It demonstrates a
parent/child pair with an import dependency, a stale heartbeat and conflicting
browser ownership declarations. The file grants no browser access.

`--coordination` reads direct child directories with `STATUS.md` or legacy
`status.md`. Structured `- State:` and UTC `- Updated:` fields use the existing
orchestration parser. Freeform status has unknown state/heartbeat; modification
time is reported separately. Symlink task directories and final status files
are not followed. Unreadable child directories make discovery partial; an
unavailable root is explicit, not an empty successful inventory.

`--live` samples OS total/free bytes and, for explicitly declared positive PIDs,
`ps` PID, parent PID, RSS, elapsed time and state flags on macOS/Linux. It uses a
two-second timeout without shell expansion. It never reads argv, environment,
transcripts or process executable names. Unsupported platforms and inaccessible
process telemetry are explicit. Free memory is not macOS memory pressure or a
safe allocation budget. No PID supplied means no process scan. PID identity and
PID reuse are not verified. An old heartbeat means inspection is useful; it
cannot prove that a process is stuck.

## Manifest contract

See `manifest.json`. Version 1 accepts repositories with IDs and source snippet
maps, tasks with IDs, optional parent IDs, repository IDs, repo-relative declared
paths, optional PIDs/status/UTC heartbeat times, and leases with resource, owner
and UTC expiry. Parent IDs can reference an external orchestrator. Repository
IDs scope warnings across separate checkouts; use the same logical repo ID for
workers editing the same repository. Duplicate task IDs are rejected, including
when combining a manifest with discovered status files.

Bounds: 1 MiB JSON, 64 tasks/repositories, 128 paths per task, 128 snippets per
repository, 1 KiB per snippet and 32 KiB snippets total, 128 leases. Snippets can
be just import statements plus empty entries for known targets. They are parsed
as text, never executed or emitted in the report. An aggregate comparison budget
rejects excessive pair/graph work; split large inputs into smaller inventories.
Only provide nonsensitive metadata in task IDs, status fields and paths.

Every result identifies coverage. Paths are declared intentions, not a scan of
all current edits. Only supplied relative JS/TS imports resolve. Missing paths
or source snippets mean incomplete visibility. Existing control-pane default
working sets use committed `base...HEAD` differences and can miss dirty and
untracked work; this example does not claim to fix that separate adapter.

Leases are owner declarations, not enforced locks. Expired entries are visible
but excluded from simultaneous-owner conflicts. An unexpired entry does not
prove the owner is alive or authorized. The caller supplies those declarations;
the inventory never acquires, renews or releases leases. No lease records means
ownership is unknown. No pause, steer, kill, settings change or allocation occurs.

## Evaluation and limitations

Eight authored synthetic pairs compare an exact-path baseline with ECC's
existing overlap/import/tree heuristic, using threshold 0.35. Tree proximity
alone does not trigger a warning. The score is not a calibrated probability.

| Detector | True positive | False positive | True negative | False negative |
| --- | ---: | ---: | ---: | ---: |
| Exact path | 1 | 0 | 4 | 3 |
| Path and import | 2 | 1 | 3 | 2 |

The extra detection is a direct relative import. A commented import produces
one false positive; an alias and a cross-artifact relationship are missed. These
are explicit characterization cases, not a held-out benchmark. Source parsing
is regex-based and incomplete; hashed visual coordinates, semantic/PCA proximity,
predictive proximity and 85% conflict reduction are not validated here.

Next experiment: freeze 20 paired isolated tasks and collect declared intent,
actual changed paths and import edges in shadow mode. Have a human label which
pairs needed coordination before inspecting scores. Report precision, recall,
alerts per pair and p50/p95 overhead against exact-path and isolation-only
baselines. After that, randomize warning display and measure conflict/rework
rate with the same task mix. No automatic pause until warning usefulness and
ownership enforcement are separately established.
