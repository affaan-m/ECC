---
name: orch-add-feature
description: Legacy implementation wrapper for the orch family. GitHub issue ownership should be handled by the epic layer first.
origin: ECC
---

# orch-add-feature

Actor Â· action Â· target: **orch Â· add Â· feature**. Thin wrapper over the shared
engine in [`orch-pipeline`](../orch-pipeline/SKILL.md).

## When to Use

- The user wants a capability that does **not exist yet** ("add", "build",
  "implement", "support â€¦").
- It is net-new behavior â€” not a correction (`orch-fix-defect`) and not an
  alteration of existing behavior (`orch-change-feature`).

## Operation settings

- **Default size floor:** standard â€” run Research + Plan unless clearly small.
- **Phase mask:** 0 â†’ 1 â†’ 2 â†’ 4 â†’ 5 â†’ 6 (skip 3 Scaffold; that is MVP-only).
- **First move (phase 4):** write *new* failing tests for the new behavior, then
  implement to green.

## How It Works

1. Run the `orch-pipeline` engine with the settings above.
2. Classify size first; small / trivial features collapse toward 4 â†’ 5 â†’ 6.
3. Stop at **Gate 1** (plan approval) and **Gate 2** (pre-commit).
4. Add `security-reviewer` if the feature touches a security trigger.

> Related: `/feature-dev` is a standalone version of this flow. `orch-add-feature`
> differs by sharing the `orch-pipeline` engine â€” the size classifier and the two
> gates â€” with the rest of the family, so it right-sizes trivial features to 4 â†’ 5 â†’ 6.

## Example

```
orch-add-feature: add OAuth2 login to nws-poller
â†’ research existing auth libs â†’ plan task_list  [GATE 1: approve]
â†’ TDD each task â†’ code-review (+ security-reviewer: auth path)
â†’ commit  [GATE 2: confirm]
```

