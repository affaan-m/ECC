---
agent: agent
description: Systematically diagnose and fix build errors, type errors, or failing CI
---

# Build Error Resolution

Work through the error systematically. Fix root causes — do not suppress warnings or skip checks.

## Process

### 1. Capture the full error
Paste or describe the complete error output (not just the last line). Include:
- Error message and stack trace
- File and line number if shown
- Build tool and command that failed

### 2. Categorize the error

| Category | Signals |
|----------|---------|
| **Type error** | `Type X is not assignable to Y`, `Property does not exist` |
| **Import/module** | `Cannot find module`, `does not provide an export` |
| **Syntax** | `Unexpected token`, `Expected ;` |
| **Dependency** | `peer dep conflict`, `missing package`, `version mismatch` |
| **Environment** | `command not found`, `ENOENT`, missing env var |
| **Test failure** | `expected X but received Y`, assertion failure |
| **Lint** | `ESLint`, `no-unused-vars`, `no-console` |

### 3. Fix strategy

- **Type errors** — fix the type, do not cast to `any` or `unknown` unless truly unavoidable.
- **Import errors** — verify the export exists; check for circular dependencies.
- **Dependency errors** — update lockfile, reconcile peer dep versions, do not delete `node_modules` as a first step.
- **Test failures** — fix the implementation if behavior is wrong; fix the test only if the test itself is incorrect.
- **Lint errors** — fix the code, do not add `// eslint-disable` unless the rule is genuinely inapplicable and you document why.

### 4. Verify the fix
After applying a fix, run the build/test command again. Confirm the specific error is resolved and no new errors were introduced.

### 5. Check for related issues
A single root cause often produces multiple error messages. After fixing, scan for similar patterns elsewhere in the codebase.

## Rules
- Never use `--no-verify` to skip hooks.
- Never suppress type errors with `@ts-ignore` without a comment explaining why.
- Never delete lock files without understanding why they are conflicting.
