---
agent: agent
description: Clean up dead code, reduce duplication, and simplify structure without changing behavior
---

# Refactor & Cleanup

Improve the internal structure of the selected code without changing its observable behavior. All tests must pass before and after.

## Before Starting
- [ ] Confirm the test suite is passing.
- [ ] Note the current coverage baseline.
- [ ] Identify the scope: single function, file, or module?

## Refactoring Targets

### Dead Code Removal
- Unused variables, imports, functions, and exports
- Commented-out code blocks (delete, don't leave as comments)
- Feature flags that are permanently enabled/disabled
- Unreachable branches

### Duplication Reduction
- Repeated logic that can be extracted into a shared utility
- Copy-pasted blocks differing only in a parameter (extract with that parameter)
- Inline constants that appear in multiple places (extract to named constants)

### Structure Improvements
- Functions over 50 lines → break into smaller, named steps
- Files over 800 lines → extract cohesive sub-modules
- Nesting deeper than 4 levels → extract early-return guards or helper functions
- Mixed concerns in one function → split into focused single-responsibility functions

### Naming
- Rename variables/functions whose names don't match their behavior
- Replace magic numbers and strings with named constants
- Align naming with the domain language used elsewhere in the codebase

## Constraints
- **No behavior changes** — refactoring is purely structural.
- **One concern at a time** — do not mix refactoring with feature work or bug fixes.
- **Keep tests green** — run the suite after each meaningful change.
- **Don't add abstractions preemptively** — extract only what has already proven to be duplicated (rule of three).

## Output
After refactoring, summarize:
- What was removed (dead code, duplication)
- What was extracted (new utilities, constants)
- What was renamed and why
- Coverage before / after (should not decrease)
