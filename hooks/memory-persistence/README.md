# Memory Persistence Hooks

These lifecycle hook definitions document ECC's memory persistence contract for Claude Code plugin and manual installs.

The executable implementations live in `scripts/hooks/`:

- `session-start.js` loads bounded prior context, detects project state, and prepares session metadata.
- `pre-compact.js` captures state before context compaction.
- `session-end.js` persists session-end summaries when transcript metadata is available.
- `observe-runner.js` records tool-use observations for continuous learning.
- `session-activity-tracker.js` records tool usage and file activity for ECC2 status and observability.

The installed hook graph is still `hooks/hooks.json`. This directory is the stable, human-readable lifecycle definition surface referenced by the harness audit and longform docs.

## Lifecycle Contract

| Event | Hook | Purpose | Blocking |
|---|---|---|---|
| `SessionStart` | `session:start` | Load bounded prior context and project metadata | no |
| `PreCompact` | `pre:compact` | Save state before compaction | no |
| `PreToolUse` | `pre:observe:continuous-learning` | Capture tool intent for learning signals | no |
| `PostToolUse` | `post:observe:continuous-learning` | Capture tool result for learning signals | no |
| `PostToolUse` | `post:session-activity-tracker` | Record tool and file activity for ECC2 metrics | no |
| `Stop` | `stop:format-typecheck` | Batch quality gate after edits | yes on hook failure |
| `Stop` | `stop:check-console-log` | Audit modified files for debug logging | warn/error by hook output |

## Operator Expectations

- Keep persistence local by default.
- Avoid sending transcripts or tool traces to hosted services unless a user explicitly enables an integration.
- Bound context loaded at session start with `ECC_SESSION_START_MAX_CHARS`.
- Allow opt-out with `ECC_SESSION_START_CONTEXT=off`.
- Keep lifecycle hooks profile-gated through `ECC_HOOK_PROFILE` and `ECC_DISABLED_HOOKS`.

## Related Files

- `hooks/hooks.json`
- `hooks/README.md`
- `scripts/hooks/session-start.js`
- `scripts/hooks/pre-compact.js`
- `scripts/hooks/session-end.js`
- `scripts/hooks/observe-runner.js`
- `scripts/hooks/session-activity-tracker.js`
- `docs/architecture/observability-readiness.md`
