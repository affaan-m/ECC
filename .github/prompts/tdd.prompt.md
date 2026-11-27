---
agent: agent
description: Test-driven development cycle — write the test first, then implement
---

# TDD Workflow

Follow the RED → GREEN → IMPROVE cycle strictly. Do not write implementation code before a failing test exists.

## Cycle

### 1. RED — Write the failing test
- Write a test that describes the desired behavior.
- Run it. It **must fail** before continuing.
- Use Arrange-Act-Assert structure.
- Name tests descriptively: `returns empty array when no items match filter`, not `test itemFilter`.

### 2. GREEN — Minimal implementation
- Write the **minimum** code needed to make the test pass.
- Do not over-engineer at this stage.
- Run the test again — it **must pass**.

### 3. IMPROVE — Refactor
- Clean up duplication, naming, structure.
- Keep all tests passing after each change.
- Check coverage: target **≥ 80%**.

## Test Layer Checklist

- [ ] **Unit** — pure functions, utilities, isolated components
- [ ] **Integration** — API endpoints, database operations, service boundaries
- [ ] **E2E** — at least one critical user flow covered

## Quality Gates

Before marking the feature done:
- [ ] All tests pass
- [ ] Coverage ≥ 80%
- [ ] No skipped/commented-out tests
- [ ] Edge cases covered: empty input, nulls, boundary values, error paths

## Anti-patterns to Avoid

- Writing implementation before tests
- Testing implementation details instead of behavior
- Mocking too deeply (prefer integration tests over excessive mocks)
- Assertions that always pass (`expect(true).toBe(true)`)
