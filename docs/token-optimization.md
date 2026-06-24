# Token Optimization Guide

Practical settings and habits to reduce token consumption, extend session quality, and get more work done within daily limits.

> See also: `rules/common/performance.md` for model selection strategy, `skills/strategic-compact/` for automated compaction suggestions.

---

## Recommended Settings

These are recommended defaults for most users. Power users can tune values further based on their workload — for example, setting `MAX_THINKING_TOKENS` lower for simple tasks or higher for complex architectural work.

Add to your `~/.claude/settings.json`:

```json
{
  "model": "sonnet",
  "env": {
    "MAX_THINKING_TOKENS": "10000",
    "CLAUDE_CODE_SUBAGENT_MODEL": "haiku"
  }
}
```

### What each setting does

| Setting | Default | Recommended | Effect |
|---------|---------|-------------|--------|
| `model` | opus | **sonnet** | Sonnet handles ~80% of coding tasks well. Switch to Opus with `/model opus` for complex reasoning. ~60% cost reduction. |
| `MAX_THINKING_TOKENS` | 31,999 | **10,000** | Extended thinking reserves up to 31,999 output tokens per request for internal reasoning. Reducing this cuts hidden cost by ~70%. Set to `0` to disable for trivial tasks. |
| `CLAUDE_CODE_SUBAGENT_MODEL` | _(inherits main)_ | **haiku** | Subagents (Task tool) run on this model. Haiku is ~80% cheaper and sufficient for exploration, file reading, and test running. |
| `ECC_CONTEXT_MONITOR_COST_WARNINGS` | on | **off for subscription users** | Suppresses agent-facing API-rate estimate warnings while keeping context exhaustion, scope, and loop warnings. |

### Community note on auto-compaction overrides

Some recent Claude Code builds have community reports that `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` can only lower the compaction threshold, which means values below the default may compact earlier instead of later. If that happens in your setup, remove the override and rely on manual `/compact` plus ECC's `strategic-compact` guidance. See [Troubleshooting](./TROUBLESHOOTING.md).

### Toggling extended thinking

- **Alt+T** (Windows/Linux) or **Option+T** (macOS) — toggle on/off
- **Ctrl+O** — see thinking output (verbose mode)

---

## Model Selection

Use the right model for the task:

| Model | Best for | Cost |
|-------|----------|------|
| **Haiku** | Subagent exploration, file reading, simple lookups | Lowest |
| **Sonnet** | Day-to-day coding, reviews, test writing, implementation | Medium |
| **Opus** | Complex architecture, multi-step reasoning, debugging subtle issues | Highest |

Switch models mid-session:

```
/model sonnet     # default for most work
/model opus       # complex reasoning
/model haiku      # quick lookups
```

---

## Context Management

### Commands

| Command | When to use |
|---------|-------------|
| `/clear` | Between unrelated tasks. Stale context wastes tokens on every subsequent message. |
| `/compact` | At logical task breakpoints (after planning, after debugging, before switching focus). |
| `/cost` | Check token spending for the current session. |

### API-rate cost estimate warnings

ECC's context monitor can emit API-rate cost estimates from local hook telemetry. If you are on a Claude subscription and those estimates do not reflect your actual bill, disable only the agent-facing cost warnings:

```bash
export ECC_CONTEXT_MONITOR_COST_WARNINGS=off
```

Windows PowerShell:

```powershell
[Environment]::SetEnvironmentVariable('ECC_CONTEXT_MONITOR_COST_WARNINGS', 'off', 'User')
```

This does not disable context exhaustion warnings, scope warnings, loop warnings, `/cost`, or cost telemetry files.

### Strategic compaction

The `strategic-compact` skill (in `skills/strategic-compact/`) suggests `/compact` at logical intervals rather than relying on auto-compaction, which can trigger mid-task. See the skill's README for hook setup instructions.

**When to compact:**
- After exploration, before implementation
- After completing a milestone
- After debugging, before continuing with new work
- Before a major context shift

**When NOT to compact:**
- Mid-implementation of related changes
- While debugging an active issue
- During multi-file refactoring

### Subagents protect your context

Use subagents (Task tool) for exploration instead of reading many files in your main session. The subagent reads 20 files but only returns a summary — your main context stays clean.

---

## MCP Server Management

Each enabled MCP server adds tool definitions to your context window. The README warns: **keep under 10 enabled per project**.

Tips:
- Run `/mcp` to see active servers and their context cost
- Use `/mcp` to disable Claude Code MCP servers when you want a live runtime change. Claude Code persists those runtime disables in `~/.claude.json`.
- Prefer CLI tools when available (`gh` instead of GitHub MCP, `aws` instead of AWS MCP)
- Do not rely on `.claude/settings.json` or `.claude/settings.local.json` to disable already-loaded Claude Code MCP servers; use `/mcp` for that.
- `ECC_DISABLED_MCPS` only affects ECC-generated MCP config output during install/sync flows, such as `install.sh`, `npx ecc-install`, and Codex MCP merging. It is not a live Claude Code toggle.
- The `memory` MCP server is configured by default but not used by any skill, agent, or hook — consider disabling it

---

## Agent Teams Cost Warning

[Agent Teams](https://code.claude.com/docs/en/agent-teams) (experimental) spawns multiple independent context windows. Each teammate consumes tokens separately.

- Only use for tasks where parallelism adds clear value (multi-module work, parallel reviews)
- For simple sequential tasks, subagents (Task tool) are more token-efficient
- Enable with: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings

---

## Future: configure-ecc Integration

The `configure-ecc` install wizard could offer to set these environment variables during setup, with explanations of the cost tradeoffs. This would help new users optimize from day one rather than discovering these settings after hitting limits.

---

## Quick Reference

```bash
# Daily workflow
/model sonnet              # Start here
/model opus                # Only for complex reasoning
/clear                     # Between unrelated tasks
/compact                   # At logical breakpoints
/cost                      # Check spending

# Environment variables (add to ~/.claude/settings.json "env" block)
MAX_THINKING_TOKENS=10000
CLAUDE_CODE_SUBAGENT_MODEL=haiku
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```
