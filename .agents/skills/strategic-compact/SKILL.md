---
name: strategic-compact
description: Suggests manual context compaction at logical intervals to preserve context through task phases rather than arbitrary auto-compaction. Use when a session is approaching a context limit and a task phase is a natural place to compact.
license: MIT
---

# Strategic Compact Skill

Suggests manual compaction at useful task boundaries when the current Codex client supports it.

## When to Activate

- Running long sessions that approach the context limit shown by the client
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
- **After exploration, before execution** - Compact research context and keep the implementation plan
- **After completing a milestone** - Prepare for the next phase
- **Before major context shifts** - Save the conclusions that the next task needs

## How It Works

1. At a natural phase boundary, capture the goal, scope, decisions, active files or revision, completed checks, blockers, and next action.
2. Put the checkpoint in the task's plan file or agreed project note when it needs to survive the session. For an in-session checkpoint, summarize the same details in chat. Keep credentials and raw transcripts out of the checkpoint.
3. Use the client's manual compaction action if available. Otherwise, continue from the checkpoint or use it for a handoff.

## Compaction Decision Guide

Use this table to decide when to compact:

| Phase Transition | Compact? | Why |
|-----------------|----------|-----|
| Research → Planning | Yes | Research context is bulky; plan is the distilled output |
| Planning → Implementation | Yes | Save the plan and the first implementation step before freeing up context for code |
| Implementation → Testing | Maybe | Keep if tests reference recent code; compact if switching focus |
| Debugging → Next feature | Yes | Debug traces pollute context for unrelated work |
| Mid-implementation | No | Losing variable names, file paths, and partial state is costly |
| After a failed approach | Yes | Clear the dead-end reasoning before trying a new approach |

## What Survives Compaction

Project files and Git state remain available. Conversation details, previous tool results, and task lists may be summarized or omitted. Capture the details needed to resume in the checkpoint, then reread the relevant project files when you continue.

## Best Practices

1. **Compact after planning** - Save the agreed plan before starting implementation.
2. **Compact after debugging** - Preserve the root-cause evidence and the next action before moving on.
3. **Finish the active step first** - Complete or checkpoint an in-progress edit or operation before compacting.
4. **Resume from verified state** - Check the active workspace, unresolved work, and prior results before retrying.

## Related

- [The Longform Guide](https://x.com/affaanmustafa/status/2014040193557471352) - Token optimization section
- `continuous-learning` skill - Extracts patterns before session ends
