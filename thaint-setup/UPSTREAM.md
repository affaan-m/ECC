# Upstream tracking

Fork of [affaan-m/ECC](https://github.com/affaan-m/ECC) (renamed from
`everything-claude-code`). Upstream notes:
[releases](https://github.com/affaan-m/ECC/releases).

| | |
|---|---|
| Base tag | `v2.1.0` = `4da6deac` (2026-07-27) |
| Upstream `main` last checked | `e4e41631` = `v2.1.0-16` (2026-07-29) — merges clean |
| Tests at base | 3316 / 3316 |
| Tests on this branch | 3321 / 3322 — see `dry-run.test.js` below |

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

## Where this fork deliberately diverges

- **`setup_claude.sh` wires the hook graph into `settings.json`**
  (`install_hook_graph`). Claude Code reads hooks only from `settings.json` —
  verified; upstream's installer writes them to `~/.claude/hooks/hooks.json` and
  stops, because its supported path is `/plugin install`. Without this a
  `--target claude` install ships 50 hook scripts nothing triggers. On upgrade,
  drop it if ECC is installed here as a plugin (every hook would run twice —
  the function already self-skips), or if upstream starts writing
  `settings.json` itself.
- **`ecc-statusline.js` shows the 5-hour rate-limit window, not dollar cost** —
  marked `// LOCAL (thaint):` at `buildMetricsSegment`; cost means nothing on a
  Claude.ai subscription. Falls back to cost when `rate_limits` is absent, as it
  is for API keys; the countdown lives in the new
  `scripts/lib/rate-limit-format.js`. Preserve the fallback chain.
- **`buildContextBar` drops upstream's 16.5-point auto-compact reserve** — left
  **unmarked**: a fix to carry until upstream makes it, so drop it the moment
  they do. The reserve is 33K tokens, so no fixed percentage holds across the
  100K–1M window range; on a captured payload reporting 44 the old formula drew
  53. The constant arrived in `940135ea` from a stale PR, uncommented and
  untested. Worth an upstream issue.
- **`tests/lib/dry-run.test.js` fails here and upstream too** — `ecc.js
  --dry-run --json typescript` emits ~1.1 MB, past the test's 1 MiB `maxBuffer`,
  so the child is SIGTERMed. Not this fork's doing; the fix is a `maxBuffer`
  option, left as upstream's to make.
- **Two upstream doc claims are wrong as of `v2.1.0`** — `README.md` says
  raw-copying `hooks/hooks.json` is unsupported (the two files are
  byte-identical); `docs/TROUBLESHOOTING.md` says `settings.json` hook changes
  need a session restart (they take effect immediately). Re-check after a merge.

Overlaps our changes in 5 files — `scripts/hooks/cost-tracker.js`,
`scripts/lib/utils.js`, `tests/hooks/cost-tracker.test.js`,
`tests/hooks/hooks.test.js`, `tests/lib/utils.test.js`. Merge is clean today, but
this is where a conflict would land, and `cost-tracker.js` is where #2483 lands —
expect that one to need hand-resolution. The session-id logic in `utils.js` is
untouched, so that fix is still needed.
