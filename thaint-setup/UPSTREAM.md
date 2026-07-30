# Upstream tracking

Fork of [affaan-m/ECC](https://github.com/affaan-m/ECC) (renamed from
`everything-claude-code`). Upstream notes:
[releases](https://github.com/affaan-m/ECC/releases).

| | |
|---|---|
| Base tag | `v2.1.0` = `4da6deac` (2026-07-27) |
| Upstream `main` last checked | `e4e41631` = `v2.1.0-16` (2026-07-29) — merges clean |
| Tests at base | 3316 / 3316 |
| Tests on this branch | 3321 / 3322 — see `lib/dry-run.test.js` below |

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

`setup_claude.sh` wires `hooks/hooks.json` into `~/.claude/settings.json`
(`install_hook_graph`). Upstream declines to: the installer copies the hook
scripts and writes the same graph to `~/.claude/hooks/hooks.json`, then leaves
`settings.json` untouched by design, because the supported live path is
`/plugin install`, where Claude Code auto-loads the plugin's graph. Verified that
Claude Code reads hooks *only* from `settings.json` — a hook placed in
`~/.claude/hooks/hooks.json` alone never fires — so a `--target claude` install
otherwise ships 50 hook scripts that nothing triggers.

Two consequences to watch on upgrade:

- If ECC is ever installed here as a plugin, the wiring must go, or every hook
  runs twice. `install_hook_graph` already skips itself when `claude plugin list`
  reports `everything-claude-code`.
- If upstream starts writing `settings.json` from the installer, drop
  `install_hook_graph` rather than merging both.

`scripts/hooks/ecc-statusline.js` shows the 5-hour rate-limit window instead of a
dollar figure, marked `// LOCAL (thaint):` at `buildMetricsSegment`. Upstream
renders session cost, which is meaningless on a Claude.ai subscription — nothing
is billed per token, and the limit actually reached is the rolling window Claude
Code already passes on stdin as `rate_limits.five_hour`. Cost is still rendered
when that field is absent, as it is for API-key users. The countdown helper is a
new file, `scripts/lib/rate-limit-format.js`, kept separate because `resets_at`
is epoch seconds while the existing `formatDuration` takes an ISO string, and
because the hook was already near the 200-line budget in `.claude/rules/node.md`.
Expect a conflict here if upstream touches the metrics block; the fallback chain
is the part to preserve.

`buildContextBar` in the same file drops a 16.5-point auto-compact reserve that
upstream subtracts before rescaling. Left **unmarked**, not tagged LOCAL: this is
a fix to carry until upstream makes it, so drop it the moment they do. On a
captured payload reporting `used_percentage` 44 the old formula drew 53, and the
gap widens as context fills. The reserve is real but token-denominated — Claude
Code compacts a 1M window near 967K, so 33K held back is 16.5% of a 200K window
and 3.3% of a 1M one — and `CLAUDE_CODE_AUTO_COMPACT_WINDOW` makes the window
configurable from 100K to 1M, so no fixed percentage works. The constant arrived
in `940135ea` salvaged from a stale PR, uncommented and untested. Worth an
upstream issue; the evidence is a captured statusLine payload plus the env-vars
and model-config docs.

`tests/lib/dry-run.test.js` fails on this branch and does so upstream too:
`scripts/ecc.js --dry-run --json typescript` emits ~1.1 MB, past the 1 MiB
default `maxBuffer` of the test's `spawnSync`, so the child is SIGTERMed and
`status` is `null` with `ENOBUFS`. Not caused by anything here — the two files
this fork adds account for ~189 of the ~50 KB over the limit. Fix is a
`maxBuffer` option on that spawn; left alone so it stays upstream's to make.

Two upstream doc claims are wrong as of `v2.1.0` and worth re-checking after any
merge: `README.md` (Install hooks) says raw-copying `hooks/hooks.json` is
unsupported because the installer rewrites command paths — the two files are
byte-identical, and resolution happens at runtime inside each `node -e` command;
`docs/TROUBLESHOOTING.md` says `settings.json` hook changes need a session
restart — they take effect immediately.

Overlaps our changes in 5 files — `scripts/hooks/cost-tracker.js`,
`scripts/lib/utils.js`, `tests/hooks/cost-tracker.test.js`,
`tests/hooks/hooks.test.js`, `tests/lib/utils.test.js`. Merge is clean today, but
this is where a conflict would land, and `cost-tracker.js` is where #2483 lands —
expect that one to need hand-resolution. The session-id logic in `utils.js` is
untouched, so that fix is still needed.
