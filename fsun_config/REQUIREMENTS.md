# myclaude — Requirements

## Core
- Single CLI entry point for managing my Claude Code setup
- Quick cheatsheet so I don't need to memorize commands
- Cherry-pick files from upstream ECC, track what's installed
- Create my own custom rules/skills/commands/agents
- Sync upstream updates without merge conflicts (fork workflow)
- Symlink to ~/.local/bin for global access
- Works on macOS + Ubuntu (zsh)

- Subcommands: `myclaude rules`, `myclaude skills`, `myclaude commands` with `--verbose` flag
- Verbose shows what each rule covers, skill sections & value, command details
- Don't need to memorize — just `myclaude` to see everything
- Default `myclaude` shows status dashboard: counts, hooks wired, sessions
- `myclaude help` shows full command reference (separate from status)
- Session hooks auto-save/load context across projects
- `myclaude install` bootstraps a new machine: prereqs, sync, link, optional --opus
- Multi-language rules support: common + typescript + web + python (add more as needed)
- Cross-platform: macOS (zsh) + Ubuntu/Linux (zsh/bash)

## Custom overlays (`fsun_config/custom/`)
- `commands/sessions.md` — context-rich `/sessions load` (overrides upstream)
- `scripts/lib/session-manager-fsun.js` — extension lib backing the overlay
- `rules/common/behavioral-guidelines.md` — Frank's behavioral rules

## Session aliases (alias-first session management)
See `fsun_config/docs/session-aliases.md` for the full spec. Shipped 2026-07-08 via PR #19.
Verified 2026-07-08 (`fsun_config/docs/verify/session-alias-registry-2026-07-08.md`, 12/12 PASS) — BA sign-off ACCEPTED 2026-07-08. Three accepted gaps recorded in the spec's limitations (no unit tests; real interactive `~/claude_adhoc` exit unexercised — human step documented; LLM paths unexercised). Ships when PR #19 merges.

- Persistent sessions switchable by **alias**; session IDs hidden from the user
- "One alias = one project/topic. Same-alias context should be together, otherwise it's confusing"
- Explicit registry: many sessions → exactly one alias; an alias can span multiple folders; new sessions auto-join their folder's alias
- `/sessions` = alias overview; unassigned folders get **suggested** names — suggest-and-confirm, never silent-create
- `/sessions switch <alias>` loads the whole alias context (all member summaries + transcripts from every attached folder, token-budgeted)
- Organizing verbs: attach, assign, gather --topic, absorb, consolidate (archives, never deletes), rename, unalias, ignore (scratch folders)
- Session-start hint: offer switch / ask which alias / ask to create / silent for ignored folders
- Retention pruning off globally — cleanup is manual and human-confirmed

## Sessions overlay
See `fsun_config/docs/sessions-extended.md` for full design.

- Default `sessions load <id>` is **context-rich**: combines `.tmp` summary with Claude-native JSONL transcripts under `~/.claude/projects/<encoded-cwd>/` up to a token budget
- Token budget accepts shorthand: `500K`, `1M`, raw int. Default 500K (sized for 1M context window)
- `--topic "<kw>"` runs LLM topic filter via `claude -p`; falls back to keyword grep if `claude` unavailable
- `--no-history` returns to upstream-style metadata-only load
- `--since 7d|24h|2w` time-bounded filter
- `sessions merge <id> [--topic <kw>] [--dry-run]` consolidates sibling .tmp files into target
- `sessions help` prints full flag reference

## Current State
- Installed: 81 upstream files (common + TS + web + python rules, agents, commands, skills)
- 5 custom overlays (incl. sessions.md + session-manager-fsun.js)
- Alias-first session management built (PR #19, `feat/session-alias-registry`) — not yet merged to main
- All agents upgraded to opus (Max sub)
- Fork: eliteGoblin/everything-claude-code
- Upstream: affaan-m/everything-claude-code
- Languages: JavaScript/TypeScript, Web/Frontend, Python
