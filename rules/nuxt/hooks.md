---
paths:
  - "**/nuxt.config.*"
  - "**/app.config.*"
  - "**/server/**/*.ts"
---

# Nuxt Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Nuxt specific content.

These are Claude Code harness hooks for Nuxt work. They run via the harness, not Claude.

## Typecheck

- `nuxi typecheck` wraps `vue-tsc`. Requires `vue-tsc` + `typescript` dev deps.
- Run on `.vue` / `.ts` edit or pre-commit.

## Lint

- Use the `@nuxt/eslint` module (flat-config, project-aware, generates `.nuxt/eslint.config.mjs`).
- Run `eslint .` or `eslint --fix`. This is the Nuxt-official ESLint integration, prefer it over hand-rolled configs.

## Format

- `prettier --write`, or enable stylistic rules in `@nuxt/eslint` to avoid a Prettier/ESLint conflict.
- Pick one formatting authority. Do not run both Prettier and ESLint stylistic at once.

## Suggested PostToolUse chain

- On Edit to `app/**` and `server/**`: run `eslint --fix` then `nuxi typecheck`.
- Order matters: lint-fix first (mutates the file), typecheck second (verifies the result).

## Reference

- ECC skills: `nuxt4-patterns`, `vite-patterns`.
- [@nuxt/eslint module](https://eslint.nuxt.com/)
- [nuxi typecheck](https://nuxt.com/docs/api/commands/typecheck)
