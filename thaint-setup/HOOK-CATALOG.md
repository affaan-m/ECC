# ECC Hook Catalog

Fork-local reference. ECC has no per-hook catalog upstream: `hooks/README.md`
documents the hook *mechanism* (schema, async, runtime controls) but names none
of the shipped hooks, and `hooks/memory-persistence/hooks.json` carries `purpose`
fields for only 6 lifecycle hooks.

The live set is not readable from any single file. It is `hooks/hooks.json` plus
three levels of nesting: `pre-bash-dispatcher` → `bash-hook-dispatcher`, and
`posttooluse-dispatcher` → `post-bash-dispatcher`. Purposes below come from each
script's header docblock; hooks with no docblock are marked `inferred`.

**37 hook IDs / 32 scripts.** Five scripts register twice: `governance-capture`
(pre+post), `mcp-health-check` (pre+failure), `gateguard-fact-force` (bash+edit),
`observe-runner` (pre+post), `post-bash-command-log` (audit+cost).

## PreToolUse · Bash

One `hooks.json` entry (`pre-bash-dispatcher`) runs all six in-process.

| ID | Script | Purpose |
| --- | --- | --- |
| `pre:bash:block-no-verify` | block-no-verify | Blocks `--no-verify` and `-c core.hooksPath=` so agents cannot skip pre-commit, commit-msg, or pre-push hooks |
| `pre:bash:auto-tmux-dev` | auto-tmux-dev | Runs dev servers in a named tmux session (new cmd window on Windows) instead of blocking the tool call |
| `pre:bash:tmux-reminder` | pre-bash-tmux-reminder | Reminds to run long-lived commands under tmux — `inferred`, no docblock |
| `pre:bash:git-push-reminder` | pre-bash-git-push-reminder | Warns before `git push` — `inferred`, no docblock |
| `pre:bash:commit-quality` | pre-bash-commit-quality | Detects staged files and runs the linter on them before a commit command |
| `pre:bash:gateguard-fact-force` | gateguard-fact-force | Denies the first Bash call and demands facts (request restated, what the command produces) before allowing the retry |

## PreToolUse · separate entries

Each is its own `hooks.json` entry, so each spawns its own node process.

| ID | Matcher | Timeout | Purpose |
| --- | --- | --- | --- |
| `pre:write:doc-file-warning` | Write | — | Denylist warning on ad-hoc doc filenames (NOTES, TODO, SCRATCH) outside structured directories |
| `pre:edit-write:suggest-compact` | Edit\|Write | — | Suggests manual compaction at logical intervals rather than letting auto-compact fire mid-task |
| `pre:observe` (async) | * | 10s | Records tool intent for continuous-learning signals — `inferred`, no docblock; purpose text from `hooks/memory-persistence/hooks.json` |
| `pre:governance-capture` | Bash\|Write\|Edit\|MultiEdit | 10s | Writes governance-relevant events to the `governance_events` table in the state store |
| `pre:config-protection` | Write\|Edit\|MultiEdit | 5s | Blocks edits to linter/formatter config files, so agents fix the source instead of loosening the check |
| `pre:mcp-health-check` | * | — | Probes MCP server health before an MCP tool call |
| `pre:edit-write:gateguard-fact-force` | Edit\|Write\|MultiEdit | 5s | Denies the first edit per file and demands importers, affected API, and data schema before allowing the retry |

## PostToolUse

Two `hooks.json` entries for `posttooluse-dispatcher` (sync 30s, async 45s) run
all nine in-process, plus `post:bash:dispatcher` for the Bash group below.

| ID | Script | Purpose |
| --- | --- | --- |
| `post:edit:design-quality-check` | design-quality-check | Self-contained frontend design-drift reminder; no remote models, no installs |
| `post:edit:accumulator` | post-edit-accumulator | Appends each edited JS/TS path to a session-scoped temp file for `stop:format-typecheck` to batch |
| `post:edit:console-warn` | post-edit-console-warn | Warns with line numbers when an edited JS/TS file still contains `console.log` |
| `post:governance-capture` | governance-capture | Post-call half of the governance event capture |
| `post:session-activity-tracker` | session-activity-tracker | Records sanitized per-tool activity to `~/.claude/metrics/tool-usage.jsonl` |
| `post:ecc-metrics-bridge` | ecc-metrics-bridge | Maintains a session aggregate at `/tmp/ecc-metrics-{session}.json` so consumers avoid scanning large JSONL logs |
| `post:ecc-context-monitor` | ecc-context-monitor | Reads the bridge file and injects warnings on context exhaustion, high cost, scope creep, or tool loops |
| `post:quality-gate` | quality-gate | Lightweight per-file quality checks after edits; no-ops when tooling is unavailable |
| `post:observe:continuous-learning` | observe-runner | Records tool results for continuous-learning signals — `inferred`, no docblock |

