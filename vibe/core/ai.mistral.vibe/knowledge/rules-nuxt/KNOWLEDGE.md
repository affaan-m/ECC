---
name: rules-nuxt
description: ECC nuxt engineering rules for coding style, patterns, security, and testing.
display_name: "ECC Nuxt Rules"
icon: book
---

# ECC Nuxt Rules

## Nuxt Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with Nuxt specific content.

### Directory layout

- Default `srcDir` is `app/`. Framework files live at `app/pages/`, `app/layouts/`, `app/middleware/`, `app/plugins/`, `app/app.config.ts`. `nuxt.config.ts` and `server/` stay at project root.
- Some projects override `srcDir` to `src/` for a Feature-Sliced Design layout, remapping `dir.pages` (for example to `src/app/routes`), `dir.layouts`, and the `@`/`~` aliases. Always check `nuxt.config.ts` before assuming a path.

### Auto-imports discipline

- Composables in `app/composables/` and `server/utils/` auto-import. Do NOT manually import Nuxt composables (`useFetch`, `useState`, `navigateTo`) or `defineStore` / `storeToRefs`.
- Do NOT add a standalone `vue-router` dep (Nuxt bundles v5) or hand-mount `createApp` / `createPinia` / `createRouter`. The framework wires these.

### Compiler macros

- `definePageMeta` is a compile-time macro. Static values only, no reactive data and no side-effect calls inside it.
- Augment typed `PageMeta` via `declare module '#app'` rather than casting.

### Config file separation

Three distinct files, do not conflate.

- `nuxt.config.ts` = build-time only (`routeRules`, `modules`, `nitro`, `ssr` flag). Not reactive.
- `runtimeConfig` (inside nuxt.config) = per-env runtime values, env-overridable via `NUXT_*`. Root keys are server-only, `public` keys are client-visible.
- `app/app.config.ts` = public build-fixed reactive settings (theme tokens, feature flags). No env override. NEVER secrets.

### Head and meta

- `app.head` in `nuxt.config.ts` takes static values only.
- Reactive meta goes through `useHead` / `useSeoMeta` in component setup, never via `app.head`.

### Reference

