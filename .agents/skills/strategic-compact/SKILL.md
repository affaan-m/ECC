---
name: strategic-compact
description: Suggests manual context compaction at logical intervals to preserve context through task phases rather than arbitrary auto-compaction. Use when a session is approaching a context limit and a task phase is a natural place to compact.
---

# Strategic Compact Skill

Suggests manual `/compact` at strategic points in your workflow rather than relying on arbitrary auto-compaction.

## When to Activate

- Running long sessions that approach context limits (200K+ tokens)
- Working on multi-phase tasks (research → plan → implement → test)
- Switching between unrelated tasks within the same session
- After completing a major milestone and starting new work
- When responses slow down or become less coherent (context pressure)

## Why Strategic Compaction?

Auto-compaction triggers at arbitrary points:
- Often mid-task, losing important context
- No awareness of logical task boundaries
- Can interrupt complex multi-step operations

Strategic compaction at logical boundaries:
- **After exploration, before execution** — Compact research context, keep implementation plan
- **After completing a milestone** — Fresh start for next phase
- **Before major context shifts** — Clear exploration context before different task

## How It Works

The `suggest-compact.js` script runs on PreToolUse (Edit/Write) and combines two signals:

1. **Context size (primary)** — Reads the latest `usage` record from the session transcript (`transcript_path` in the hook payload) and sums `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` (the true context size of the turn). Suggests `/compact` at a window-scaled threshold — 160k tokens on a 200k window, 250k on a 1M window (detected from a `[1m]` model marker, or inferred when observed tokens already exceed 200k) — and re-reminds after every additional 60k tokens of context growth
2. **Tool-call count (secondary)** — Counts tool invocations in session; suggests at a configurable threshold (default: 50 calls), then every 25 calls after

## Hook Setup

Add to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit",
        "hooks": [{ "type": "command", "command": "node ~/.claude/skills/strategic-compact/suggest-compact.js" }]
      },
      {
        "matcher": "Write",
        "hooks": [{ "type": "command", "command": "node ~/.claude/skills/strategic-compact/suggest-compact.js" }]
      }
    ]
  }
}
```

## Configuration

Environment variables:
- `COMPACT_THRESHOLD` — Tool calls before first suggestion (default: 50)
- `COMPACT_CONTEXT_THRESHOLD` — Context tokens before the context-size suggestion (default: 160000 on a 200k window, 250000 on a 1M window; `0` disables the context signal)
- `COMPACT_CONTEXT_INTERVAL` — Additional context tokens before the suggestion repeats (default: 60000)
- `ECC_CONTEXT_WINDOW_TOKENS` — Explicit context-window size, in tokens, overriding auto-detection. Set this for large-window models whose reported id lacks a `[1m]` marker (e.g. 400k Opus 4.x, or a new 1M-window model family) so the threshold scales to the real window instead of defaulting to 200k and overstating context usage.
- `CLAUDE_CODE_AUTO_COMPACT_WINDOW` — Claude Code's native window-size override, in tokens; honored as a fallback when `ECC_CONTEXT_WINDOW_TOKENS` is unset.

> The context window is otherwise auto-detected from a `[1m]` model marker or inferred when observed tokens already exceed 200k. On a large-window model that carries neither signal, set one of the overrides above so the `/compact` suggestion fires at the right point.

## Compaction Decision Guide

Use this table to decide when to compact:

| Phase Transition | Compact? | Why |
|-----------------|----------|-----|
| Research → Planning | Yes | Research context is bulky; plan is the distilled output |
| Planning → Implementation | Yes | Plan is written down (a file, or the task list if you have one); free up context for code |
| Implementation → Testing | Maybe | Keep if tests reference recent code; compact if switching focus |
| Debugging → Next feature | Yes | Debug traces pollute context for unrelated work |
| Mid-implementation | No | Losing variable names, file paths, and partial state is costly |
| After a failed approach | Yes | Clear the dead-end reasoning before trying a new approach |

## What Survives Compaction

Understanding what persists helps you compact with confidence:

| Persists | Lost |
|----------|------|
| CLAUDE.md instructions | Intermediate reasoning and analysis |
| Files on disk | File contents you previously read |
| Memory files (`~/.claude/memory/`) | Multi-step conversation context |
| Git state (commits, branches) | Tool call history and counts |
| The task list — **only if you have the todo tools** (see below) | Nuanced user preferences stated verbally |

> ### Don't rely on the task list surviving — it may not exist
>
> Claude Code **2.1.233 removed the todo/task tools by default** on Opus 4.8, Sonnet 5,
> Fable 5, Mythos 5 and newer models (`TodoWrite`, `TaskCreate/Get/Update/List`).
> `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` brings them back, but that is a per-machine
> environment setting — **it does not travel with this skill**, so you cannot assume the
> reader has it.
>
> This matters because "my todo list survives compaction" is a reason people compact
> *instead of* writing state down. If the tools are absent there is no list to survive,
> and the plan is simply gone. **Write the plan to a file before compacting** — a file
> persists on every version and every model. Treat the task list as a convenience that
> may be missing, never as your durable record.

## Best Practices

1. **Compact after planning** — Once the plan is finalized **and written to a file**, compact to start fresh
2. **Compact after debugging** — Clear error-resolution context before continuing
3. **Don't compact mid-implementation** — Preserve context for related changes
4. **Read the suggestion** — The hook tells you *when*, you decide *if*
5. **Write before compacting** — Save important context to files or memory before compacting
6. **Use `/compact` with a summary** — Add a custom message: `/compact Focus on implementing auth middleware next`

## Related

- [The Longform Guide](https://x.com/affaanmustafa/status/2014040193557471352) — Token optimization section
- Memory persistence hooks — For state that survives compaction
- `continuous-learning` skill — Extracts patterns before session ends
