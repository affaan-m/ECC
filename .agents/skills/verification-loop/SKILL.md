---
name: verification-loop
description: Verify coding changes with project-pinned build, type, lint, test, security, and diff checks before handoff or a PR.
license: MIT
---

# Verification Loop Skill

Verify the completed work with the project's local checks.

## When to Activate

Invoke this skill:
- After completing a feature or significant code change
- Before creating a PR
- When you want to ensure quality gates pass
- After refactoring

## Verification Phases

Review the repository's check definitions and use its installed, pinned toolchain. Select commands for the affected project and use the host's native shell. Review changed or unfamiliar scripts before running them. If a required command is missing, report the prerequisite and use the repository's pinned setup only when installation is in scope.

### Phase 1: Build Verification

Run the configured build for the affected package, such as `npm run build` or `pnpm build` when the corresponding script is present. Check its actual exit status before summarizing its output. Stop dependent checks when build fails and report the cause or fix it within the task scope.

### Phase 2: Type Check

Run the repository's configured type-check command, such as `npm run typecheck` when defined. A known, already installed local type checker can be used for the affected modules. Report type errors without downloading a floating tool as a fallback.

### Phase 3: Lint Check

Run the configured lint target, such as `npm run lint` or a pinned, installed `ruff` for Python. Report the exit status, relevant diagnostics, and any warnings. Summarize or truncate logs only after saving the status of the original command.

### Phase 4: Test Suite

Run the relevant local test suites and use the project's coverage command and threshold when applicable. Record executed, passed, failed, and skipped tests and measured coverage. Identify checks that were blocked, cached, or found no tests.

### Phase 5: Security Scan

Review files in scope for exposed credentials, unsafe logging, and permission changes. Run the project's configured local scanner in redacted or summary mode and interpret its exit codes according to its documented contract and configuration. For example, Gitleaks defaults to exit status 1 for a leak or an error.

For a lightweight working-tree check, use `git grep --untracked --exclude-standard --files-with-matches` with the project's reviewed patterns and pass explicit in-scope paths after `--`. This includes new, non-ignored files. Use the configured local scanner in redacted or summary mode for ignored files explicitly in scope.

Separately, use `git grep --cached --files-with-matches` with the same patterns and paths to check what is staged in the index.

For `git grep`, exit status 0 indicates matches, 1 indicates no matches, and a status greater than 1 indicates a check error.

Report findings by rule, count, and applicable file location. Keep raw matches and private logs out of the report, tool output, PRs, and external services. Use synthetic examples to explain findings.

### Phase 6: Diff Review

Check the diff against the intended base, including staged or unstaged changes in scope. Review unintended changes, missing error handling, and edge cases.

## Target Acceptance

When the requested outcome requires deployment or target-environment verification,
report target acceptance separately from local checks. Record the environment and
installed version when known, the evidence, and the next permitted check or precise
access dependency. Passing local checks, review, merge, or release does not establish
target acceptance. Report VERIFIED or FAILED for an executed target check, with its evidence.
Do not access production or make external changes without authorization. For
local-only tasks, mark target acceptance as not applicable.

For example: local checks PASS; staging verification NOT PERFORMED (no access);
next step: an authorized maintainer runs the staging smoke test.

## Output Format

After running all phases, produce a verification report:

```
VERIFICATION REPORT
==================

Build:     [PASS/FAIL]
Types:     [PASS/FAIL] (X errors)
Lint:      [PASS/FAIL] (X warnings)
Tests:     [PASS/FAIL] (X/Y passed, Z% coverage)
Security:  [PASS/FAIL] (X issues)
Diff:      [X files changed]

Overall:   [READY/NOT READY] for PR
Target:    [VERIFIED/FAILED/NOT PERFORMED/NOT APPLICABLE] (environment/version, evidence)
Next permitted step: [check or access dependency; none if complete/not applicable]

Issues to Fix:
1. ...
2. ...
```

## Continuous Mode

For long sessions, run verification every 15 minutes or after major changes:

```markdown
Set a mental checkpoint:
- After completing each function
- After finishing a component
- Before moving to next task

Use the verification-loop skill, or /verify where the host provides that command.
```

## Integration with Hooks

This skill complements PostToolUse hooks but provides deeper verification.
Hooks catch issues immediately; this skill provides comprehensive review.
