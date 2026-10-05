---
description: Orchestrate a behavior-preserving refactor — confirm tests green, restructure without changing behavior, keep green, review, gated commit. Wrapper for the orch-refine-code skill.
---

# /orch-refine-code

Manually launch the **orch-refine-code** orchestrator: improve structure while
behavior stays identical, with the existing test suite as the safety net.

## Usage

```
/orch-refine-code <what to restructure>
```

Examples:

```
/orch-refine-code extract the NWS HTTP client out of poller.py
/orch-refine-code remove dead code and duplication in the dashboard module
```

## What It Does

Invoke the `orch-refine-code` skill with `$ARGUMENTS` as the request. The skill
(via the shared `orch-pipeline` engine) will:

1. Classify size (default floor: standard — restructures touch multiple files).
2. Confirm the relevant tests exist and are **green before** touching code; add
   characterization tests first if coverage is thin. Plan the restructure. → **GATE 1**.
3. Restructure in small steps, re-running tests after each (no new behavior
   tests — the existing suite proves behavior is unchanged). Dead-code/dup sweeps
   delegate to `refactor-cleaner`.
4. `code-reviewer`, then commit as `refactor:` (the diff must be behavior-neutral). → **GATE 2**.

Use this only when behavior must **not** change. If behavior should change at
all, use `/orch-change-feature` or `/orch-fix-defect`.

If `$ARGUMENTS` is empty, ask the user what to refine.
