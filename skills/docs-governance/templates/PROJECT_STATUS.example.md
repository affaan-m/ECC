# PROJECT_STATUS.md — Current Health Dashboard

> This file is the single source of truth for current project health. Anything in the deletion zone is intentionally retired and must not be referenced or recreated by people or agents.
> Read the red-line block at every session start. Read the metrics only when health context is needed.

## Red-Line Block

Keep this short. Include only facts that cause silent damage if missed: intentionally deleted files that may be recreated, unresolved P0 items, and active violations.

### Deletion Zone

| Path | Reason removed | Date | Replacement |
|---|---|---|---|
| `src/legacy_parser.py` | v1 parser replaced by the services implementation | 2026-06-10 | `src/services/parser.py` |
| `scripts/old_sync.sh` | Synchronization moved into Python | 2026-06-12 | `src/services/sync.py` |

### Unresolved Violations / P0 Actions

- P0: `services/report.py` is 880 lines and exceeds the project limit; decomposition is tracked in LOG event 2026-06-15.
- Coverage is 63%, below the 80% target; the new `cache` module has no tests.

### Audit Freshness

Last audit: 2026-06-15 | commits since audit: 12 | threshold: more than 30 commits or 30 days without audit → RED; run `/governance-audit`.

## Metrics

> Update only when health changes, such as a threshold crossing or a violation opening/closing. Per-action narrative belongs in `PROJECT_LOG.md`.

| Metric | Current | Threshold | Status |
|---|---|---|---|
| Entry-point `main.py` lines | 412 | <600 green / 600–800 yellow / >800 red | Green |
| Test coverage | 63% | >80% green / 60–80% yellow / <60% red | Yellow |
| Largest source file | 880 (`services/report.py`) | <800 | Red |
