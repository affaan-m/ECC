---
paths:
  - "**/*.php"
  - "**/phpunit.xml"
  - "**/phpunit.xml.dist"
  - "**/composer.json"
---
# PHP Testing

> This file extends [common/testing.md](../common/testing.md) with PHP specific content.

## Framework

Use **PHPUnit** as the default test framework. If **Pest** is configured in the project, prefer Pest for new tests and avoid mixing frameworks.

## Coverage

```bash
vendor/bin/phpunit --coverage-text
# or
vendor/bin/pest --coverage
```

Prefer **pcov** or **Xdebug** in CI, and keep coverage thresholds in CI rather than as tribal knowledge.

## Test Organization

- Separate fast unit tests from framework/database integration tests.
- Use factory/builders for fixtures instead of large hand-written arrays.
- Keep HTTP/controller tests focused on transport and validation; move business rules into service-level tests.

## Inertia

If the project uses Inertia.js, prefer `assertInertia` with `AssertableInertia` to verify component names and props instead of raw JSON assertions.

## Reference

See skill: `tdd-workflow` for the repo-wide RED -> GREEN -> REFACTOR loop.
See skill: `laravel-tdd` for Laravel-specific testing patterns (PHPUnit and Pest).
