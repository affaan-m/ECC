---
description: Legacy slash-entry shim for the eval-harness skill. Prefer the skill directly.
---

# Eval Command (Legacy Shim)

Use this only if you still invoke `/eval`. The maintained workflow lives in `skills/eval-harness/SKILL.md`.

## Canonical Surface

- Prefer the `eval-harness` skill directly.
- Keep this file only as a compatibility entry point.

## Arguments

`$ARGUMENTS`

## Delegation

Apply the `eval-harness` skill.
- Support the same user intents as before: define, check, report, list, and cleanup.
- Keep evals capability-first, regression-backed, and evidence-based.
- Use the skill as the canonical evaluator instead of maintaining a separate command-specific playbook.
