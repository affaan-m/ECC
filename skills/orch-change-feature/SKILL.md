---
name: orch-change-feature
description: Legacy implementation wrapper for the orch family. GitHub issue ownership should be handled by the epic layer first.
origin: ECC
---

# orch-change-feature

Actor Â· action Â· target: **orch Â· change Â· feature**. Thin wrapper over the
shared engine in [`orch-pipeline`](../orch-pipeline/SKILL.md).

## When to Use

- An existing feature **works**, but the desired behavior is different ("change",
  "adjust", "make it also â€¦", "instead of X do Y").
- Distinguish from siblings:
  - **not** broken â†’ not `orch-fix-defect` (no bug to reproduce).
  - **not** new â†’ not `orch-add-feature` (the capability already exists).

## Operation settings

- **Default size floor:** small â€” most tweaks are a function or two.
- **Phase mask:** 0 â†’ (1 only if the new behavior needs research) â†’ light 2 â†’
  4 â†’ 5 â†’ 6.
- **First move (phase 4):** update the *existing* tests to express the new
  desired behavior, then change the implementation until they pass. Changing the
  tests first is what separates a tweak from a fix.

## How It Works

1. Run the `orch-pipeline` engine with the settings above.
2. Keep the plan light â€” only `standard`+ size warrants the full `planner` pass.
3. Stop at **Gate 1** (plan / changed-test approval) and **Gate 2** (pre-commit).
4. Add `security-reviewer` if the change touches a security trigger.

## Example

```
orch-change-feature: make nws-poller alert at 2 warnings instead of 3
â†’ update threshold tests to new spec â†’ change impl to green
â†’ code-review â†’ commit  [GATE 2: confirm]
```

