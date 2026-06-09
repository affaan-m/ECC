---
name: orch-refine-code
description: Legacy implementation wrapper for the orch family. GitHub issue ownership should be handled by the epic layer first.
origin: ECC
---

# orch-refine-code

Actor Â· action Â· target: **orch Â· refine Â· code**. Thin wrapper over the shared
engine in [`orch-pipeline`](../orch-pipeline/SKILL.md).

## When to Use

- Same behavior, **better structure**: extract modules, remove duplication, kill
  dead code, reduce nesting, rename for clarity.
- Distinguish from siblings: if behavior is meant to change at all, this is the
  wrong skill (`orch-change-feature` / `orch-fix-defect`).

## Operation settings

- **Default size floor:** standard â€” restructures touch multiple files.
- **Phase mask:** 0 â†’ 2 (plan the restructure) â†’ 4 (keep green) â†’ 5 â†’ 6. No new
  behavior tests are written â€” the existing suite is the safety net.
- **First move (phase 4):** confirm the relevant tests exist and are **green
  before** touching code; if coverage is thin, add characterization tests first.
  Then restructure in small steps, re-running tests after each.

## How It Works

1. Run the `orch-pipeline` engine with the settings above.
2. For dead-code / duplication sweeps, delegate to the `refactor-cleaner` agent
   (it runs knip / depcheck / ts-prune and removes safely).
3. Stop at **Gate 1** (restructure plan) and **Gate 2** (pre-commit).
4. Commit as `refactor:` â€” the diff must be behavior-neutral.

## Example

```
orch-refine-code: extract the NWS HTTP client out of poller.py
â†’ confirm tests green â†’ plan extraction  [GATE 1: approve]
â†’ move in small steps, tests green throughout â†’ code-review
â†’ commit refactor:  [GATE 2: confirm]
```

