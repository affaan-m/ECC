# ECC Usage Bar (statusline)

The ECC usage bar is a multi-line statusline installed by default with ECC. It
answers three questions at a glance: **how much usage do I have left**, **what
is this session doing**, and **what ECC configuration is active**.

> **Credit**: This feature is inspired by
> [leeguooooo/claude-code-usage-bar](https://github.com/leeguooooo/claude-code-usage-bar)
> (MIT), which pioneered the always-on rate-limit bar for Claude Code, with the
> prompt-cache widget originally contributed by
> [@marcwimmer](https://github.com/marcwimmer). ECC re-implements the idea in
> dependency-free Node with ECC branding and ECC-specific segments (hooks
> profile, plugin versions). Openness is an ECC principle — go star the
> original.

## Claude Code

```text
⚡ 5h ███████░ 84% ↻1h54m │ 7d █░░░░░░░ 14% ↻4d │ cache 100%
✳ Opus 5 xhigh │ ctx █░░░░░░░░░ 13% 1M │ $7.85 +49/-49 36m │ Fixing auth bug
⬢ ECC 2.2.0 │ hooks standard │ plugins ecc 2.2.0 · swift-lsp 1.0.0 │ myproject
```

| Line | Segment | Source | Meaning |
|------|---------|--------|---------|
| 1 | `5h … ↻1h54m` | `rate_limits.five_hour` (official, stdin) | Session-window usage + reset countdown |
| 1 | `7d … ↻4d` | `rate_limits.seven_day` | Weekly-window usage + reset countdown |
| 1 | `cache 100%` | `context_window.current_usage` | Prompt-cache hit rate for the last request |
| 2 | `Opus 5 xhigh` | `model`, `effort`, `fast_mode` | Model + effort/fast badges (badge hidden at default effort) |
| 2 | `ctx █… 13% 1M` | `context_window` | Context used (auto-compact-adjusted) + window size |
| 2 | `$7.85 +49/-49 36m` | `cost` + session bridge | Session cost, lines added/removed, duration |
| 2 | `Fixing auth bug` | `~/.claude/todos/` | Current in-progress task |
| 3 | `ECC 2.2.0` | installed plugin / `VERSION` | Active ECC version |
| 3 | `hooks standard` | `hook-flags.js` | Hooks on/off + profile; `(N off)` counts `ECC_DISABLED_HOOKS` |
| 3 | `plugins …` | `installed_plugins.json` | Enabled plugins with versions (ecc first, capped at 4) |
| 3 | `myproject` | `workspace.current_dir` | Working directory |

Colors are ECC brand: amber (`#F59E0B` → 256-color 214) for the 5h window,
terracotta (`#E07856` → 173) for the 7d window, with a warm severity ramp —
yellow at 60% used, orange at 80%, red at 90%. Line 1 disappears entirely on
API-key billing (no rate limits are emitted).

### Install / config

The installer wires this automatically: it writes a launcher to
`~/.claude/ecc-statusline.js` (which resolves the active plugin version) and
sets `statusLine` in `~/.claude/settings.json` **only if you don't already
have one** — an existing statusline (e.g. `cs`) is never overwritten. To adopt
the ECC bar over an existing one, delete your `statusLine` entry and rerun the
installer, or point it at the launcher yourself:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"/Users/you/.claude/ecc-statusline.js\""
  }
}
```

- `ECC_STATUSLINE_COMPACT=1` — legacy single-line format
  (`model │ task │ dir` + context bar).
- Rate-limit data requires a subscription session (Pro/Max); Claude Code emits
  it on the statusline stdin.

## Codex CLI

Codex offers no custom status-line API, so ECC gives the bar three rows of its
own that Codex cannot scroll over. Which mechanism does that depends on the
terminal, and none of them need tmux:

| Terminal | Where the bar goes |
| --- | --- |
| tmux | three lines of the session's status area |
| WezTerm | a three-row pane across the bottom of the window |
| Terminal.app and other VT100 terminals | the bottom three rows, reserved with DECSTBM margins |

```text
⚡ 7d ██░░░░ 25% ↻9h50m │ cache 97%
✳ gpt-5.6-sol │ ctx ███░░░░░░░ 26% 258K │ 96.4M tok
⬢ ECC 2.2.0 │ plugins ecc │ myproject
```

All three appear when Codex starts and are given back when it exits.

ECC does not touch Codex's own `[tui] status_line` widgets. Those render their
own line under the composer covering the same model, context and rate-limit
ground, so configuring both stacks two status lines on top of each other. If
you want the native widgets instead of the ECC bar, set them yourself in
`~/.codex/config.toml` and run the wrapper with `ECC_CODEX_BAR=off`. Note that
the key must live inside the `[tui]` table: a top-level `status_line` is
silently ignored by Codex.

### The wrapper

`ecc-codex` launches Codex with the bar around it. The ECC installer makes this
the default by writing a managed alias block to your `~/.zshrc`/`~/.bashrc`, so
plain `codex [args...]` runs through the wrapper. Arguments pass through
untouched, and aliases do not expand inside scripts, so there is no recursion.

```bash
node <ecc-root>/scripts/codex/setup-codex-bar.js           # install (default)
node <ecc-root>/scripts/codex/setup-codex-bar.js status    # inspect
node <ecc-root>/scripts/codex/setup-codex-bar.js remove    # uninstall
```

If you already have your own `codex` alias or function (e.g.
`alias codex="codex --yolo"`), the installer reports `kept-existing` and leaves
it alone. To combine, point your alias at the wrapper and your flags still pass
through: `alias codex='bash "<ecc-root>/scripts/codex/ecc-codex" --yolo'`.

| Variable | Effect |
| --- | --- |
| `ECC_CODEX_BAR=off` | Keep the alias, run plain `codex` with no bar |
| `ECC_CODEX_ALIAS=off` | The rc block defines no alias at all |
| `ECC_CODEX_BAR_INTERVAL=15` | Refresh seconds |
| `ECC_CODEX_PANE=off` | No WezTerm pane; use reserved rows instead |
| `ECC_CODEX_REGION=off` | No reserved rows |
| `ECC_BAR_GLYPHS=ascii\|unicode` | Force the glyph set |

`setup-codex-bar.js remove` deletes the managed block entirely.

### How each surface works

**tmux** needs no configuration. `ecc-codex` sets a 4-line status bar for the
session (line 0 keeps the normal window list, lines 1-3 are the bar) and
restores the previous status on exit. The options are session-scoped, so other
sessions and `~/.tmux.conf` are never touched. It also sets
`status-style bg=default,fg=default`, so the bar inherits the terminal's own
colors instead of tmux's green.

**WezTerm** gets a pane, because WezTerm's only status area is the tab bar: one
line, shared with the tab strip, which can neither hold three lines nor be
detached from the tabs. The pane is created with `--top-level`, so it spans the
whole window rather than subdividing whichever pane Codex is in, and focus
returns to Codex immediately. It pins itself back to three rows if a window
resize stretches it, and watches the wrapper's process so a Codex run killed
without unwinding its traps cannot strand a pane in your window.

**Plain terminals** get the bottom three rows reserved with DECSTBM scroll
margins set to rows 1 to H-3, which stops Codex scrolling over them. This is
possible only because Codex draws inline rather than on the alternate screen.
The margins are re-asserted on every repaint, so a window resize needs no
`SIGWINCH` handling, and the sequence is wrapped in DECSC/DECRC so Codex never
sees its cursor move. Windows shorter than nine rows are left alone rather than
losing a third of the screen.

**Glyphs**: block bars and symbols need a UTF-8 locale and a font that has
them. When `LANG`/`LC_ALL`/`LC_CTYPE` is not UTF-8 the bar switches to an ASCII
set so it never renders as underscores:

```text
* 7d |||||| 100% ~8h47m | cache 99%
* gpt-5.6-sol | ctx |||_______ 28% 258K | 150.4M tok
# ECC 2.2.0 | plugins ecc | myproject
```

`--full` renders the three lines for any consumer; `CODEX_HOME` overrides the
default `~/.codex` location.

## Upgrading an existing ECC install

Nothing here requires redoing the full guided install.

**Claude Code** — update the plugin as usual. If your `statusLine` already
points at ECC's `scripts/hooks/ecc-statusline.js`, the three-line bar arrives
with the update, no action needed. If you have no `statusLine` yet, run any
`ecc install` (or copy the snippet from `examples/statusline.json`) to have
one written; an existing statusLine of your own is never replaced.

**Codex** — one command, no wizard:

```bash
node <ecc-root>/scripts/codex/setup-codex-bar.js          # alias + TUI status line
node <ecc-root>/scripts/codex/setup-codex-bar.js status   # check what is configured
```

Setup questions introduced by a new ECC version (currently the UTF-8 one) are
also asked by `ecc auto-update`, so people who update rather than reinstall
still see them. Answers are recorded in `<config>/ecc/setup-answers.json` and
each question is asked once; see `scripts/lib/setup-prompts.js` to add another.

Both paths are idempotent: rerunning refreshes the managed rc block in place
(never a second copy) and leaves a codex alias you wrote yourself untouched.
Codex's own `tui.status_line` is never written or removed either way. Re-running `ecc install --guided`
is equally safe if you would rather answer the prompts — including the UTF-8
step, which is skipped entirely when your locale is already UTF-8.

## Files

- `scripts/hooks/ecc-statusline.js` — Claude Code statusLine entry point
- `scripts/lib/statusline-render.js` — shared rendering (colors, bars, segments)
- `scripts/codex/ecc-usage-bar-codex.js` — Codex session-file renderer
- `scripts/codex/ecc-codex` — Codex wrapper (reserves the bar's rows)
- `scripts/codex/ecc-codex-bar-pane` — draws the bar in WezTerm's bottom pane
- `scripts/codex/setup-codex-bar.js` — install/remove the default `codex` alias
- `scripts/lib/codex-shell-alias.js` — managed rc-block editing for the alias
- `examples/statusline.json` — manual registration example
