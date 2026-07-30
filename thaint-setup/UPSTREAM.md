# Upstream tracking

Fork of [affaan-m/ECC](https://github.com/affaan-m/ECC) (renamed from
`everything-claude-code`). Upstream notes:
[releases](https://github.com/affaan-m/ECC/releases).

| | |
|---|---|
| Base tag | `v2.1.0` = `4da6deac` (2026-07-27) |
| Upstream `main` last checked | `e4e41631` = `v2.1.0-16` (2026-07-29) — merges clean |
| Tests at base | 3316 / 3316 |
| Tests on this branch | 3321 / 3321 |

On upgrade: replace the section below with the delta against the new base.

## Upstream changes since v2.1.0

`v2.1.0..e4e41631` — 16 commits, 33 files, +4632 / −1457. No newer tag yet.

Fixes:

- `fix(hooks): dedupe transcript usage by message.id in cost-tracker` (#2483) —
  cost was inflated **~2.5–3x**
- `fix(hooks,lib): fix hook detection and parsing edge cases` (#2405)
- `fix: harden local dashboard and data boundaries` (#2585)
- `fix(opencode): don't crash the session when plugins/lib is missing` (#2538)
- `fix: clean promoted instinct sources` (#2587)

Docs/CI: README restructured for 2.1 (#2579), badges for non-existent
`api.ecc.tools` endpoints dropped, TDD section retitled, main CI restored
(#2623).

Deps: cargo minor/patch group (#2593), pyyaml ≥6.0.3 (#2455), pytest-mock
≥3.15.1 (#2454).

Overlaps our changes in 5 files — `scripts/hooks/cost-tracker.js`,
`scripts/lib/utils.js`, `tests/hooks/cost-tracker.test.js`,
`tests/hooks/hooks.test.js`, `tests/lib/utils.test.js`. Merge is clean today, but
this is where a conflict would land, and `cost-tracker.js` is where #2483 lands —
expect that one to need hand-resolution. The session-id logic in `utils.js` is
untouched, so that fix is still needed.
