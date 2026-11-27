---
description: "PHP testing extending common rules"
globs: ["**/*.php", "**/phpunit.xml", "**/phpunit.xml.dist", "**/composer.json"]
alwaysApply: false
---
# PHP Testing

> This file extends the common testing rule with PHP specific content.

## Framework

Use **PHPUnit** as the default test framework. **Pest** is also acceptable when the project already uses it.

## Coverage

```bash
vendor/bin/phpunit --coverage-text
# or
vendor/bin/pest --coverage
```

## Test Organization

- Separate fast unit tests from framework/database integration tests.
- Use factory/builders for fixtures instead of large hand-written arrays.
- Keep HTTP/controller tests focused on transport and validation; move business rules into service-level tests.
