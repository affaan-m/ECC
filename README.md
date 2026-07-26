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
cp -r everything-claude-code/rules/* ~/.claude/rules/
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

This repo is a **Claude Code plugin** - install it directly or copy components manually.

```text
everything-claude-code/
|-- .claude-plugin/   # Plugin and marketplace manifests
|   |-- plugin.json         # Plugin metadata and component paths
|   |-- marketplace.json    # Marketplace catalog for /plugin marketplace add
|
|-- global/           # Global CLAUDE.md (copied to ~/.claude/CLAUDE.md)
|   |-- CLAUDE.md
|
|-- agents/           # Specialized subagents for delegation
|   |-- common/              # Language-agnostic agents
|   |   |-- planner.md           # Feature implementation planning
|   |   |-- architect.md         # System design decisions
|   |-- node/                # Node.js/TypeScript agents
|   |   |-- node-code-reviewer.md
|   |   |-- node-tdd-guide.md
|   |   |-- node-build-error-resolver.md
|   |   |-- node-e2e-runner.md
|   |   |-- node-security-reviewer.md
|   |   |-- node-refactor-cleaner.md
|   |   |-- node-doc-updater.md
|   |-- python/              # Python agents
|   |   |-- fastapi-reviewer.md
|   |   |-- python-code-reviewer.md
|   |   |-- python-reviewer.md
|   |   |-- python-tdd-guide.md
|   |   |-- python-planner.md
|   |   |-- python-refactor-cleaner.md
|   |   |-- python-doc-updater.md
|   |-- rust/                # Rust agents
|   |   |-- rust-build-resolver.md
|   |   |-- rust-reviewer.md
|   |-- typescript/          # TypeScript/JavaScript agents
|       |-- typescript-reviewer.md
|
|-- skills/           # Workflow definitions and domain knowledge
|   |-- common/              # Language-agnostic skills
|   |   |-- security-review/
|   |-- node/                # Node.js/TypeScript skills
|   |   |-- node-coding-standards/
|   |   |-- node-backend-patterns/
|   |   |-- node-frontend-patterns/
|   |   |-- node-tdd-workflow/
|   |   |-- node-verification-loop/
|   |-- python/              # Python skills
|   |   |-- fastapi-patterns/
|   |   |-- python-patterns/
|   |   |-- python-testing/
|
|-- commands/         # Slash commands for quick execution
|   |-- common/              # Language-agnostic commands
|   |   |-- plan.md, code-review.md, verify.md, ...
|   |-- node/                # Node.js commands
|   |   |-- node-tdd.md, node-build-fix.md, node-e2e.md, ...
|   |-- python/              # Python commands
|   |   |-- python-review.md
|   |   |-- fastapi-review.md
|   |-- rust/                # Rust commands
|       |-- rust-build.md, rust-review.md, rust-test.md
|
|-- rules/            # Always-follow guidelines (copy to ~/.claude/rules/)
|   |-- common/              # Language-agnostic rules
|   |   |-- agents.md, coding-style.md, security.md, testing.md, ...
|   |-- node/                # Node.js rules
|   |   |-- node-coding-style.md, node-security.md, node-testing.md, ...
|   |-- python/              # Python rules
|   |   |-- python-coding-style.md, python-fastapi.md, python-security.md, ...
|   |-- rust/                # Rust rules
|   |   |-- rust-coding-style.md, rust-security.md, rust-testing.md, ...
|   |-- typescript/          # TypeScript/JavaScript rules
|       |-- typescript-coding-style.md, typescript-security.md, ...
|
|-- hooks/            # Trigger-based automations
|   |-- common/              # Language-agnostic hooks
|   |   |-- hooks.json           # Git push review, doc blocker, PR logging
|   |-- node/                # Node.js hooks
|   |   |-- global-hooks.json    # Session lifecycle, compaction
|   |   |-- project-hooks.json   # oxfmt, tsc, console.log warning
|   |-- python/              # Python hooks
|   |   |-- project-hooks.json   # ruff, ty check, print() warning
|   |-- rust/                # Rust hooks
|       |-- project-hooks.json   # cargo fmt, cargo clippy
|
|-- scripts/          # Install/uninstall and hook scripts
|   |-- install.sh           # Install configs to ~/.claude/
|   |-- uninstall.sh         # Remove configs from ~/.claude/
|   |-- init-project.sh      # Initialize project hooks
|   |-- node/                # Node.js scripts
|       |-- lib/                 # Shared utilities
|       |-- hooks/               # Hook implementations
|       |-- ci/                  # CI validation scripts
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
|   |-- run-all.js               # Run all tests
|
|-- examples/         # Example configurations and sessions
|   |-- CLAUDE.md           # Example project-level config
|   |-- user-CLAUDE.md      # Example user-level config
|
|-- mcp-configs/      # MCP server configurations
|   |-- mcp-servers.json    # Chrome DevTools MCP
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
> cp -r everything-claude-code/rules/* ~/.claude/rules/
>
> # Option B: Project-level rules (applies to current project only)
> mkdir -p .claude/rules
> cp -r everything-claude-code/rules/* .claude/rules/
> ```

---

### 🔧 Option 2: Manual Installation

If you prefer manual control over what's installed:

```bash
# Clone the repo
git clone https://github.com/affaan-m/everything-claude-code.git

# Copy agents to your Claude config
cp everything-claude-code/agents/*.md ~/.claude/agents/

# Copy rules
cp everything-claude-code/rules/*.md ~/.claude/rules/

# Copy commands
cp everything-claude-code/commands/*.md ~/.claude/commands/

# Copy skills
cp -r everything-claude-code/skills/* ~/.claude/skills/
```

#### Add hooks to settings.json

Copy the hooks from `hooks/hooks.json` to your `~/.claude/settings.json`.

#### Configure MCPs

Copy desired MCP servers from `mcp-configs/mcp-servers.json` to your `~/.claude.json`.

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
