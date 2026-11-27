# Migration Guide: Claude Code to OpenCode

This guide helps you migrate from Claude Code to OpenCode while using the ECC configuration.

## Overview

OpenCode is an alternative CLI for AI-assisted development that supports **all** the same features as Claude Code, with some differences in configuration format.

## Key Differences

| Feature | Claude Code | OpenCode | Notes |
|---------|-------------|----------|-------|
| Configuration | `CLAUDE.md`, `plugin.json` | `opencode.json` | Different file formats |
| Agents | Markdown frontmatter | JSON object | Full parity |
| Commands | `commands/*.md` | `command` object or `.md` files | Full parity |
| Skills | `skills/*/SKILL.md` | `instructions` array | Loaded as context |
| **Hooks** | `hooks.json` (3 phases) | **Plugin system (20+ events)** | **Full parity + more!** |
| Rules | `rules/*.md` | `instructions` array | Consolidated or separate |
| MCP | Full support | Full support | Full parity |

## Hook Migration

**OpenCode fully supports hooks** via its plugin system, which is actually MORE sophisticated than Claude Code with 20+ event types.

### Hook Event Mapping

| Claude Code Hook | OpenCode Plugin Event | Notes |
|-----------------|----------------------|-------|
| `PreToolUse` | `tool.execute.before` | Can modify tool input |
| `PostToolUse` | `tool.execute.after` | Can modify tool output |
| `Stop` | `session.idle` or `session.status` | Session lifecycle |
| `SessionStart` | `session.created` | Session begins |
| `SessionEnd` | `session.deleted` | Session ends |
| N/A | `file.edited` | OpenCode-only: file changes |
| N/A | `file.watcher.updated` | OpenCode-only: file system watch |
| N/A | `message.updated` | OpenCode-only: message changes |
| N/A | `lsp.client.diagnostics` | OpenCode-only: LSP integration |
| N/A | `tui.toast.show` | OpenCode-only: notifications |

### Converting Hooks to Plugins

**Claude Code hook (hooks.json):**
```json
{
  "PostToolUse": [{
    "matcher": "tool == \"Edit\" && tool_input.file_path matches \"\\\\.(ts|tsx|js|jsx)$\"",
    "hooks": [{
      "type": "command",
      "command": "prettier --write \"$file_path\""
    }]
  }]
}
```

**OpenCode plugin (.opencode/plugins/prettier-hook.ts):**
```typescript
export const PrettierPlugin = async ({ $ }) => {
  return {
    "file.edited": async (event) => {
      if (event.path.match(/\.(ts|tsx|js|jsx)$/)) {
        await $`prettier --write ${event.path}`
      }
    }
  }
}
```

### ECC Plugin Hooks Included

The ECC OpenCode configuration includes translated hooks:

| Hook | OpenCode Event | Purpose |
|------|----------------|---------|
| Prettier auto-format | `file.edited` | Format JS/TS files after edit |
| TypeScript check | `tool.execute.after` | Run tsc after editing .ts files |
| console.log warning | `file.edited` | Warn about console.log statements |
| Session notification | `session.idle` | Notify when task completes |
| Security check | `tool.execute.before` | Check for secrets before commit |

## Migration Steps

### 1. Install OpenCode

```bash
# Install OpenCode CLI
npm install -g opencode
# or
curl -fsSL https://opencode.ai/install | bash
```

### 2. Use the ECC OpenCode Configuration

The `.opencode/` directory in this repository contains the translated configuration:

