# Everything Claude Code

[![Stars](https://img.shields.io/github/stars/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Shell](https://img.shields.io/badge/-Shell-4EAA25?logo=gnu-bash&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)
![Markdown](https://img.shields.io/badge/-Markdown-000000?logo=markdown&logoColor=white)

---

**The complete collection of Claude Code configs from an Anthropic hackathon winner.**

Production-ready agents, skills, hooks, commands, rules, and MCP configurations evolved over 10+ months of intensive daily use building real products.

---

## The Guides

This repo is the raw code only. The guides explain everything.

<table>
<tr>
<td width="50%">
<a href="https://x.com/affaanmustafa/status/2012378465664745795">
<img src="https://github.com/user-attachments/assets/1a471488-59cc-425b-8345-5245c7efbcef" alt="The Shorthand Guide to Everything Claude Code" />
</a>
</td>
<td width="50%">
<a href="https://x.com/affaanmustafa/status/2014040193557471352">
<img src="https://github.com/user-attachments/assets/c9ca43bc-b149-427f-b551-af6840c368f0" alt="The Longform Guide to Everything Claude Code" />
</a>
</td>
</tr>
<tr>
<td align="center"><b>Shorthand Guide</b><br/>Setup, foundations, philosophy. <b>Read this first.</b></td>
<td align="center"><b>Longform Guide</b><br/>Token optimization, memory persistence, evals, parallelization.</td>
</tr>
</table>

| Topic | What You'll Learn |
|-------|-------------------|
| Token Optimization | Model selection, system prompt slimming, background processes |
| Memory Persistence | Hooks that save/load context across sessions automatically |
| Continuous Learning | Auto-extract patterns from sessions into reusable skills |
| Verification Loops | Checkpoint vs continuous evals, grader types, pass@k metrics |
| Parallelization | Git worktrees, cascade method, when to scale instances |
| Subagent Orchestration | The context problem, iterative retrieval pattern |

---

## 🚀 Quick Start

Get up and running in under 2 minutes:

### Step 1: Install the Plugin

```bash
# Add marketplace
/plugin marketplace add affaan-m/everything-claude-code

# Install plugin
/plugin install everything-claude-code@everything-claude-code
```

### Step 2: Install Rules (Required)

> ⚠️ **Important:** Claude Code plugins cannot distribute `rules` automatically. Install them manually:

```bash
# Clone the repo first
git clone https://github.com/affaan-m/everything-claude-code.git

# Copy rules (applies to all projects)
cp -r everything-claude-code/content/rules/* ~/.claude/rules/
```

### Step 3: Start Using

```bash
# Try a command
/plan "Add user authentication"

# Check available commands
/plugin list everything-claude-code@everything-claude-code
```

✨ **That's it!** You now have access to 15+ agents, 30+ skills, and 20+ commands.

---

## 🌐 Cross-Platform Support

This plugin now fully supports **Windows, macOS, and Linux**. All hooks and scripts have been rewritten in Node.js for maximum compatibility.

### Package Manager Detection

The plugin automatically detects your preferred package manager (npm, pnpm, yarn, or bun) with the following priority:

1. **Environment variable**: `CLAUDE_PACKAGE_MANAGER`
2. **Project config**: `.claude/package-manager.json`
3. **package.json**: `packageManager` field
4. **Lock file**: Detection from package-lock.json, yarn.lock, pnpm-lock.yaml, or bun.lockb
5. **Global config**: `~/.claude/package-manager.json`
6. **Fallback**: First available package manager

To set your preferred package manager:

```bash
# Via environment variable
export CLAUDE_PACKAGE_MANAGER=pnpm

# Via global config
node scripts/setup-package-manager.js --global pnpm

# Via project config
node scripts/setup-package-manager.js --project bun

# Detect current setting
node scripts/setup-package-manager.js --detect
```

Or use the `/setup-pm` command in Claude Code.

---

## 📦 What's Inside

This repo is a **Claude Code plugin** that also installs into **Codex CLI** -
install it directly or copy components manually. All shared content lives in
one target-neutral tree (`content/`); per-tool install logic lives in
`targets/<target>/`.

```text
everything-claude-code/
|-- .claude-plugin/   # Plugin and marketplace manifests
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
|       |-- install.sh        # content/* -> ~/.codex/* (see Codex support below)
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
|-- tests/            # Test suite
|   |-- lib/                     # Library tests
|   |-- hooks/                   # Hook tests
|   |-- integration/             # Integration tests
|   |-- scripts/                 # Dispatcher and Codex adapter tests
|   |-- run-all.js               # Run all tests
|
|-- examples/         # Example configurations and sessions
|   |-- CLAUDE.md           # Example project-level config
|   |-- user-CLAUDE.md      # Example user-level config
|
|-- marketplace.json  # Self-hosted marketplace config (for /plugin marketplace add)
```

---

## 🛠️ Ecosystem Tools

### Skill Creator

Two ways to generate Claude Code skills from your repository:

#### Option A: Local Analysis (Built-in)

Use the `/skill-create` command for local analysis without external services:

```bash
/skill-create                    # Analyze current repo
```

This analyzes your git history locally and generates SKILL.md files.

#### Option B: GitHub App (Advanced)

For advanced features (10k+ commits, auto-PRs, team sharing):

[Install GitHub App](https://github.com/apps/skill-creator) | [ecc.tools](https://ecc.tools)

```bash
# Comment on any issue:
/skill-creator analyze

# Or auto-triggers on push to default branch
```

Both options create:

- **SKILL.md files** - Ready-to-use skills for Claude Code
- **Pattern extraction** - Learns from your commit history

---

## 📋 Requirements

### Claude Code CLI Version

Minimum version: v2.1.0 or later.

This plugin requires Claude Code CLI v2.1.0+ due to changes in how the plugin system handles hooks.

Check your version:

```bash
claude --version
```

### Important: Hooks Auto-Loading Behavior

> ⚠️ **For Contributors:** Do NOT add a `"hooks"` field to `.claude-plugin/plugin.json`. This is enforced by a regression test.

Claude Code v2.1+ **automatically loads** `hooks/hooks.json` from any installed plugin by convention. Explicitly declaring it in `plugin.json` causes a duplicate detection error:

```text
Duplicate hooks file detected: ./hooks/hooks.json resolves to already-loaded file
```

**History:** This has caused repeated fix/revert cycles in this repo ([#29](https://github.com/affaan-m/everything-claude-code/issues/29), [#52](https://github.com/affaan-m/everything-claude-code/issues/52), [#103](https://github.com/affaan-m/everything-claude-code/issues/103)). The behavior changed between Claude Code versions, leading to confusion. We now have a regression test to prevent this from being reintroduced.

---

## 📥 Installation

### Option 1: Install as Plugin (Recommended)

The easiest way to use this repo - install as a Claude Code plugin:

```bash
# Add this repo as a marketplace
/plugin marketplace add affaan-m/everything-claude-code

# Install the plugin
/plugin install everything-claude-code@everything-claude-code
```

Or add directly to your `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "everything-claude-code": {
      "source": {
        "source": "github",
        "repo": "affaan-m/everything-claude-code"
      }
    }
  },
  "enabledPlugins": {
    "everything-claude-code@everything-claude-code": true
  }
}
```

This gives you instant access to all commands, agents, skills, and hooks.

> **Note:** The Claude Code plugin system does not support distributing `rules` via plugins ([upstream limitation](https://code.claude.com/docs/en/plugins-reference)). You need to install rules manually:
>
> ```bash
> # Clone the repo first
> git clone https://github.com/affaan-m/everything-claude-code.git
>
> # Option A: User-level rules (applies to all projects)
> cp -r everything-claude-code/content/rules/* ~/.claude/rules/
>
> # Option B: Project-level rules (applies to current project only)
> mkdir -p .claude/rules
> cp -r everything-claude-code/content/rules/* .claude/rules/
> ```

---

### 🔧 Option 2: Install Script (Claude Code, Codex, or both)

If you prefer explicit, scriptable control over what's installed - and if you
also use [Codex CLI](https://github.com/openai/codex) - use the install
dispatcher instead of the plugin marketplace:

```bash
# Clone the repo
git clone https://github.com/affaan-m/everything-claude-code.git
cd everything-claude-code

# Install for both Claude Code and Codex (Codex skipped if not detected)
./scripts/install.sh python common

# Claude Code only / Codex only
./scripts/install.sh --target claude python common
./scripts/install.sh --target codex python common

# Preview what would be installed, without writing anything
./scripts/install.sh -n --target all python common

# List available languages
./scripts/install.sh -l
```

`scripts/install.sh` is a thin `--target claude|codex|all` dispatcher
(default `all`) over `targets/claude/install.sh` and `targets/codex/install.sh`,
which both read from the single `content/` source tree. Matching
`scripts/uninstall.sh` accepts the same `--target` flag. Add `-f` to either
script to force-overwrite existing files.

---

### Codex Support

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
`uninstall.sh --target codex` removes the installed files but never touches
`config.toml` - it prints the manual removal steps instead, since that file
also holds user state (trust levels, model settings) that must not be
clobbered.

**Manual verification after installing:** restart Codex, run `$skill-name`
(e.g. `$git-commit-msg`) to confirm skill discovery, and confirm `AGENTS.md`
is loaded (Codex reads it automatically at session start).

---

## 🎯 Key Concepts

### Agents

Subagents handle delegated tasks with limited scope. Example:

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

Hooks fire on tool events. Example - warn about console.log:

```json
{
  "matcher": "tool == \"Edit\" && tool_input.file_path matches \"\\\\.(ts|tsx|js|jsx)$\"",
  "hooks": [{
    "type": "command",
    "command": "#!/bin/bash\ngrep -n 'console\\.log' \"$file_path\" && echo '[Hook] Remove console.log' >&2"
  }]
}
```

### Rules

Rules are always-follow guidelines. Keep them modular:

```text
~/.claude/rules/
  security.md      # No hardcoded secrets
  coding-style.md  # Immutability, file limits
  testing.md       # TDD, coverage requirements
```

---

## 🧪 Running Tests

The plugin includes a comprehensive test suite:

```bash
# Run all tests
node tests/run-all.js

# Run individual test files
node tests/lib/utils.test.js
node tests/lib/package-manager.test.js
node tests/hooks/hooks.test.js
```

---

## 🤝 Contributing

**Contributions are welcome and encouraged.**

This repo is meant to be a community resource. If you have:

- Useful agents or skills
- Clever hooks
- Better MCP configurations
- Improved rules

Please contribute! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Ideas for Contributions

- Language-specific skills (Rust patterns, etc.)
- Framework-specific configs (Django, Rails, Laravel)
- DevOps agents (Kubernetes, Terraform, AWS)
- Testing strategies (different frameworks)
- Domain-specific knowledge (ML, data engineering, mobile)

---

## 📖 Background

I've been using Claude Code since the experimental rollout. Won the Anthropic x Forum Ventures hackathon in Sep 2025 building [zenith.chat](https://zenith.chat) with [@DRodriguezFX](https://x.com/DRodriguezFX) - entirely using Claude Code.

These configs are battle-tested across multiple production applications.

---

## ⚠️ Important Notes

### Context Window Management

**Critical:** Don't enable all MCPs at once. Your 200k context window can shrink to 70k with too many tools enabled.

Rule of thumb:

- Have 20-30 MCPs configured
- Keep under 10 enabled per project
- Under 80 tools active

Use `disabledMcpServers` in project config to disable unused ones.

### Customization

These configs work for my workflow. You should:

1. Start with what resonates
2. Modify for your stack
3. Remove what you don't use
4. Add your own patterns

---

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=affaan-m/everything-claude-code&type=Date)](https://star-history.com/#affaan-m/everything-claude-code&Date)

---

## 🔗 Links

- **Shorthand Guide (Start Here):** [The Shorthand Guide to Everything Claude Code](https://x.com/affaanmustafa/status/2012378465664745795)
- **Longform Guide (Advanced):** [The Longform Guide to Everything Claude Code](https://x.com/affaanmustafa/status/2014040193557471352)
- **Follow:** [@affaanmustafa](https://x.com/affaanmustafa)
- **zenith.chat:** [zenith.chat](https://zenith.chat)

---

## 📄 License

MIT - Use freely, modify as needed, contribute back if you can.

---

**Star this repo if it helps. Read both guides. Build something great.**
