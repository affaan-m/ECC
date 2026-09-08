---
description: Run the changed module and every required downstream acceptance command from the regression ledger. Exit codes are the final delivery gate. Use init to draft a ledger from reproducible repository evidence.
argument-hint: "[init | module name | blank = locate from git changes]"
---

Invoke **regression-auditor** for the project in the current working directory. The single methodology source is `skills/module-regression/SKILL.md`.

User input: `$ARGUMENTS`

## Modes

### 1. `/regression-audit`

Use a caller-supplied change list to locate affected modules and resolve downstream consumers from the ledger. Return a bounded command plan first. After explicit user approval, the host may inspect Git state and execute the approved commands through its trusted command runner, then return observed exit codes to the auditor. Any failure blocks delivery.

### 2. `/regression-audit <module>`

Skip automatic path mapping and audit the named module plus downstream consumers.

### 3. `/regression-audit init`

When no regression ledger exists:

- Prefer the repository's existing dependency graph or build tooling. Otherwise choose a reproducible command suitable for the current language, aggregate edges by module, and record both the command and any unverified edges. Do not claim one universal scanner handles every ecosystem.
- Find acceptance-command candidates from existing tests and reconciliation scripts. Mark uncertain candidates `needs confirmation`; mark modules with no candidate `MISSING`.
- Ask the user to confirm module commands and link the ledger from the project's instruction/map artifact.
- Adapt `skills/module-regression/templates/REGRESSION.example.md` to the repository's existing layout.

## Requirements

1. If the ledger is missing and the mode is not `init`, stop and recommend initialization. Do not infer dependencies ad hoc.
2. The auditor plans and reports but never executes repository-provided commands or fixes code. The host executes only an explicitly approved plan within bounded workspace, time, input, environment, and network permissions. After a failure, the main change author fixes it and reruns this command until green.
3. After an all-green run, mention that a durable project may append one short history event.
4. Report a table containing module, command, exit code, and verdict. Never claim completion for commands that did not run.
