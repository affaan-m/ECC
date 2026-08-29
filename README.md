# Everything Claude Code

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Shell](https://img.shields.io/badge/-Shell-4EAA25?logo=gnu-bash&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)
![Markdown](https://img.shields.io/badge/-Markdown-000000?logo=markdown&logoColor=white)

A curated collection of Claude Code configurations — agents, skills, commands,
rules, and hooks — installable per language into **Claude Code** (`~/.claude`)
and **Codex CLI** (`~/.codex`) from a single shared content tree.

This is a fork of
[affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code),
restructured around a script-based, dual-target install flow:

- **Single source of truth**: all shared content lives in a target-neutral
  `content/` tree; per-tool install logic lives in `targets/<target>/`.
- **Script install, not plugin install**: `./scripts/install.sh` copies exactly
  the languages you ask for, shows dry runs, and merges hooks safely.
- **Codex CLI support**: the same content installs into `~/.codex`
  (`AGENTS.md`, instructions, skills, MCP servers).

---

## Installation

### Requirements

- `bash`, `git`
- `jq` — merging hooks from multiple languages into `settings.json`, and
  preserving non-hook keys when overwriting an existing `settings.json`
- Node.js — hook runtime scripts and the test suite
- [`uv`](https://docs.astral.sh/uv/) — only for the Codex MCP config merge
  (skipped with a warning if missing)
- Claude Code CLI v2.1.0+ (check with `claude --version`)

### Quick start

```bash
git clone https://github.com/appleparan/everything-claude-code.git
cd everything-claude-code

# Install common + python configs for both Claude Code and Codex
# (Codex is skipped automatically when not detected)
./scripts/install.sh python common

# Claude Code only / Codex only
./scripts/install.sh --target claude python common
./scripts/install.sh --target codex python common

# Preview what would be installed, without writing anything
./scripts/install.sh -n --target all python common

# List available languages and what each one ships
./scripts/install.sh -l
```

`scripts/install.sh` is a thin `--target claude|codex|all` dispatcher (default
`all`) over `targets/claude/install.sh` and `targets/codex/install.sh`, which
both read from the single `content/` source tree.

Available languages: `common`, `node`, `python`, `rust`, `typescript`.
`common` holds language-agnostic content; you almost always want it plus the
languages you work in.

Options (shared by install and uninstall):

| Flag | Effect |
|---|---|
| `--target claude\|codex\|all` | Which tool to install into (default `all`) |
| `-n` | Dry run — show what would be copied without copying |
| `-f` | Force-overwrite existing files (default is skip) |
| `-l` | List available languages |
| `-h` | Show help |

### What the Claude target installs

`./scripts/install.sh --target claude <language>...` copies into `~/.claude/`:

| Source | Destination | Notes |
|---|---|---|
| `content/instructions/global.md` | `~/.claude/CLAUDE.md` | Global instructions |
| `content/agents/<lang>/*.md` | `~/.claude/agents/` | Specialized subagents |
| `content/skills/<lang>/<name>/` | `~/.claude/skills/<name>/` | Skill directories with `SKILL.md` |
| `content/commands/<lang>/*.md` | `~/.claude/commands/` | Slash commands |
| `content/rules/<lang>/*.md` | `~/.claude/rules/` | Always-follow guidelines |
| `content/hooks/<lang>/hooks.json`, `global-hooks.json` | merged into `~/.claude/settings.json` | Global hooks |
| `content/hooks/<lang>/project-hooks.json` | `~/.claude/project-hooks/<lang>.json` | Templates for `init-project.sh` |
| `scripts/<lang>/hooks/`, `scripts/<lang>/lib/` | `~/.claude/scripts/<lang>/...` | Hook runtime scripts |

Hook handling details worth knowing:

- Existing files are **skipped** unless you pass `-f`.
- Multiple languages' hooks are merged with `jq`; when overwriting an existing
  `settings.json`, only the `hooks` key is replaced — your other settings
  (permissions, model, enabled plugins, ...) are preserved.
- After install, a smoke test warns about any hook that references a script
  path that doesn't exist.

### Project-level hooks

Global hooks stay language-agnostic; language-specific hooks are initialized
per project:

```bash
cd /path/to/your/project
~/.claude/scripts/init-project.sh            # auto-detect from project files
~/.claude/scripts/init-project.sh python     # or specify explicitly
~/.claude/scripts/init-project.sh node python  # merge for mixed projects
```

Auto-detection: `pyproject.toml` → python, `package.json` → node,
`Cargo.toml` → rust. The selected templates from `~/.claude/project-hooks/`
are merged into the project's `.claude/settings.json` (`-f` to overwrite,
`-n` to preview).

> The script also lives in the repo as `scripts/init-project.sh` if you
> prefer running it from the clone.

### Codex support

`./scripts/install.sh --target codex` (or `--target all` when Codex is
detected) installs into `$CODEX_HOME` or `~/.codex`:

| content | destination |
|---|---|
| `content/instructions/global.md` + rules index | `~/.codex/AGENTS.md` (generated) |
| `content/rules/**` | `~/.codex/instructions/*.md` (flat, one file per rule) |
| `content/skills/**` | `~/.codex/skills/<name>/` (invoked via `$skill-name`, e.g. `$git-commit-msg`) |
| `content/mcp/servers.json` | `[mcp_servers.*]` merged into `~/.codex/config.toml`, with a timestamped backup of the existing file. Requires `uv`; if it's missing, the MCP step is skipped with a warning and the entries can be added manually. |

Codex has no subagent or slash-command concept, so `content/agents/` and
`content/commands/` are not installed there. `content/hooks/` targets Claude
Code's tool-event hooks, which have no Codex lifecycle equivalent, so those
are not installed either.

Codex is detected via `$CODEX_HOME`, an existing `~/.codex` directory, or a
`codex` binary on `PATH`. `--target codex` on a machine without any of those
is an error; `--target all` prints an INFO message and skips Codex.

**Manual verification after installing:** restart Codex, run `$skill-name`
(e.g. `$git-commit-msg`) to confirm skill discovery, and confirm `AGENTS.md`
is loaded (Codex reads it automatically at session start).

### Uninstall

```bash
./scripts/uninstall.sh                    # both targets (codex skipped if absent)
./scripts/uninstall.sh --target claude
./scripts/uninstall.sh --target codex
```

`uninstall.sh --target codex` removes the installed files but never touches
`config.toml` — it prints the manual removal steps instead, since that file
also holds user state (trust levels, model settings) that must not be
clobbered.

---

## Repository layout

```text
everything-claude-code/
|-- .claude-plugin/   # Plugin and marketplace manifests (upstream plugin flow)
|   |-- plugin.json             # Plugin metadata, component paths (./content/...)
|   |-- marketplace.json        # Marketplace catalog for /plugin marketplace add
|   |-- PLUGIN_SCHEMA_NOTES.md  # Undocumented validator constraints
|
|-- content/          # Single source of truth (target-neutral, no install logic)
|   |-- instructions/
|   |   |-- global.md        # Global instructions (-> ~/.claude/CLAUDE.md, folded into ~/.codex/AGENTS.md)
|   |-- agents/               # Specialized subagents (Claude Code only)
|   |   |-- common/, node/, python/, rust/, typescript/
|   |-- skills/                # Workflow definitions (Claude Code + Codex, via $skill-name)
|   |   |-- common/, node/, python/
|   |-- commands/              # Slash commands (Claude Code only)
|   |   |-- common/, node/, python/, rust/
|   |-- rules/                 # Always-follow guidelines (Claude Code + Codex)
|   |   |-- common/, node/, python/, rust/, typescript/
|   |-- hooks/                 # Trigger-based automations (Claude Code only)
|   |   |-- common/, node/, python/, rust/
|   |-- mcp/
|       |-- servers.json     # MCP server configs (Claude Code settings + Codex config.toml)
|
|-- targets/           # Per-target adapters - mapping/transform only, no content
|   |-- claude/
|   |   |-- install.sh        # content/* -> ~/.claude/*
|   |   |-- uninstall.sh
|   |-- codex/
|       |-- install.sh        # content/* -> ~/.codex/* (see Codex support above)
|       |-- uninstall.sh
|       |-- build-agents-md.sh  # Generates AGENTS.md (global.md + rules index)
|       |-- merge-mcp.py        # servers.json -> config.toml [mcp_servers.*] merge
|
|-- scripts/          # Thin dispatchers + hook runtime scripts
|   |-- install.sh           # --target claude|codex|all (default all)
|   |-- uninstall.sh         # --target claude|codex|all (default all)
|   |-- init-project.sh      # Initialize project hooks
|   |-- lib/common.sh        # Shared copy/log/dry-run helpers for targets/
|   |-- node/                # Node.js hook runtime scripts
|   |   |-- lib/, hooks/, ci/
|   |-- python/              # Python hook runtime scripts (as they land)
|
|-- docs/             # Repo structure and validation docs
|   |-- COMMAND-AGENT-MAP.md
|   |-- SECURITY-VALIDATION.md
|   |-- SKILL-PLACEMENT-POLICY.md
|
|-- tests/            # Test suite (node tests/run-all.js)
|-- examples/         # Example CLAUDE.md configurations
```

---

## Key concepts

### Agents

Subagents handle delegated tasks with limited scope:

```yaml
---
name: code-reviewer
description: Reviews code for quality, security, and maintainability
tools: ["Read", "Grep", "Glob", "Bash"]
model: opus
---

You are a senior code reviewer...
```

### Skills

Skills are workflow definitions invoked by commands or agents:

```text
# TDD Workflow

1. Define interfaces first
2. Write failing tests (RED)
3. Implement minimal code (GREEN)
4. Refactor (IMPROVE)
5. Verify 80%+ coverage
```

### Hooks

Hooks fire on tool events — e.g. warn about `console.log` after an edit,
block `pip install` in favor of `uv`, auto-format files after changes.
Global hooks live in `settings.json`; language-specific hooks are installed
per project via `init-project.sh`.

### Rules

Rules are always-follow guidelines, kept modular:

```text
~/.claude/rules/
  security.md      # No hardcoded secrets
  coding-style.md  # Immutability, file limits
  testing.md       # TDD, coverage requirements
```

---

## Alternative: install as a plugin

The upstream repo distributes this content as a Claude Code plugin
(`/plugin marketplace add affaan-m/everything-claude-code`). This fork keeps
the plugin manifests (`.claude-plugin/`) intact, but the script-based install
above is the supported path here — it is explicit about what gets copied,
supports Codex, and installs `rules`, which the plugin system cannot
distribute ([upstream limitation](https://code.claude.com/docs/en/plugins-reference)).

> **For contributors:** do NOT add a `"hooks"` field to
> `.claude-plugin/plugin.json`. Claude Code v2.1+ auto-loads
> `hooks/hooks.json` from installed plugins by convention, and declaring it
> explicitly causes a duplicate-hooks error. A regression test enforces this.

---

## Development

```bash
# Run all tests
node tests/run-all.js

# Lint JS and Markdown (same as CI)
npx eslint scripts/**/*.js tests/**/*.js
npx markdownlint "content/**/*.md"
```

Tests cover the hook runtime libraries, dispatcher `--target` handling, and
the Codex adapter scripts.

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Guides

The original author's guides explain the philosophy behind these configs and
live in the upstream repository:

- [The Shortform Guide](https://github.com/affaan-m/everything-claude-code/blob/main/the-shortform-guide.md)
  — setup, foundations, philosophy. Read this first.
- [The Longform Guide](https://github.com/affaan-m/everything-claude-code/blob/main/the-longform-guide.md)
  — token optimization, memory persistence, evals, parallelization, subagent
  orchestration.

### Context window management

Don't enable every MCP server at once — a 200k context window can shrink to
70k with too many tools enabled. Keep under ~10 servers enabled per project
and under ~80 active tools; disable unused ones with `disabledMcpServers` in
the project config.

### Customization

These configs are a starting point, not a prescription:

1. Start with what resonates
2. Modify for your stack
3. Remove what you don't use
4. Add your own patterns

---

## Credits

Original collection by [Affaan Mustafa](https://x.com/affaanmustafa)
([affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)).
This fork adds the dual-target (`content/` + `targets/`) restructure and the
script-based install flow.

## License

MIT — use freely, modify as needed, contribute back if you can.
