---
description: Legacy slash-entry shim for the context-budget skill. Prefer the skill directly.
---

# Context Budget Optimizer (Legacy Shim)

Use this only if you still invoke `/context-budget`. The maintained workflow lives in `skills/context-budget/SKILL.md`.

## Canonical Surface

- Prefer the `context-budget` skill directly.
- Keep this file only as a compatibility entry point.

## Arguments

$ARGUMENTS

## Delegation

Apply the `context-budget` skill.
- Pass through `--verbose` if the user supplied it.
- Assume a 200K context window unless the user specified otherwise.
- Return the skill's inventory, issue detection, and prioritized savings report without re-implementing the scan here.
