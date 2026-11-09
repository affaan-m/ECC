# Copilot end-of-response quality checks

The quality hook records only explicitly successful `Edit`/`Write` outcomes and
checks their file paths at `agentStop`. A post-tool callback without a recognized
success result is **unknown**, so it does not establish that a file changed.
This interpretation is fixture-tested; native Copilot result delivery still
requires verification for each supported CLI version and OS.

The default `ECC_COPILOT_QUALITY_MODE=check` checks configured formatting without
rewriting files. Set `ECC_COPILOT_QUALITY_MODE=fix` explicitly to permit the local
formatter to rewrite the observed files. `off`, the minimal hook profile, global
hook disable, or the specific disabled hook IDs prevent collection/checking.
The hook IDs are `post:edit:copilot-quality` and `stop:copilot-quality`.

The hook uses the canonical formatter discovery and detection algorithms, and
the canonical design-quality heuristic. Prettier/Biome and TypeScript must be
installed in the relevant project's `node_modules`. It invokes fixed local
package entrypoints with Node and argument arrays, without a shell or automatic
package downloads. A missing configuration or executable reports `unavailable`;
it never counts as passing. Nonzero exits, subprocess errors, and timeouts are
distinct results. Project formatter configuration and plugins remain project
code: enabling this hook authorizes executing that installed toolchain.

Each changed TS project gets one `tsc --noEmit` invocation. Typechecking may
read other project files because TypeScript checks a project as a whole; this
is a check, not permission to format those files. `--incremental false`
prevents creating a build-information cache. Project-reference/composite
configurations that reject this combination report a failed check and need a
separately supported strategy rather than silently disabling checks.

Console findings use the canonical stop-hook substring heuristic and exclusions;
design results require human review and do not imply a design audit passed.
Reports expose counts/statuses, without copying source lines or subprocess logs
into the agent context. The adapter should avoid registering both the old
per-edit console reminder and this final console report.

State lives separately from checkpoints under the resolved Copilot config root:
`ecc/quality/<workspace SHA256>/<session SHA256>/state.json`. Real workspace paths
and existing session-ID rules determine the identity; checkpoint hashes do not
change. State schema is `ecc.copilot.quality.v1`; unknown versions are rejected
without migration or overwrite. Each session holds at most 1024 paths and 256 KiB
of state; each source read is capped at 1 MiB. Paths outside the workspace,
symlink targets, and multiply linked files are refused. State writes use an
exclusive lock, private temporary file, fsync, and atomic rename.

One stop execution snapshots pending file revisions. Repeated stop calls with no
new edit do nothing. Concurrent stop calls return busy. Edits recorded while
checks execute remain pending for the next stop. Deleted files are reported and
skipped. A completed failing check consumes its snapshot so it does not trap the
agent in an infinite stop loop; another observed edit schedules a new check.
Native call IDs, when present, deduplicate repeated successful post-tool
deliveries across stops. The store retains the latest 512 hashed IDs; it does
not deduplicate by command content or file content, so separate identical edit
calls still schedule checks. Without an ID, duplicate deliveries cannot be
distinguished reliably and remain separate observations.
Contended write locks report an unknown result rather than claiming success.
New `state.lock` and `run.lock` directories contain a private PID/ownership token.
A later invocation recovers a lock only when its validated owner process is
confirmed absent (`ESRCH`); it never signals or terminates that process. A live
or reused PID, permission error, legacy lock without owner metadata, incomplete
lock, or interrupted recovery stays conservative and needs operator inspection.
After verifying that no process is running, an operator may remove the stale
lock directory (and a matching `.recovery` directory if recovery was interrupted).

`ECC_COPILOT_QUALITY_BUDGET_MS` sets an integer subprocess budget from 1 to 10000
milliseconds (default 10000). This is a bounded runtime limit, not a certified
latency threshold. Native latency and false-positive gates remain pending the
platform baseline. Tool output is capped at 64 KiB. Quality failures provide
feedback without requesting another stop or preventing the main task. Native
agentStop does not consume additionalContext, so the executable also emits a
bounded summary on stderr with warning exit code 2 when attention is needed.
It never returns decision:block or forces another agent turn.

Fixture verification:

```bash
node tests/hooks/copilot-quality.test.js
```

Tests cover check/fix arguments, unavailable toolchains, actual subprocess
failure, injected timeout, repeated stop, edits during checking, workspace and
session isolation, deleted files, linked files, unsafe state redirection, disabled
mode/profile, the hook subprocess, and restart after a terminated checker while
preserving live/legacy locks. Linux fixture results do not certify
native Copilot Windows/macOS behavior or the behavior of installed formatter
plugins. Roll back by disabling these two hook IDs or setting mode to `off`;
preserve private state for inspection. No new background worker is created.
