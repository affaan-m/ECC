# Read-only coordination inventory

One local JSON report joins declared task IDs and parent IDs, heartbeat age,
optional process metadata, OS RAM, declared resource leases and path/import
warnings. It reuses ECC's orchestration status parser and agent-proximity
scoring. It does not start a server or send messages.

From the repository root, with Node 18 or newer and no dependency install:

```sh
node scripts/coordination-inventory.js --manifest examples/coordination-inventory/manifest.json --now 2026-09-08T06:30:00.000Z
node scripts/coordination-inventory.js --manifest examples/coordination-inventory/goals.json --now 2026-09-08T06:30:00.000Z
node scripts/coordination-inventory.js --coordination /path/to/coordination --live
node examples/coordination-inventory/evaluate.js
node --test tests/scripts/coordination-inventory.test.js
node --test tests/scripts/coordination-goals.test.js
node examples/coordination-inventory/benchmark.js
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

## Declared goals and sessions

Optional `goals` and `sessions` collections add observations to the v1 manifest.
Each accepts at most 64 records, within the same 1 MiB total input budget. IDs
are unique within each collection. A goal accepts `id`, optional `taskId`,
`kind` (`native` or `unknown`), `status` (`active`, `complete`, `blocked` or
`unknown`), and optional UTC `updatedAt`. A session accepts `id`, optional
`taskId`/`goalId`, `status` (`open`, `closed` or `unknown`) and optional UTC
`updatedAt`. Omitted kind/status defaults to `unknown`; invalid supplied enum
values and scalar collection types are rejected. Supplied non-null links must
reference a supplied task or goal. These are associations, not exclusive owners;
multiple sessions may reference one goal without counting that goal twice.

`goals.json` is synthetic: three open sessions reference one active goal, one
completed goal and one missing goal declaration. At its fixed example time the
report has one `freshActiveNativeGoalDeclarations` and one
`openSessionsWithoutGoalDeclaration`. An open session linked to a completed goal
stays open while the goal stays complete. Neither status overwrites the other.

Every goal/session record has `authority: "declared-only"`. Even `kind: "native"`
is the caller's claim, not a native goal-tool verification. Supply a nonsensitive
observation derived from an authorized tool receipt; do not paste raw tool blobs,
objective text, transcripts or credentials. Unrecognized fields are omitted from
reports. The inventory never reads private thread stores or automatically imports
GOAL-STATE files. The caller retains the receipt and its provenance separately.

`coverage.goals` and `coverage.sessions` distinguish `missing` collections from
`declared-only` collections, including explicitly empty arrays. Neither proves
global absence. `activity` contains declaration counts by status, native-kind
declaration counts, open sessions without goal links and the number of fresh
active native-kind declarations. These count records, not task associations or
verified running processes. No goal is inferred from a terminal, task `status`,
heartbeat, PID, resource lease or status-file modification time.

Freshness uses the existing five-minute observation threshold: exactly five
minutes old is fresh, older is stale, future observations are `clock-skew`, and
missing timestamps are unknown. It does not rewrite declared state, and even a
fresh active declaration does not prove current execution. Goal/session state
never suppresses overlap warnings or expands process probing. Ownership remains
in declared paths and resource leases; no pause, message, steer or permission
grant is triggered by any count or warning.

Existing task, warning, resource and lease outputs are unchanged. The new arrays,
activity summary and coverage keys are additive v1 output; consumers that reject
unknown fields need updating. Older consumers will ignore these declarations.
This remains a source-checkout example; these commands/examples are not claimed
to be shipped in the npm package.

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

The dependency-free `benchmark.js` characterizes the legacy fixture, declared
fixture and 64-goal/64-session limit with five warmup batches and 31 measured
batches of ten inventory builds each. It reports median/p95 batch-average
milliseconds, sample counts, fixed input hashes and the same eight overlap
controls. It excludes process startup and CLI I/O; the declaration-limit workload
is not a worst-case graph benchmark. Compare identical input hashes, Node runtime
and parameters before/after on the same machine. Historical one-shot elapsed
time is not a comparable speedup baseline. No performance improvement or conflict
reduction is asserted from merely adding these observations.
