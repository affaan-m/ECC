---
inclusion: fileMatch
fileMatchPattern: "*.php"
description: PHP-specific patterns, Laravel, and modern PHP best practices.
---

# PHP Patterns

> This file extends the common patterns with PHP specific content.

## Standards

- Follow **PSR-12** formatting and naming conventions
- Prefer `declare(strict_types=1);` in application code
- Use scalar type hints, return types, and typed properties everywhere

## Immutability

- Prefer immutable DTOs and value objects for data crossing service boundaries
- Use `readonly` properties or immutable constructors for request/response payloads

## Thin Controllers, Explicit Services

- Keep controllers focused on transport: auth, validation, serialization, status codes
- Move business rules into application/domain services testable without HTTP bootstrapping

## Dependency Injection

- Depend on interfaces or narrow service contracts, not framework globals
- Pass collaborators through constructors so services are testable without service-locator lookups

## DTOs and Value Objects

- Replace shape-heavy associative arrays with DTOs for requests, commands, and API payloads
- Use value objects for money, identifiers, date ranges, and constrained concepts

## Security

- Validate request input at the framework boundary (`FormRequest`, Symfony Validator)
- Use prepared statements (PDO, Eloquent query builder) for all dynamic queries
- Load secrets from environment variables, never from committed config files
- Use `password_hash()` / `password_verify()` for password storage
- Enforce CSRF protection on state-changing web requests
- Run `composer audit` in CI

## Formatting & Analysis

```bash
# PHP-CS-Fixer or Laravel Pint for formatting
# PHPStan or Psalm for static analysis
vendor/bin/phpstan analyse
```

## Testing

- Use **PHPUnit** as default; prefer **Pest** if configured in the project
- Separate fast unit tests from framework/database integration tests
- Use factory/builders for fixtures instead of large hand-written arrays

```bash
vendor/bin/phpunit --coverage-text
```

## Reference

See skills: `laravel-patterns`, `laravel-security`, `laravel-tdd` for Laravel-specific guidance.
See skill: `api-design` for endpoint conventions and response-shape guidance.
