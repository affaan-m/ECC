---
description: Orchestrate building a brand-new feature end to end — research, plan, TDD, review, gated commit. Wrapper that kicks off the orch-add-feature skill.
---

# /orch-add-feature

Manually launch the **orch-add-feature** orchestrator: a gated
Research → Plan → TDD → Review → Commit pipeline for net-new capability.

## Usage

```
/orch-add-feature <what to add>
```

Examples:

```
/orch-add-feature add OAuth2 login to nws-poller
/orch-add-feature support CSV export in the dashboard
```

## What It Does

Invoke the `orch-add-feature` skill with `$ARGUMENTS` as the request. The skill
(via the shared `orch-pipeline` engine) will:

1. Classify size and state the tier in one line.
2. Research existing libraries/patterns, then plan a `task_list`. → **GATE 1** (approve plan).
3. TDD each task (new failing tests → green), then `code-reviewer`
   (+ `security-reviewer` if a security trigger is touched).
4. Commit as conventional `feat:` commits. → **GATE 2** (confirm before commit).

Honor both gates — do not write implementation before Gate 1, do not commit before Gate 2.

If `$ARGUMENTS` is empty, ask the user what capability to add.
