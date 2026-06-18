---
description: Comprehensive Nuxt 4 review for SSR data fetching, Nitro server routes, runtimeConfig exposure, route rules, middleware, hydration safety, and Nuxt-aware tests. Invokes the nuxt-reviewer agent with Vue and TypeScript companion reviewers as needed.
---

# Nuxt Code Review

This command invokes the **nuxt-reviewer** agent for Nuxt-specific code review. For pull requests touching `.vue`, `.ts`, or `.js` files in a Nuxt app, run `nuxt-reviewer` with `vue-reviewer` and `typescript-reviewer` as companion reviewers so each agent owns a distinct lane.

## What This Command Does

1. **Identify Nuxt Changes**: Find modified `nuxt.config.*`, `app.config.*`, `app.vue`, `pages/**`, `app/**`, `server/**`, `middleware/**`, `plugins/**`, and `composables/**` files via `git diff`.
2. **Run Project Checks**: Execute available lint, typecheck, and test commands without inventing scripts.
3. **Review Nuxt Lanes Only**: SSR data fetching, runtimeConfig exposure, Nitro routes, routeRules, middleware, hydration, payload size, and Nuxt-aware tests.
4. **Coordinate Companion Review**: Use `typescript-reviewer` for generic TS/JS issues and `vue-reviewer` for Vue component reactivity/template concerns.
5. **Generate Report**: Categorize issues by severity (CRITICAL / HIGH / MEDIUM) with file and line references.

## When to Use

Use `/nuxt-review` when:

- A PR or commit touches Nuxt app structure, including `nuxt.config.*`, `app.vue`, `pages/**`, `app/**`, `server/**`, or `middleware/**`.
- Reviewing first-paint data fetching with `useFetch`, `useAsyncData`, or `$fetch`.
- Auditing `runtimeConfig`, `runtimeConfig.public`, `app.config.ts`, or payload serialization.
- Reviewing Nitro `server/api` or `server/routes` handlers.
- Changing route middleware, layouts, route rules, prerender/SWR/ISR behavior, or `ssr: false`.
- Adding or changing Nuxt tests with `@nuxt/test-utils`.

For Vue-only component changes without Nuxt SSR or filesystem conventions, use `/vue-review`. For pure `.ts` utilities with no Nuxt imports, use `/code-review` or invoke `typescript-reviewer`.

## Scope vs `/vue-review` and TypeScript Review

| Tool | Scope |
|---|---|
| `nuxt-reviewer` (this command) | SSR data flow, Nitro, runtimeConfig, routeRules, middleware, Nuxt tests |
| `vue-reviewer` | Vue reactivity, templates, props/emits/slots, Pinia/Vue Router component concerns |
| `typescript-reviewer` | Generic TS/JS type safety, async correctness, Node.js concerns |
| `security-reviewer` | Project-wide security audit |

## Review Categories

### CRITICAL (Must Fix)

- Secrets placed in `runtimeConfig.public`, `app.config.ts`, `NUXT_PUBLIC_*`, or Nuxt payload data.
- Nitro `server/api` / `server/routes` handler accepting raw body/query/params without validation.
- User-controlled host or URL passed into server-side `$fetch` without allowlisting (SSRF).
- Server-side authenticated fetch uses bare `$fetch` and drops incoming cookies instead of `useRequestFetch()` or explicit headers.
- Private user fields, tokens, or credentials returned from `useFetch`, `useAsyncData`, or `useState`.

### HIGH (Should Fix)

- Top-level `$fetch` for SSR first-paint data instead of `useFetch` or `useAsyncData`.
- Missing or unstable `useAsyncData` key for shared dynamic data.
- Side effects inside `useAsyncData` handlers.
- Browser-only APIs used during SSR without `import.meta.client`, `onMounted`, `.client.ts`, or `<ClientOnly>`.
- `server/middleware` returning a response instead of mutating `event.context` or headers.
- Route middleware calling `useRoute()` instead of using `to` and `from`.
- Blanket `ssr: false` or incorrect `routeRules` used as a hydration escape hatch.
- Missing `definePageMeta` for declared layout, middleware, auth, or route validation behavior.

### MEDIUM (Consider)

- Overlarge payloads that should use `pick` or `transform`.
- Non-critical data blocking navigation instead of lazy fetch with pending UI.
- Lazy components or lazy hydration configured but still eagerly loaded.
- Missing `@nuxt/test-utils` coverage for changed pages, composables, middleware, or Nitro routes.
- Missing pending/error UI assertions for `useFetch` or `useAsyncData`.

## Automated Checks Run

```bash
# Respect project scripts first
npm run lint --if-present
npm run typecheck --if-present
npm test --if-present

# Nuxt-specific fallbacks when appropriate
npx nuxi typecheck
npx vitest run
npx vitest run --environment nuxt
```

If `@nuxt/test-utils` is not configured and the change touches Nuxt runtime behavior, the review should flag the missing coverage path and continue.

## Example Usage

````text
User: /nuxt-review

Agent:
# Nuxt Code Review Report

## Files Reviewed
- nuxt.config.ts
- server/api/session.post.ts
- pages/account.vue

## Checks
PASS: npm run lint
PASS: npm run typecheck
SKIP: @nuxt/test-utils not configured

## Issues Found

[CRITICAL] Secret exposed through runtimeConfig.public
File: nuxt.config.ts:12
Issue: API secret is nested under runtimeConfig.public.
Why: Public runtime config is serialized to the client bundle and page payload.
Fix: Move the secret to a root runtimeConfig key and access it only in server routes:
```ts
export default defineNuxtConfig({
  runtimeConfig: {
    apiSecret: process.env.NUXT_API_SECRET,
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE,
    },
  },
});
```

[HIGH] First-paint data uses top-level $fetch
File: pages/account.vue:8
Issue: Page setup calls `$fetch` for SSR-rendered account data.
Why: Nuxt may fetch once on the server and again during hydration.
Fix: Use `await useFetch('/api/account')` or `await useAsyncData('account', () => $fetch('/api/account'))`.

## Summary
- CRITICAL: 1
- HIGH: 1
- MEDIUM: 0

Recommendation: FAIL: Block merge until CRITICAL and HIGH issues are fixed.
````

## Approval Criteria

| Status | Condition |
|---|---|
| PASS: Approve | No CRITICAL or HIGH issues |
| WARNING: Warning | Only MEDIUM issues |
| FAIL: Block | CRITICAL or HIGH issues found |

## Related

- Agent: `agents/nuxt-reviewer.md`
- Companion agents: `agents/vue-reviewer.md`, `agents/typescript-reviewer.md`
- Skills: `skills/nuxt4-patterns/`, `skills/vue-patterns/`, `skills/vite-patterns/`
- Rules: `rules/nuxt/`
- Commands: `/vue-review`, `/code-review`
