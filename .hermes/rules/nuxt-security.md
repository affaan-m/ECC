---
paths:
  - "**/nuxt.config.*"
  - "**/app.config.*"
  - "**/server/**/*.ts"
---

# Nuxt Security

> This file extends [common/security.md](../common/security.md) with Nuxt specific content.

## runtimeConfig public vs private

- Root `runtimeConfig` keys are server-only. `runtimeConfig.public` serializes into EVERY page payload (client-visible).
- Secrets go at root only. Never put secrets in `app.config.ts` or `runtimeConfig.public`, both ship to the client bundle.
- Official warning: "Be careful not to expose runtime config keys to the client-side by either rendering them or passing them to `useState`."

## Server-route input validation

- Use h3 validating readers. Do NOT trust raw `readBody` / `getQuery` / `getRouterParam`.
  - `readValidatedBody(event, schema)` validates the body.
  - `getValidatedQuery(event, schema)` validates the query.
  - `getValidatedRouterParams(event, schema)` validates route params.
- All accept a validation function or a Zod schema and throw on failure.

## SSR payload leakage

- Anything in `useState`, `useFetch` / `useAsyncData` results, or `runtimeConfig.public` is serialized into the client payload. Never write a secret into those.
- Use `useServerSeoMeta` for server-only meta with no client cost.

## Cookie and auth passthrough on SSR

- Nuxt does NOT auto-attach the incoming user's cookies to outbound server-side `$fetch`.
- Forward explicitly with `useRequestFetch()` (cleanest, pre-bound to request headers) or `useRequestHeaders(['cookie'])`.
- Relay a backend `Set-Cookie` to the browser via `$fetch.raw` + `appendResponseHeader(event, 'set-cookie', ...)`.
- socket.io is client-only (`.client.ts` plugin), never SSR.

## SSRF on server $fetch

- Server routes run with full network egress. Never pass user-controlled input directly into a server-side `$fetch` URL or host.
- Validate the param first (h3 utilities above), allowlist the target, pin to `runtimeConfig.public.apiBase`, reject user-supplied absolute URLs.
- Auto-trigger `/security-review` only for routes that make external network requests (server `$fetch`), handle auth tokens or credentials, or perform sensitive mutations or authorization checks. Examples: SSRF-prone proxy endpoints, token exchange or password reset, admin actions. Skip benign read-only routes that only accept validated query params.

## Reference

- ECC skills: `security-review`, `nuxt4-patterns`.
- [Nuxt runtime config](https://nuxt.com/docs/guide/going-further/runtime-config)
- [h3 request utils](https://v1.h3.dev/utils/request)