```
.opencode/
├── opencode.json              # Main configuration
├── plugins/                   # Hook plugins (translated from hooks.json)
│   ├── ecc-hooks.ts           # All ECC hooks as plugins
│   └── index.ts               # Plugin exports
├── tools/                     # Custom tools
│   ├── run-tests.ts           # Run test suite
│   ├── check-coverage.ts      # Check coverage
│   └── security-audit.ts      # npm audit wrapper
├── commands/                  # All 23 commands (markdown)
│   ├── plan.md
│   ├── tdd.md
│   └── ... (21 more)
├── prompts/
│   └── agents/                # Agent prompt files (12)
├── instructions/
│   └── INSTRUCTIONS.md        # Consolidated rules
├── package.json               # For npm distribution
├── tsconfig.json              # TypeScript config
└── MIGRATION.md               # This file
```

### 3. Run OpenCode

```bash
# In the repository root
opencode

# The configuration is automatically detected from .opencode/opencode.json
```

## Concept Mapping

### Agents

**Claude Code:**
```markdown
---
name: planner
description: Expert planning specialist...
tools: ["Read", "Grep", "Glob"]
model: opus
---

You are an expert planning specialist...
```

**OpenCode:**
```json
{
  "agent": {
    "planner": {
      "description": "Expert planning specialist...",
      "mode": "subagent",
      "model": "anthropic/claude-opus-4-5",
      "prompt": "{file:prompts/agents/planner.txt}",
      "tools": { "read": true, "bash": true }
    }
  }
}
```

### Commands

**Claude Code:**
```markdown
---
name: plan
description: Create implementation plan
---

Create a detailed implementation plan for: {input}
```

**OpenCode (JSON):**
```json
{
  "command": {
    "plan": {
      "description": "Create implementation plan",
      "template": "Create a detailed implementation plan for: $ARGUMENTS",
      "agent": "planner"
    }
  }
}
```

**OpenCode (Markdown - .opencode/commands/plan.md):**
```markdown
---
description: Create implementation plan
agent: planner
---

Create a detailed implementation plan for: $ARGUMENTS
```

### Skills

**Claude Code:** Skills are loaded from `skills/*/SKILL.md` files.

**OpenCode:** Skills are added to the `instructions` array:
```json
{
  "instructions": [
    "skills/tdd-workflow/SKILL.md",
    "skills/security-review/SKILL.md",
    "skills/coding-standards/SKILL.md"
  ]
}
```

### Rules

**Claude Code:** Rules are in separate `rules/*.md` files.

**OpenCode:** Rules can be consolidated into `instructions` or kept separate:
```json
{
  "instructions": [
    "instructions/INSTRUCTIONS.md",
    "rules/common/security.md",
    "rules/common/coding-style.md"
  ]
}
```

## Model Mapping

| Claude Code | OpenCode |
|-------------|----------|
| `opus` | `anthropic/claude-opus-4-5` |
| `sonnet` | `anthropic/claude-sonnet-4-5` |
| `haiku` | `anthropic/claude-haiku-4-5` |

## Available Commands

After migration, ALL 23 commands are available:

| Command | Description |
|---------|-------------|
| `/plan` | Create implementation plan |
| `/tdd` | Enforce TDD workflow |
| `/code-review` | Review code changes |
| `/security` | Run security review |
| `/build-fix` | Fix build errors |
| `/e2e` | Generate E2E tests |
| `/refactor-clean` | Remove dead code |
| `/orchestrate` | Multi-agent workflow |
| `/learn` | Extract patterns mid-session |
| `/checkpoint` | Save verification state |
| `/verify` | Run verification loop |
| `/eval` | Run evaluation |
| `/update-docs` | Update documentation |
| `/update-codemaps` | Update codemaps |
| `/test-coverage` | Check test coverage |
| `/setup-pm` | Configure package manager |
| `/go-review` | Go code review |
| `/go-test` | Go TDD workflow |
| `/go-build` | Fix Go build errors |
| `/skill-create` | Generate skills from git history |
| `/instinct-status` | View learned instincts |
| `/instinct-import` | Import instincts |
| `/instinct-export` | Export instincts |
| `/evolve` | Cluster instincts into skills |
| `/promote` | Promote project instincts to global scope |
| `/projects` | List known projects and instinct stats |

