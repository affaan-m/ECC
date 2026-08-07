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

Codex's TUI status line only supports built-in widgets, so ECC covers Codex in
two layers:

**1. Native widgets (in the TUI)** — the bar under Codex's input composer.
Codex has no API for custom status-line commands, so ECC configures Codex's
own `status_line` widgets. The installer (and `setup-codex-bar.js`) writes
this into `~/.codex/config.toml` when no `status_line` exists — an existing
one is never overwritten:

```toml
[tui]
status_line = ["model-with-reasoning", "context-remaining", "five-hour-limit", "weekly-limit", "used-tokens", "git-branch"]
status_line_use_colors = true
```

The key must live in the `[tui]` table — a top-level `status_line` is
silently ignored by Codex (verified by capturing the rendered TUI).
`status_line_use_colors` renders the widgets in Codex's warm truecolor
palette, the closest in-TUI match to the ECC bar; fully custom colors and
segments are not possible until Codex exposes a custom status-line API.

**2. ECC-branded bar (in the terminal, while Codex runs)** — the `ecc-codex`
wrapper launches Codex and keeps a live bar visible around the TUI. The ECC
installer makes this the default: it writes a managed alias block to your
`~/.zshrc`/`~/.bashrc` so plain `codex [args...]` runs through the wrapper
(arguments pass through untouched — aliases don't expand inside scripts, so
there is no recursion). It can also be run standalone, no agent involved:

```bash
node <ecc-root>/scripts/codex/setup-codex-bar.js           # install (default)
node <ecc-root>/scripts/codex/setup-codex-bar.js status    # inspect
node <ecc-root>/scripts/codex/setup-codex-bar.js remove    # uninstall
```

Turning it off, from lightest to heaviest:

- `ECC_CODEX_BAR=off` — keep the alias, hide the bar (plain codex passthrough)
- `ECC_CODEX_ALIAS=off` — the rc block defines no alias at all
- `setup-codex-bar.js remove` — delete the managed block entirely

If you already have your own `codex` alias or function (e.g.
`alias codex="codex --yolo"`), the installer reports `kept-existing` and
leaves it alone. To combine, point your alias at the wrapper — your flags pass
through: `alias codex='bash "<ecc-root>/scripts/codex/ecc-codex" --yolo'`.

While Codex owns the screen, the wrapper re-renders the bar from the newest
`~/.codex/sessions/**/rollout-*.jsonl` token_count event every 15 seconds
(`ECC_CODEX_BAR_INTERVAL`) and mirrors it into:

- the **window/tab title** (OSC 2) — visible in any terminal, including
  through tmux (sequences are passthrough-wrapped automatically)
- a **terminal user var** `ecc_codex_bar` (OSC 1337 SetUserVar) — WezTerm and
  iTerm2 can pin this in their native status bar

```text
⬢ codex 7d ██████ 100% ↻1d │ ctx 28% │ 150.4M tok
```

WezTerm users: add this to `~/.wezterm.lua` for an always-visible amber bar in
the tab bar's right status:

```lua
wezterm.on('update-status', function(window, pane)
  local ok, vars = pcall(function() return pane:get_user_vars() end)
  local bar = ok and vars.ecc_codex_bar or nil
  if not bar or #bar == 0 then
    window:set_right_status('')
    return
  end
  local parts = {}
  for seg in string.gmatch(bar, '[^│]+') do
    local color = '#9a9183'                                -- dim taupe
    if seg:find('5h') then color = '#F59E0B'               -- ECC amber
    elseif seg:find('7d') then color = '#E07856'           -- ECC terracotta
    elseif seg:find('⬢') then color = '#E07856' end
    if seg:find('9%d%%') or seg:find('100%%') then color = '#e05656' end
    parts[#parts + 1] = { Foreground = { Color = color } }
    parts[#parts + 1] = { Text = seg }
  end
  parts[#parts + 1] = { Text = '  ' }
  window:set_right_status(wezterm.format(parts))
end)
```

Set `ECC_CODEX_BAR=off` to make the wrapper a plain `codex` passthrough. The
bar is intentionally not drawn into the scroll region — a full-screen TUI
would overwrite it and redraws would corrupt Codex's rendering.

**3. tmux / standalone renderer** — the same renderer works anywhere:

```bash
# tmux status bar (refreshes with status-interval)
set -g status-right '#(node <ecc-root>/scripts/codex/ecc-usage-bar-codex.js --tmux)'

# any terminal — --full renders the Claude-style three-line bar
watch -c -n 30 "node <ecc-root>/scripts/codex/ecc-usage-bar-codex.js --full"
```

**Three lines while Codex runs (tmux)** — no configuration needed. When
`ecc-codex` starts inside tmux it sets a 4-line status bar for that session
(line 0 keeps the normal window list, lines 1-3 are the ECC bar) and restores
the previous status on exit. The options are session-scoped, so other tmux
sessions and `~/.tmux.conf` are never touched:

```text
⚡ 7d ██░░░░ 25% ↻9h50m │ cache 97%
✳ gpt-5.6-sol │ ctx ███░░░░░░░ 26% 258K │ 96.4M tok
⬢ ECC 2.2.0 │ plugins ecc │ myproject
```

**Glyphs**: block bars and symbols need a UTF-8 locale and a font that has
them. When `LANG`/`LC_ALL`/`LC_CTYPE` is not UTF-8 the bar automatically
switches to an ASCII set so it never renders as underscores:

```text
* 7d |||||| 100% ~8h47m | cache 99%
* gpt-5.6-sol | ctx |||_______ 28% 258K | 150.4M tok
# ECC 2.2.0 | plugins ecc | myproject
```

Force either set with `ECC_BAR_GLYPHS=ascii` or `ECC_BAR_GLYPHS=unicode` —
useful when the locale is UTF-8 but the terminal font lacks `⬢`/`✳`.

The bar sets `status-style bg=default,fg=default`, so it inherits the
terminal's own background and foreground instead of tmux's default green
status bar — it blends into any theme, light or dark. Segment colors use
256-color codes supported by Terminal.app, Windows Terminal, WezTerm,
iTerm2, and mainstream Linux terminals.

Outside tmux the bar falls back to the title/user-var mirror described above.

`--full` renders the Claude-style two-line bar (usage bars, then
`⬢ ECC <version> │ plugins … │ dir`); `--plain` strips colors (used for
title updates); `CODEX_HOME` overrides the default `~/.codex` location.

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
(never a second copy), keeps an existing `tui.status_line`, and leaves a
codex alias you wrote yourself untouched. Re-running `ecc install --guided`
is equally safe if you would rather answer the prompts — including the UTF-8
step, which is skipped entirely when your locale is already UTF-8.

## Files

- `scripts/hooks/ecc-statusline.js` — Claude Code statusLine entry point
- `scripts/lib/statusline-render.js` — shared rendering (colors, bars, segments)
- `scripts/codex/ecc-usage-bar-codex.js` — Codex session-file renderer
- `scripts/codex/ecc-codex` — Codex wrapper (live bar in title / terminal status bar)
- `scripts/codex/setup-codex-bar.js` — install/remove the default `codex` alias
- `scripts/lib/codex-shell-alias.js` — managed rc-block editing for the alias
- `examples/statusline.json` — manual registration example
