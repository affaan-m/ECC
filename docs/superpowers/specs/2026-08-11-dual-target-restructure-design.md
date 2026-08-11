# Dual-Target Restructure: Claude Code + Codex CLI

- **Date**: 2026-08-11
- **Status**: Approved (design), pending implementation
- **Branch**: `refactor/dual-target-restructure`

## Problem

The repo currently installs everything into `~/.claude` and, as an afterthought,
copies a single file (`global/CLAUDE.md` → `~/.codex/AGENTS.md`) when Codex is
detected. The user actively works with both Claude Code and Codex CLI and wants
both tools to be first-class installation targets sharing a single source of
truth, following the "port operating contracts, not copy the file tree"
principle (blakecrosley.com/blog/claude-code-to-codex-migration).

Upstream (`affaan-m/everything-claude-code`) merge compatibility is explicitly
abandoned in favor of a clean, target-neutral layout.

## Goals

- Single source of truth for all content; no duplicated markdown between targets.
- `install.sh --target claude|codex|all` (default `all`) with matching
  `uninstall.sh`.
- Codex receives everything that maps 1:1 conceptually: global instructions,
  rules, skills, MCP servers.
- Claude Code installation behavior is unchanged in effect (same files land in
  `~/.claude`), only source paths change.
- History preserved via `git mv`.

## Non-Goals

- Porting hooks to Codex lifecycle events (no `PreToolUse` equivalent; revisit
  only if real failure data demands it).
- Porting agents (Codex has no subagent concept) or commands (Codex slash
  commands are a built-in surface; skills cover the use case via `$skill-name`).
- Managing `~/.codex/config.toml` beyond the `[mcp_servers.*]` table.
- Managing Codex profiles, model settings, or `~/.codex/rules/*.rules`
  (execpolicy files — unrelated to this repo's markdown rules).

## Target Structure

```
content/                              # single source of truth (target-neutral)
  instructions/global.md              # ← global/CLAUDE.md
  rules/{common,node,python,rust,typescript}/
  skills/{common,node,python}/
  agents/{common,node,python,rust,typescript}/   # consumed by Claude target only
  commands/{common,node,python,rust}/            # consumed by Claude target only
  hooks/{common,node,python,rust}/               # consumed by Claude target only
  mcp/servers.json                    # ← mcp-configs/mcp-servers.json

targets/                              # per-target adapters (no content, only mapping/transform)
  claude/install.sh                   # content/* → ~/.claude/* (current logic relocated)
  claude/uninstall.sh
  codex/install.sh                    # Codex mapping (below)
  codex/uninstall.sh
  codex/build-agents-md.sh            # generates AGENTS.md (global + rules index)
  codex/merge-mcp.py                  # servers.json → config.toml [mcp_servers.*] merge

scripts/
  install.sh                          # thin dispatcher: --target claude|codex|all
  uninstall.sh                        # same dispatcher shape
  lib/common.sh                       # copy_file, logging, dry-run/force flags
```

Principle: content lives only under `content/`; each target adapter selects what
it consumes. `agents/`, `hooks/`, `commands/` are simply not consumed by the
Codex adapter today — if Codex grows equivalent features, only the adapter
changes.

## Codex Mapping

| content | destination | method |
|---|---|---|
| `instructions/global.md` + `rules/**` | `~/.codex/AGENTS.md` + `~/.codex/instructions/*.md` | Rules are copied as individual files; `AGENTS.md` is generated as `global.md` body plus an appended **index section** ("when working on Python, read `~/.codex/instructions/python-coding-style.md`", etc.). Concatenating all rules would bloat every session's context; an index keeps AGENTS.md small and loads rules on demand. |
| `skills/**` | `~/.codex/skills/<name>/` | SKILL.md format is compatible; copy skill folders unchanged (superseded during implementation: Codex ignores unknown frontmatter keys, so no stripping is needed). Invoked via `$skill-name`. |
| `mcp/servers.json` | `[mcp_servers.*]` in `~/.codex/config.toml` | **Never overwrite config.toml wholesale** — it holds user state (project trust levels, plugins, model settings). Create a timestamped backup, then merge only `[mcp_servers.*]` keys using tomlkit via `uv run`. Existing user-defined servers with the same name are left untouched unless `--force`. |

Codex detection stays as today: `CODEX_HOME` set, `~/.codex` exists, or `codex`
on PATH. `--target codex` on a machine without Codex is an error; `--target all`
skips Codex with an INFO message.

## Claude Mapping

`content/instructions/global.md` → `~/.claude/CLAUDE.md`; all other categories
map as they do today (`content/agents/**` → `~/.claude/agents/`, etc., with the
existing language-subdirectory flattening and `{lang}-` prefix conventions
preserved). Behavior is identical to the current installer; only source paths
change.

## Ancillary Changes

- **`.claude-plugin/`**: update `plugin.json` path fields to point at
  `content/` locations where the plugin schema supports custom paths. If any
  category (e.g. skills auto-discovery) cannot be re-pathed, report during
  implementation and decide whether to keep a compatibility measure or drop
  plugin support for that category.
- **`tests/`**: update all path references; add dispatcher tests
  (`--target` routing, dry-run) and Codex adapter tests (AGENTS.md generation,
  MCP merge idempotency, backup creation).
- **`README.md` / `CONTRIBUTING.md`**: document the new layout and
  `--target` usage.
- **`schemas/`**, **`examples/`**, guides: update any hardcoded paths found by
  grep during implementation.

## Verification

- Full existing test suite passes after path updates.
- `install.sh --dry-run --target all` shows the expected file plan for both
  targets.
- MCP merge test: run twice against a fixture config.toml containing user keys;
  assert user keys untouched, merge idempotent, backup created.
- Manual (documented in README): restart Codex, verify skill discovery with
  `$skill-name`, verify AGENTS.md loads.

## Risks

- **Plugin path support**: plugin schema may not allow relocating every
  category. Mitigation: check `PLUGIN_SCHEMA_NOTES.md` and the marketplace
  schema first; report before deciding.
- **config.toml corruption**: mitigated by backup + key-scoped merge via
  tomlkit + idempotency test.
- **Upstream divergence**: accepted trade-off, chosen explicitly.