## Available Agents

| Agent | Description |
|-------|-------------|
| `planner` | Implementation planning |
| `architect` | System design |
| `code-reviewer` | Code review |
| `security-reviewer` | Security analysis |
| `tdd-guide` | Test-driven development |
| `build-error-resolver` | Fix build errors |
| `e2e-runner` | E2E testing |
| `doc-updater` | Documentation |
| `refactor-cleaner` | Dead code cleanup |
| `go-reviewer` | Go code review |
| `go-build-resolver` | Go build errors |
| `database-reviewer` | Database optimization |

## Plugin Installation

### Option 1: Use ECC Configuration Directly

The `.opencode/` directory contains everything pre-configured.

### Option 2: Install as npm Package

```bash
npm install ecc-universal
```

Then in your `opencode.json`:
```json
{
  "plugin": ["ecc-universal"]
}
```

This only loads the published ECC OpenCode plugin module (hooks/events and exported plugin tools).
It does **not** automatically inject ECC's full `agent`, `command`, or `instructions` config into your project.

If you want the full ECC OpenCode workflow surface, use the repository's bundled `.opencode/opencode.json` as your base config or copy these pieces into your project:
- `.opencode/commands/`
- `.opencode/prompts/`
- `.opencode/instructions/INSTRUCTIONS.md`
- the `agent` and `command` sections from `.opencode/opencode.json`

## Troubleshooting

### Configuration Not Loading

1. Verify `.opencode/opencode.json` exists in the repository root
2. Check JSON syntax is valid: `cat .opencode/opencode.json | jq .`
3. Ensure all referenced prompt files exist

### Plugin Not Loading

1. Verify plugin file exists in `.opencode/plugins/`
2. Check TypeScript syntax is valid
3. Ensure `plugin` array in `opencode.json` includes the path

### Agent Not Found

1. Check the agent is defined in `opencode.json` under the `agent` object
2. Verify the prompt file path is correct
3. Ensure the prompt file exists at the specified path

### Command Not Working

1. Verify the command is defined in `opencode.json` or as `.md` file in `.opencode/commands/`
2. Check the referenced agent exists
3. Ensure the template uses `$ARGUMENTS` for user input
4. If you installed only `plugin: ["ecc-universal"]`, note that npm plugin install does not auto-add ECC commands or agents to your project config

## Best Practices

1. **Start Fresh**: Don't try to run both Claude Code and OpenCode simultaneously
2. **Check Configuration**: Verify `opencode.json` loads without errors
3. **Test Commands**: Run each command once to verify it works
4. **Use Plugins**: Leverage the plugin hooks for automation
5. **Use Agents**: Leverage the specialized agents for their intended purposes

## Reverting to Claude Code

If you need to switch back:

1. Simply run `claude` instead of `opencode`
2. Claude Code will use its own configuration (`CLAUDE.md`, `plugin.json`, etc.)
3. The `.opencode/` directory won't interfere with Claude Code

## Feature Parity Summary

| Feature | Claude Code | OpenCode | Status |
|---------|-------------|----------|--------|
| Agents | PASS: 12 agents | PASS: 12 agents | **Full parity** |
| Commands | PASS: 23 commands | PASS: 23 commands | **Full parity** |
| Skills | PASS: 16 skills | PASS: 16 skills | **Full parity** |
| Hooks | PASS: 3 phases | PASS: 20+ events | **OpenCode has MORE** |
| Rules | PASS: 8 rules | PASS: 8 rules | **Full parity** |
| MCP Servers | PASS: Full | PASS: Full | **Full parity** |
| Custom Tools | PASS: Via hooks | PASS: Native support | **OpenCode is better** |

## Feedback

For issues specific to:
- **OpenCode CLI**: Report to OpenCode's issue tracker
- **ECC Configuration**: Report to [github.com/affaan-m/ECC](https://github.com/affaan-m/ECC)
