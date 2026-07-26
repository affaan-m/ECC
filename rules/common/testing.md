# Testing Requirements

Target 80% coverage across three levels: unit tests for functions and
components, integration tests for API endpoints and database
operations, and E2E tests for critical user flows (framework chosen
per language).

## Test-Driven Development

Prefer writing tests first: red → green → refactor, then verify
coverage. The tdd skills (`node-tdd-workflow`, `python-testing`)
and the **tdd-guide** agents enforce the full
workflow — reach for them when building features or fixing bugs.

## Test Structure

Use Arrange-Act-Assert structure and descriptive names that state the
behavior under test:

```typescript
test('returns empty array when no markets match query', () => {
  // Arrange … Act … Assert
})
```

## When Tests Fail

Fix the implementation, not the test — unless the test itself encodes
a wrong expectation. Check test isolation and mock correctness before
changing either side.
