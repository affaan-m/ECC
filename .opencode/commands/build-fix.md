---
description: Fix build and TypeScript errors with minimal changes
agent: build-error-resolver
subtask: true
---

# Build Fix Command

Fix build and TypeScript errors with minimal changes: $ARGUMENTS

## Your Task

1. **Run type check**: `npx tsc --noEmit`
2. **Collect all errors**
3. **Fix errors one by one** with minimal changes
4. **Verify each fix** doesn't introduce new errors
5. **Run final check** to confirm all errors resolved

## Approach

### DO:
- PASS: Fix type errors with correct types
- PASS: Add missing imports
- PASS: Fix syntax errors
- PASS: Make minimal changes
- PASS: Preserve existing behavior
- PASS: Run `tsc --noEmit` after each change

### DON'T:
- FAIL: Refactor code
- FAIL: Add new features
- FAIL: Change architecture
- FAIL: Use `any` type (unless absolutely necessary)
- FAIL: Add `@ts-ignore` comments
- FAIL: Change business logic

## Common Error Fixes

| Error | Fix |
|-------|-----|
| Type 'X' is not assignable to type 'Y' | Add correct type annotation |
| Property 'X' does not exist | Add property to interface or fix property name |
| Cannot find module 'X' | Install package or fix import path |
| Argument of type 'X' is not assignable | Cast or fix function signature |
| Object is possibly 'undefined' | Add null check or optional chaining |

## Verification Steps

After fixes:
1. `npx tsc --noEmit` - should show 0 errors
2. `npm run build` - should succeed
3. `npm test` - tests should still pass

---

**IMPORTANT**: Focus on fixing errors only. No refactoring, no improvements, no architectural changes. Get the build green with minimal diff.
