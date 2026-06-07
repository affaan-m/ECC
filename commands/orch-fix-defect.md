---
description: Orchestrate fixing a bug — reproduce it as a failing regression test, fix to green, review, gated commit. Wrapper for the orch-fix-defect skill.
---

# /orch-fix-defect

Manually launch the **orch-fix-defect** orchestrator: prove the bug with a red
test, then fix to green.

## Usage

```
/orch-fix-defect <what is broken>
```

Examples:

```
/orch-fix-defect poller crashes on empty NWS response
/orch-fix-defect login returns 500 when email has a plus sign
```

## What It Does

Invoke the `orch-fix-defect` skill with `$ARGUMENTS` as the request. The skill
(via the shared `orch-pipeline` engine) will:

1. Classify size (default floor: small, often trivial); scope root cause with
   `code-explorer` if unclear.
2. **Write a new failing regression test** reproducing the bug, then fix until
   it goes green. (Proving the bug first is what makes this a fix, not a tweak.)
3. `code-reviewer` (+ `security-reviewer` if the defect sits in a sensitive path).
4. Commit as a conventional `fix:` commit. → **GATE 2** (confirm before commit).

Use this only when behavior is **broken/wrong** — not for intentional changes
(`/orch-change-feature`) or new capability (`/orch-add-feature`).

If `$ARGUMENTS` is empty, ask the user to describe the defect.
