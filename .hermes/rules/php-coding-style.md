---
paths:
  - "**/*.php"
  - "**/composer.json"
---
# PHP Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with PHP specific content.

## Standards

- Follow **PSR-12** formatting and naming conventions.
- Prefer `declare(strict_types=1);` in application code.
- Use scalar type hints, return types, and typed properties everywhere new code permits.

## Immutability

- Prefer immutable DTOs and value objects for data crossing service boundaries.
- Use `readonly` properties or immutable constructors for request/response payloads where possible.
- Keep arrays for simple maps; promote business-critical structures into explicit classes.

## Formatting

- Use **PHP-CS-Fixer** or **Laravel Pint** for formatting.
- Use **PHPStan** or **Psalm** for static analysis.
- Keep Composer scripts checked in so the same commands run locally and in CI.

## Imports

- Add `use` statements for all referenced classes, interfaces, and traits.
- Avoid relying on the global namespace unless the project explicitly prefers fully qualified names.

## Error Handling

- Throw exceptions for exceptional states; avoid returning `false`/`null` as hidden error channels in new code.
- Convert framework/request input into validated DTOs before it reaches domain logic.

## Reference

See skill: `backend-patterns` for broader service/repository layering guidance.
