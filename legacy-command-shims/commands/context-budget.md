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
- Without an explicit `--audit`, return the harness's native live-context command and do not scan files or call tools.
- Pass through `--audit` and `--verbose` only when the user supplied them.
- Keep any explicit audit bounded to the scope and safety rules in the canonical skill.