## PostToolUse · Bash

Reached via `post:bash:dispatcher` → `post-bash-dispatcher`.

| ID | Script | Purpose |
| --- | --- | --- |
| `post:bash:command-log-audit` | post-bash-command-log | Audit trail of executed bash commands — `inferred`, no docblock |
| `post:bash:command-log-cost` | post-bash-command-log | Cost accounting off the same command log — `inferred`, no docblock |
| `post:bash:pr-created` | post-bash-pr-created | Detects a PR created by a bash command — `inferred`, no docblock |
| `post:bash:build-complete` | post-bash-build-complete | Detects build completion from bash output — `inferred`, no docblock |

## Other events

| ID | Event | Script | Purpose |
| --- | --- | --- | --- |
| `post:mcp-health-check` | PostToolUseFailure | mcp-health-check | Marks unhealthy servers, attempts reconnect, re-probes |
| `pre:compact` | PreCompact | pre-compact | Generates an LLM summary of the session and writes it to the active session file before compaction |
| — | SessionStart | session-start | Loads the most recent session summary into context via stdout (invoked through `session-start-bootstrap`) |
| `session-start:plan-canvas-sessions` | SessionStart | plan-canvas-sessions | Surfaces a Plan Canvas review left open by a previous session |
| `stop:format-typecheck` | Stop | stop-format-typecheck | Reads the accumulator and formats plus typechecks every file edited this response in one pass. **Timeout 300s** — the longest blocking hook in the graph |
| `stop:check-console-log` | Stop | check-console-log | Warns if modified JS/TS files contain `console.log` — overlaps `post:edit:console-warn` |
| `stop:session-end` (async) | Stop | session-end | Extracts a summary from the transcript and persists learnings during an active session |
| `stop:evaluate-session` (async) | Stop | evaluate-session | Extracts reusable patterns from the transcript for continuous learning |
| `stop:cost-tracker` (async) | Stop | cost-tracker | Writes session cost to the metrics log — `inferred`, no docblock |
| `stop:desktop-notify` (async) | Stop | desktop-notify | Native desktop notification with the task summary on finish |
| `session:end:marker` (async) | SessionEnd | session-end-marker | Observer cleanup; passes stdin through unchanged |

## Infrastructure — 8 scripts, no behavior of their own

`plugin-hook-bootstrap` · `run-with-flags` · `pre-bash-dispatcher` ·
`bash-hook-dispatcher` · `posttooluse-dispatcher` · `post-bash-dispatcher` ·
`session-start-bootstrap` · `pretooluse-visible-output`

## Shipped but not running as hooks — 8 scripts

| Script | Reason |
| --- | --- |
| `cursor-session-env` | Installed only for the Cursor host, via `scaffolds/cursor/hooks.json` |
| `insaits-security-wrapper` | Opt-in; ECC ships it unregistered |
| `pre-write-doc-warn` | Back-compat shim for `doc-file-warning`, kept for direct consumers |
| `ecc-statusline` | Registered as `statusLine`, not a hook |
| `post-edit-format` | Superseded by `quality-gate` and `stop:format-typecheck` |
| `post-edit-typecheck` | Superseded by `stop:format-typecheck` |
| `pre-bash-dev-server-block` | Superseded by `auto-tmux-dev` |
| `check-hook-enabled` | Utility, not registered |

32 running + 8 infrastructure + 8 unregistered = 48 files in `scripts/hooks/`.

## Known staleness

`quality-gate.js` skips JS/TS files on the stated assumption that
`post-edit-format` handles them — see its comments at lines 10, 53, and 74. That
script is not registered anywhere, so JS/TS formatting happens only later, at
`stop:format-typecheck`. The comments are stale, not the behavior.

Every unregistered script above still has a passing test, which is why none of
this surfaced: the tests prove the module works, not that it is wired.

## Turning hooks off

`hooks/README.md` is the reference for `ECC_HOOK_PROFILE`,
`ECC_DISABLED_HOOKS`, and `ECC_GATEGUARD`. Two notes not stated there:

- Every entry in `hooks/hooks.json` is tagged `standard,strict`, so profile
  `minimal` runs none of them — including GateGuard.
- `GATEGUARD_BASH_ROUTINE_DISABLED=1` drops only the once-per-session routine
  Bash gate and keeps the destructive-command gate.

## Regenerating

Derived from `hooks/hooks.json`, the dispatcher arrays in
`scripts/hooks/*-dispatcher.js`, and header docblocks. Re-check after any
upstream merge that touches `hooks/` or `scripts/hooks/`.
