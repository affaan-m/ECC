---
description: Comprehensive Vue.js code review for Composition API correctness, reactivity, composable patterns, template security, accessibility, and Vue-specific performance. Invokes the vue-reviewer agent (and typescript-reviewer alongside on .vue/.ts changes).
---

# Vue Code Review

This command invokes the **vue-reviewer** agent for Vue-specific code review. For pull requests touching `.vue` files or Vue-containing `.ts`/`.js` files, both `vue-reviewer` and `typescript-reviewer` should run — each owns a distinct lane.

## What This Command Does

1. **Identify Vue Changes**: Find modified `.vue` files and Vue-related `.ts`/`.js` files via `git diff`
2. **Run Lint**: Execute `eslint` with `eslint-plugin-vue`
3. **Typecheck**: Run `vue-tsc --noEmit` or the project's canonical typecheck command
4. **Review Vue Lanes Only**: Reactivity, composables, template security, accessibility, Vue-specific performance
5. **Generate Report**: Categorize issues by severity (CRITICAL / HIGH / MEDIUM)

## When to Use

Use `/vue-review` when:

- A PR or commit touches `.vue` files
- After writing or modifying Vue components, composables, or Pinia stores
- Before merging Vue code
- Auditing template security (`v-html`, URL bindings)
- Reviewing a new composable for correctness
- Auditing Vue Router guards and navigation
- Reviewing Nuxt server routes or SSR-specific code

For pure `.ts`/`.js` changes with no Vue imports, use `/code-review` (general) or invoke `typescript-reviewer` directly.

## Scope vs `/code-review` and TypeScript Review

| Tool | Scope |
|---|---|
| `vue-reviewer` (this command) | Reactivity, composables, template security, a11y, Vue performance, Pinia/Router |
| `typescript-reviewer` | Generic TS/JS — `any` abuse, async correctness, Node security |
| `security-reviewer` | Project-wide security audit |
| `/code-review` | Generic uncommitted-changes or PR review |

On a `.vue` / Vue-related PR, invoke both `vue-reviewer` and `typescript-reviewer`. Findings from each are non-overlapping by design.

## Review Categories

### CRITICAL (Must Fix)

- `v-html` with unsanitized input
- `:href`/`:src` with unvalidated user URLs (`javascript:`, `data:`)
- Secret in client bundle (`VITE_*`, Nuxt `public` runtimeConfig)
- Server endpoint without input validation (Nuxt Nitro)
- `localStorage`/`sessionStorage` for session tokens
- Destructuring reactive props in Vue < 3.5 (breaks reactivity)
- `reactive()` object replacement (breaks watchers)
- Watcher source tracking a ref object instead of `.value`

### HIGH (Should Fix)

- Composable with module-scope side effects
- Missing cleanup in composable (watcher, interval, listener)
- `v-for` without `:key` or with `key={index}`
- `v-if` + `v-for` on same element
- Props mutation
- Missing prop validation
- Route guard returning false without redirect
- `useRoute().params` destructured at top-level (snapshot)
- `v-model` bound to computed without setter
- Accessibility violations (missing labels, non-semantic interactive elements)
- Direct store property mutation outside actions

### MEDIUM (Consider)

- Options API in new Vue 3 code
- Component over 300 lines
- `v-show` where `v-if` is more appropriate (or vice versa)
- Missing `:max` on `<KeepAlive>`
- Missing `shallowRef` for large replaced data
- Custom validation instead of vetted form library
- `defineExpose` exposing more than necessary
- `inheritAttrs` not disabled when using `v-bind="$attrs"`

## Automated Checks Run

```bash
# Lint (required)
npx eslint . --ext .vue,.ts,.js

# Vue-specific typecheck
vue-tsc --noEmit

# Targeted security rules
npx eslint . --rule 'vue/no-v-html: warn' \
              --rule 'vue/no-template-target-blank: error'

# Supply-chain
npm audit
```

If `eslint-plugin-vue` or `vue-tsc` is not configured, the review will flag the gap as a HIGH config issue and continue.

## Example Usage

````text
User: /vue-review

Agent:
# Vue Code Review Report

## Files Reviewed
- src/components/UserCard.vue (modified)
- src/composables/useUser.ts (new)
- src/stores/useUserStore.ts (modified)

## Lint Results
PASS: eslint clean
PASS: vue-tsc clean

## Issues Found

[CRITICAL] Unsanitized v-html
File: src/components/UserCard.vue:15
Issue: User-controlled bio rendered as raw HTML via v-html.
Why: XSS via stored script tags in user input.
Fix: Sanitize with DOMPurify or render as text:
```vue
<script setup>
import DOMPurify from "dompurify";
const safeBio = computed(() => DOMPurify.sanitize(user.bio));
</script>
<template>
  <div v-html="safeBio" />
</template>
```

[HIGH] Watcher in composable missing cleanup
File: src/composables/useUser.ts:22
Issue: `watch` callback fires fetch without AbortController; stale responses can overwrite newer data.
Fix: Use onCleanup to abort:
```ts
watch(userId, async (newId, _old, onCleanup) => {
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  const data = await fetch(`/api/users/${newId}`, { signal: controller.signal });
  user.value = await data.json();
});
```

## Summary
- CRITICAL: 1
- HIGH: 1
- MEDIUM: 0

Recommendation: FAIL: Block merge until CRITICAL issue is fixed
````

## Approval Criteria

| Status | Condition |
|---|---|
| PASS: Approve | No CRITICAL or HIGH issues |
| WARNING: Warning | Only MEDIUM issues (merge with caution) |
| FAIL: Block | CRITICAL or HIGH issues found |

## Integration with Other Commands

- Run your project's build command first if the build is broken
- Run tests to ensure component tests pass
- Run `/vue-review` before merging Vue code
- Use `/code-review` for non-Vue-specific concerns on the same PR

## Related

- Agent: `agents/vue-reviewer.md`
- Companion agent: `agents/typescript-reviewer.md` (run alongside for Vue-related TS/JS)
- Skills: `skills/vue-patterns/`
- Rules: `rules/vue/`
