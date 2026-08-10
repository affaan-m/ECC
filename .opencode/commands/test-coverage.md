---
description: Analyze and improve test coverage
agent: tdd-guide
subtask: true
---

# Test Coverage Command

Analyze test coverage and identify gaps: $ARGUMENTS

## Your Task

1. **Run coverage report**: `npm test -- --coverage`
2. **Analyze results** - Identify low coverage areas
3. **Prioritize gaps** - Critical code first
4. **Generate missing tests** - For uncovered code

## Coverage Targets

| Code Type | Target |
|-----------|--------|
| Standard code | 80% |
| Financial logic | 100% |
| Auth/security | 100% |
| Utilities | 90% |
| UI components | 70% |

## Coverage Report Analysis

### Summary
```
File           | % Stmts | % Branch | % Funcs | % Lines
---------------|---------|----------|---------|--------
All files      |   XX    |    XX    |   XX    |   XX
```

### Low Coverage Files
[Files below target, prioritized by criticality]

### Uncovered Lines
[Specific lines that need tests]

## Test Generation

For each uncovered area:

### [Function/Component Name]

**Location**: `src/path/file.ts:123`

**Coverage Gap**: [description]

**Suggested Tests**:
```typescript
describe('functionName', () => {
  it('should [expected behavior]', () => {
    // Test code
  })

  it('should handle [edge case]', () => {
    // Edge case test
  })
})
```

## Coverage Improvement Plan

1. **Critical** (add immediately)
   - [ ] file1.ts - Auth logic
   - [ ] file2.ts - Payment handling

2. **High** (add this sprint)
   - [ ] file3.ts - Core business logic

3. **Medium** (add when touching file)
   - [ ] file4.ts - Utilities

---

**IMPORTANT**: Coverage is a metric, not a goal. Focus on meaningful tests, not just hitting numbers.
