---
description: Legacy slash-entry shim for the agent-sort skill. Prefer the skill directly.
---

# Agent Sort (Legacy Shim)

Use this only if you still invoke `/agent-sort`. The maintained workflow lives in `skills/agent-sort/SKILL.md`.

## Canonical Surface

- Prefer the `agent-sort` skill directly.
- Keep this file only as a compatibility entry point.

## Arguments

`$ARGUMENTS`

## Delegation

Apply the `agent-sort` skill.
- Classify ECC surfaces with concrete repo evidence.
- Keep the result to DAILY vs LIBRARY.
- If an install change is needed afterward, hand off to `configure-ecc` instead of re-implementing install logic here.
