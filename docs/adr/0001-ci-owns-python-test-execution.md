# ADR-0001: CI Owns Python Test Execution

**Status:** Accepted

**Date:** 2026-09-08

## Context

The ECC global pre-push hook ran pytest when it found a Python project. The hook
used the ambient host environment. A project could therefore get different
results from a developer machine and CI because Python versions, dependencies,
plugins, operating systems, and test configuration were different. A full test
suite also made each push slow.

CI already provides the controlled and reviewable test boundary for each project.
Contributors still need fast feedback for tests that they add or change.

## Decision

ECC pre-commit and pre-push hooks do not run pytest. Project CI is the
authoritative automated Python test gate.

Before a contributor creates a pull request, the contributor must run every new
or changed test with the project's test command. The pull request must include
the exact commands and results.

The pre-commit hook continues to scan staged additions for high-signal secrets.
The pre-push hook can continue to run its other supported checks.

## Consequences

- A push does not run a Python test suite in an ambient local environment.
- Python test results come from the project's configured CI environment.
- Contributors get focused local feedback by running each new or changed test
  before they create a pull request.
- A project without a Python CI gate must add one. ECC does not supply a fallback
  pytest gate in its Git hooks.
- Existing installations must run `scripts/codex/install-global-git-hooks.sh` or
  the ECC Codex sync command to receive the changed hook.
