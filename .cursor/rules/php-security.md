---
description: "PHP security extending common rules"
globs: ["**/*.php", "**/composer.lock", "**/composer.json"]
alwaysApply: false
---
# PHP Security

> This file extends the common security rule with PHP specific content.

## Database Safety

- Use prepared statements (`PDO`, Doctrine, Eloquent query builder) for all dynamic queries.
- Scope ORM mass-assignment carefully and whitelist writable fields.

## Secrets and Dependencies

- Load secrets from environment variables or a secret manager, never from committed config files.
- Run `composer audit` in CI and review package trust before adding dependencies.

## Auth and Session Safety

- Use `password_hash()` / `password_verify()` for password storage.
- Regenerate session identifiers after authentication and privilege changes.
- Enforce CSRF protection on state-changing web requests.
