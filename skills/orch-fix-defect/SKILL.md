---
name: orch-fix-defect
description: Legacy implementation wrapper for the orch family. GitHub issue ownership should be handled by the epic layer first.
origin: ECC
---

# orch-fix-defect

Actor Â· action Â· target: **orch Â· fix Â· defect**. Thin wrapper over the shared
engine in [`orch-pipeline`](../orch-pipeline/SKILL.md).

## When to Use

- Something is **broken**: wrong output, an error, a crash, a regression.
- Distinguish from siblings:
  - behavior is correct but you want it different â†’ `orch-change-feature`.
  - the capability does not exist yet â†’ `orch-add-feature`.

## Operation settings

- **Default size floor:** small (often trivial).
- **Phase mask:** 0 â†’ (light 2 only if root cause is non-obvious or standard+) â†’
  4 â†’ 5 â†’ 6. Research (1) is usually skipped.
- **First move (phase 4):** reproduce the bug as a **new failing** test
  (regression test), then fix until it goes green. Proving the bug exists first
  is what separates a fix from a tweak.

## How It Works

1. Run the `orch-pipeline` engine with the settings above.
2. If the root cause is unclear, scope it with `code-explorer` before the red
   test; escalate build breaks to `build-error-resolver` / `/build-fix`.
3. Stop at **Gate 1** (only if a plan was produced) and **Gate 2** (pre-commit).
4. Add `security-reviewer` if the defect sits in a security-sensitive path.

## Example

```
orch-fix-defect: poller crashes on empty NWS response
â†’ write failing test reproducing the crash â†’ fix to green
â†’ code-review â†’ commit  [GATE 2: confirm]   (commit: fix:)
```

