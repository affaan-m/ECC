---
description: Remove dead code and consolidate duplicates
agent: refactor-cleaner
subtask: true
---

# Refactor Clean Command

Analyze and clean up the codebase: $ARGUMENTS

## Your Task

1. **Detect dead code** using analysis tools
2. **Identify duplicates** and consolidation opportunities
3. **Safely remove** unused code with documentation
4. **Verify** no functionality broken

## Detection Phase

### Run Analysis Tools

```bash
# Find unused exports
npx knip

# Find unused dependencies
npx depcheck

# Find unused TypeScript exports
npx ts-prune
```

### Manual Checks

- Unused functions (no callers)
- Unused variables
- Unused imports
- Commented-out code
- Unreachable code
- Unused CSS classes

## Removal Phase

### Before Removing

1. **Search for usage** - grep, find references
2. **Check exports** - might be used externally
3. **Verify tests** - no test depends on it
4. **Document removal** - git commit message

### Safe Removal Order

1. Remove unused imports first
2. Remove unused private functions
3. Remove unused exported functions
4. Remove unused types/interfaces
5. Remove unused files

## Consolidation Phase

### Identify Duplicates

- Similar functions with minor differences
- Copy-pasted code blocks
- Repeated patterns

### Consolidation Strategies

1. **Extract utility function** - for repeated logic
2. **Create base class** - for similar classes
3. **Use higher-order functions** - for repeated patterns
4. **Create shared constants** - for magic values

## Verification

After cleanup:

1. `npm run build` - builds successfully
2. `npm test` - all tests pass
3. `npm run lint` - no new lint errors
4. Manual smoke test - features work

## Report Format

```
Dead Code Analysis
==================

Removed:
- file.ts: functionName (unused export)
- utils.ts: helperFunction (no callers)

Consolidated:
- formatDate() and formatDateTime() → dateUtils.format()

Remaining (manual review needed):
- oldComponent.tsx: potentially unused, verify with team
```

---

**CAUTION**: Always verify before removing. When in doubt, ask or add `// TODO: verify usage` comment.
