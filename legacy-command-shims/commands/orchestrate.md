---
description: Legacy slash-entry shim for dmux-workflows and autonomous-agent-harness. Prefer the skills directly.
---

# Orchestrate Command (Legacy Shim)

Use this only if you still invoke `/orchestrate`. The maintained orchestration guidance lives in `skills/dmux-workflows/SKILL.md` and `skills/autonomous-agent-harness/SKILL.md`.

## Canonical Surface

- Prefer `dmux-workflows` for parallel panes, worktrees, and multi-agent splits.
- Prefer `autonomous-agent-harness` for longer-running loops, governance, scheduling, and control-plane style execution.
- Keep this file only as a compatibility entry point.

## Arguments

`$ARGUMENTS`

## Delegation

Apply the orchestration skills instead of maintaining a second workflow spec here.
- Start with `dmux-workflows` for split/parallel execution.
- Pull in `autonomous-agent-harness` when the user is really asking for persistent loops, governance, or operator-layer behavior.
- Keep handoffs structured, but let the skills define the maintained sequencing rules.