- ECC skills: `nuxt4-patterns`, `vite-patterns`, `frontend-patterns`.
- [Nuxt directory structure](https://nuxt.com/docs/guide/directory-structure/app)
- [Nuxt configuration](https://nuxt.com/docs/api/nuxt-config)

## Nuxt Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Nuxt specific content.

These are Claude Code harness hooks for Nuxt work. They run via the harness, not Claude.

### Typecheck

- `nuxi typecheck` wraps `vue-tsc`. Requires `vue-tsc` + `typescript` dev deps.
- Run on `.vue` / `.ts` edit or pre-commit. Typecheck is project-wide, so debounce it and wrap it in a timeout (mirror `web/hooks.md`, for example `timeout 60 nuxi typecheck`) so a hung type-check is reaped instead of accumulating across fast edits.

### Lint

- Use the `@nuxt/eslint` module (flat-config, project-aware, generates `.nuxt/eslint.config.mjs`).
- Run `eslint .` or `eslint --fix`. This is the Nuxt-official ESLint integration, prefer it over hand-rolled configs.

### Format

- `prettier --write`, or enable stylistic rules in `@nuxt/eslint` to avoid a Prettier/ESLint conflict.
- Pick one formatting authority. Do not run both Prettier and ESLint stylistic at once.

### Suggested PostToolUse chain

- On Edit to `app/**` and `server/**`: run `eslint --fix` then `timeout 60 nuxi typecheck`.
- Order matters: lint-fix first (mutates the file), the timed typecheck second (verifies the result). Debouncing still applies.

### Reference

- ECC skills: `nuxt4-patterns`, `vite-patterns`.
- [@nuxt/eslint module](https://eslint.nuxt.com/)
- [nuxi typecheck](https://nuxt.com/docs/api/commands/typecheck)

## Nuxt Patterns

> This file extends [common/patterns.md](../common/patterns.md) with Nuxt specific content.

### Data-fetch selection

Load-bearing. Pick by render timing, not habit.

- `useFetch(url)` = SSR-safe, URL-first initial/first-paint data. The default. Forwards the server result through the payload so there is no hydration double-fetch.
- `useAsyncData(key, fn)` = SSR-safe, custom async logic (SDK / GraphQL / combined calls). The explicit key shares the result across components.
- `$fetch` = client interactions only (form submit, button click, POST/PUT/DELETE). NOT SSR-safe, double-fetches if used for first paint.
- Rule: `useFetch` / `useAsyncData` for anything rendered on first paint, `$fetch` only for event-driven mutations.

### Shared state

- `useState('key', () => init)` for SSR-safe shared state. Values must be JSON-serializable.
- NEVER `export const x = ref()` at module scope. One shared instance leaks across concurrent SSR requests and causes a memory leak.
- With `@pinia/nuxt`: Pinia for domain state, `useState` for small cross-component primitives.
- Async server-side init goes in `callOnce(async () => {...})`, not as a side effect inside `useAsyncData`.

### Nitro server routes

- `server/api/*.{get,post}.ts` auto-register by path + method. Handler is `defineEventHandler((event) => ...)`.
- Errors via `throw createError({ status, statusText })`. Prefer the Web-API `status` / `statusText` over deprecated `statusCode` / `statusMessage`.
- `server/middleware/` must NOT return a response. Only mutate `event.context` or set headers.

### Route middleware

- `app/middleware/*.ts` with `defineNuxtRouteMiddleware((to, from) => ...)`.
- Use the `to` / `from` args. Do NOT call `useRoute()` inside middleware.
- `.global` suffix runs on every route. Return `navigateTo()` to redirect, `abortNavigation()` to stop.

### Hydration-safe rendering

- Route off `status` (`idle | pending | success | error`) for lazy fetches.
- `useAsyncData` payload uses `devalue` (Date/Map/Set/refs survive). A `server/api` response is `JSON.stringify`-only, so define `toJSON()` for non-JSON types.
- Shrink payload with `pick` / `transform`. This reduces serialized size, it does not skip the fetch.

### Reference

- ECC skills: `nuxt4-patterns`, `vite-patterns`, `frontend-patterns`.
- [Nuxt data fetching](https://nuxt.com/docs/getting-started/data-fetching)
- [Nuxt state management](https://nuxt.com/docs/getting-started/state-management)
- [Nuxt server engine (Nitro)](https://nuxt.com/docs/guide/directory-structure/server)

## Nuxt Security

> This file extends [common/security.md](../common/security.md) with Nuxt specific content.

### runtimeConfig public vs private

- Root `runtimeConfig` keys are server-only. `runtimeConfig.public` serializes into EVERY page payload (client-visible).
- Secrets go at root only. Never put secrets in `app.config.ts` or `runtimeConfig.public`, both ship to the client bundle.
- Official warning: "Be careful not to expose runtime config keys to the client-side by either rendering them or passing them to `useState`."

### Server-route input validation

- Use h3 validating readers. Do NOT trust raw `readBody` / `getQuery` / `getRouterParam`.
  - `readValidatedBody(event, schema)` validates the body.
  - `getValidatedQuery(event, schema)` validates the query.
  - `getValidatedRouterParams(event, schema)` validates route params.
- All accept a validation function or a Zod schema and throw on failure.

### SSR payload leakage

- Anything in `useState`, `useFetch` / `useAsyncData` results, or `runtimeConfig.public` is serialized into the client payload. Never write a secret into those.
- Use `useServerSeoMeta` for server-only meta with no client cost.

### Cookie and auth passthrough on SSR

- Nuxt does NOT auto-attach the incoming user's cookies to outbound server-side `$fetch`.
- Forward explicitly with `useRequestFetch()` (cleanest, pre-bound to request headers) or `useRequestHeaders(['cookie'])`.
- Relay a backend `Set-Cookie` to the browser via `$fetch.raw` + `appendResponseHeader(event, 'set-cookie', ...)`.
- socket.io is client-only (`.client.ts` plugin), never SSR.

### SSRF on server $fetch

- Server routes run with full network egress. Never pass user-controlled input directly into a server-side `$fetch` URL or host.
- Validate the param first (h3 utilities above), allowlist the target, pin to `runtimeConfig.public.apiBase`, reject user-supplied absolute URLs.
- Auto-trigger `/security-review` only for routes that make external network requests (server `$fetch`), handle auth tokens or credentials, or perform sensitive mutations or authorization checks. Examples: SSRF-prone proxy endpoints, token exchange or password reset, admin actions. Skip benign read-only routes that only accept validated query params.

### Reference

- ECC skills: `security-review`, `nuxt4-patterns`.
- [Nuxt runtime config](https://nuxt.com/docs/guide/going-further/runtime-config)
- [h3 request utils](https://v1.h3.dev/utils/request)

## Nuxt Testing

> This file extends [common/testing.md](../common/testing.md) with Nuxt specific content.

Package: `@nuxt/test-utils`. Vitest-first for unit and component tests, with built-in Playwright browser E2E support. nuxt-vitest and vitest-environment-nuxt are superseded and folded into it.

### Setup

- Install dev deps: `@nuxt/test-utils vitest @vue/test-utils happy-dom playwright-core`.
- Config: `defineVitestConfig({ test: { environment: 'nuxt' } })` from `@nuxt/test-utils/config`. Use `defineVitestProject` for multi-project (separate unit / nuxt / e2e environments).
- Add `@nuxt/test-utils/module` to `nuxt.config`. Per-file opt-in via `// @vitest-environment nuxt`.

### Runtime helpers

Import from `@nuxt/test-utils/runtime`.

- `mountSuspended(component, opts)` mounts in the Nuxt env with async setup + plugin injection (accepts `@vue/test-utils` mount options + `route`).
- `renderSuspended(component, opts)` is the Testing Library variant (needs `@testing-library/vue`).
- `mockNuxtImport(name, factory)` mocks auto-imports (e.g. `useState`). Once per import per file, use `vi.hoisted()`.
- `mockComponent(name, factory)` mocks by PascalCase name or path.
- `registerEndpoint(path, handler|opts)` mocks a Nitro endpoint to test server routes or stub the backend. Supports method + `once`.

### E2E helpers

Import from `@nuxt/test-utils/e2e`.

- `await setup({ rootDir, server, browser, ... })` inside the describe block (manages beforeAll/afterAll).
- Then `$fetch(url)` (rendered HTML), `fetch(url)` (response object), `url(path)` (full URL with port), `createPage(url)` (Playwright).
- Playwright integration: import `expect` / `test` from `@nuxt/test-utils/playwright`.

### What to test how

- Composables: mock auto-imports with `mockNuxtImport`, mount a host component via `mountSuspended` to exercise `useState` / `useFetch` in the Nuxt runtime.
- Server routes: `registerEndpoint` to stub, or e2e `$fetch` / `fetch` against the real Nitro server.

### Reference

- ECC skills: `nuxt4-patterns`, `e2e-testing`, `vite-patterns`.
- [Nuxt testing docs](https://nuxt.com/docs/getting-started/testing)
- [@nuxt/test-utils npm](https://www.npmjs.com/package/@nuxt/test-utils)
