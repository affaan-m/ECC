---
name: rules-vue
description: ECC vue engineering rules for coding style, patterns, security, and testing.
display_name: "ECC Vue Rules"
icon: book
---

# ECC Vue Rules

## Vue Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with Vue specific content.

### SFC Structure

- Always `<script setup lang="ts">` with the Composition API. No Options API in new code.
- Block order inside a `.vue` file: `<script setup>`, then `<template>`, then `<style scoped>`. One component per file.
- Naming: component files PascalCase (`AuctionCard.vue`), composables camelCase prefixed `useXxx` (`useAuctionTimer`).
- Format with Prettier plus ESLint flat config using `eslint-plugin-vue` (`vue/vue3-recommended`). Type-check with `vue-tsc`.

### Reactivity Discipline

- `ref` is the primary state API. Mutate via `.value` in script, auto-unwrapped only at template top level.
- Nested `ref` inside arrays, `Map`, or `Set` still needs `.value` to read.
- Reach for `reactive` only for grouped object state. Never reassign a whole `reactive` object.
- Never destructure a `reactive` object or a Pinia store without `toRefs` / `storeToRefs`. Plain destructure silently drops reactivity.

### Computed and Watchers

- `computed` getters must be pure: no side effects, no async, no DOM access.
- 3.4+ `computed` only triggers when the returned value changes. Return the prior object unchanged when equal to skip downstream updates.
- `watch` is lazy. Pass a getter for a reactive property (`watch(() => x.value, ...)`), not the bare reactive object.
- `watchEffect` is eager and stops tracking dependencies after its first `await`.

### Lifecycle and DOM

- Register lifecycle hooks synchronously inside `setup` (`onMounted`, `onUnmounted`).
- Clean up timers, listeners, and subscriptions in `onUnmounted`.
- Read or measure the DOM only after `await nextTick()`.

### Macros and Templates

- Macros: `defineProps` / `defineEmits` (tuple form `change: [id: number]`), `defineModel` (3.4+) for `v-model`, `withDefaults` or 3.5+ reactive-props-destructure for defaults, `defineExpose` for the public ref API.
- Put a `:key` on every `v-for`, a stable unique primitive. Never the array index, never an object.
- Never put `v-if` and `v-for` on the same element. Wrap with `<template v-for>` plus an inner `v-if`, or precompute a filtered list.

```vue
<script setup lang="ts">
const props = defineProps<{ id: number }>()
const emit = defineEmits<{ change: [id: number] }>()
const open = defineModel<boolean>('open', { default: false })
</script>
```

### Reference

- ECC skills: `frontend-patterns`, `vite-patterns`.
- Docs: <https://vuejs.org/api/sfc-script-setup.html> · <https://vuejs.org/guide/essentials/reactivity-fundamentals.html> · <https://eslint.vuejs.org/>

## Vue Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Vue specific content.

### PostToolUse Targets

Run on `*.vue`, `*.ts`, and `*.tsx` after edits. Scope to changed files where possible.

### Typecheck

- Use `vue-tsc --noEmit` for SFC plus TypeScript checking. Plain `tsc` cannot read `.vue` single-file components, so it must not be the typecheck hook for this project.
- Typecheck is project-wide. Debounce or scope it so a save-on-every-keystroke loop does not stall the editor.

### Lint and Format

- `eslint --fix` with `eslint-plugin-vue` (flat-config `vue/vue3-recommended`) covers both template and script lint.
- `prettier --write` for formatting. Prefer Prettier-via-ESLint over a separate Prettier pass to avoid double formatting and fight loops.

### Architecture Boundaries

- Optional: enforce Feature-Sliced Design slice boundaries with `@feature-sliced/steiger` or `eslint-plugin-boundaries` to block deep cross-slice imports.

### Sequencing

```bash
# changed files only
eslint --fix "$FILE"
prettier --write "$FILE"
# project-wide, debounced
vue-tsc --noEmit
```

- Run lint and format per-file first, then the project-wide typecheck last so type errors reflect the formatted source.

### Reference

- ECC skills: `frontend-patterns`, `vite-patterns`.
- Docs: <https://github.com/vuejs/language-tools> (vue-tsc) · <https://eslint.vuejs.org/> · <https://github.com/feature-sliced/steiger>

## Vue Patterns

> This file extends [common/patterns.md](../common/patterns.md) with Vue specific content.

### Composables

- The composable (`useXxx`) is the reusable-logic unit. In Feature-Sliced Design it lives in the slice `model` segment.
- Accept `MaybeRefOrGetter<T>` inputs and normalize with `toValue`, so callers can pass a ref, a getter, or a raw value.
- Return `toRefs(reactive(...))` so consumers can destructure without losing reactivity.
- A composable that uses lifecycle hooks or `provide` / `inject` must be called inside a component `setup`, not lazily or conditionally.

### Props, Emits, v-model

- Type-based `defineProps<Props>()` and tuple-form `defineEmits<{ change: [id: number] }>()`.
- `defineModel<T>('name', { default })` for two-way binding. It compiles to a prop plus an `update:*` emit.

### Provide / Inject

- Use `provide` / `inject` for tree-scoped data without prop drilling.
- Type-safe collision-free keys: `const key = Symbol() as InjectionKey<T>`.
- The provider owns mutations. Expose a `readonly` ref plus an explicit updater function, never a raw mutable ref.

### Pinia (FSD model segment)

- Prefer setup stores: `ref` is state, `computed` is getters, `function` is actions.
- Setup stores do not get `$reset` for free. Define your own.
- Use `storeToRefs` for state and getters. Destructure actions directly off the store.
- Never persist raw auth tokens to `localStorage`.

### vue-router

- Lazy-load route components with dynamic `import()`.
- A global `beforeEach` auth gate keyed on `meta.requiresAuth`. Guards return `false` (cancel), a route location (redirect), or `undefined` / `true` (continue).
- Watch `() => route.params.id`, not the whole `route` object.

### vue-query (server cache)

- `@tanstack/vue-query` owns server-cache state. Pinia owns client state.
- Put request functions plus `queryOptions` factories in the FSD `api` segment.
- Critical: put the ref or computed ITSELF in the query key, never `.value`. Passing `.value` freezes the key and kills reactive refetch.

```ts
useQuery({ queryKey: ['auction', id], queryFn: () => fetchAuction(toValue(id)) })
// after a mutation
queryClient.invalidateQueries({ queryKey: ['auction', id] })
```

### Reference

- ECC skills: `frontend-patterns`, `vite-patterns`.
- Docs: <https://pinia.vuejs.org/> · <https://router.vuejs.org/> · <https://tanstack.com/query/latest/docs/framework/vue/overview> · <https://vuejs.org/guide/reusability/composables.html>

## Vue Security

> This file extends [common/security.md](../common/security.md) with Vue specific content.

### What Vue Escapes Automatically

- Text interpolation `{{ }}` and dynamic attribute bindings (`:title`) are auto-escaped. The vectors below are NOT protected.

### Rule No.1: Templates from Trusted Sources Only

- Never use non-trusted content as a component template. No runtime template compilation from user input.
- No user-controlled `:is` that resolves a component from an arbitrary string.

### v-html and Render Functions

- `v-html` bypasses escaping and is a direct XSS vector. Avoid it on user content.
- If unavoidable, sanitize with DOMPurify (allowlist config) before binding, or render in a sandboxed iframe. Vue itself recommends sanitizing on the backend before persisting.
- Render-function and scoped-slot output carry the same risk. Passing user HTML through `h()` with `innerHTML` is `v-html` by another name. Sanitize first.

### URL, Style, and Event Injection

- `:href` and `:src` are not escaped. `javascript:` URLs execute. Validate the scheme, allow `http` / `https` / `mailto` only. Vue docs reference `@braintree/sanitize-url`, but sanitize on the backend before persisting.
- `:style` with user input is unsafe (CSS exfiltration). Use object syntax with whitelisted properties, never a raw user string.
- Never bind user input to `onclick`, `onfocus`, or any event attribute.

### Client Bundle Secrets

- Anything in `import.meta.env.VITE_*` ships to the browser. Keep API keys and tokens server-side.
- Use httpOnly cookies for session tokens. Never bundle credentials into the client.

```vue
<!-- unsafe -->
<div v-html="userBio" />
<!-- safe -->
<div v-html="sanitize(userBio)" />
```

### Reference

- ECC skills: `frontend-patterns`, `vite-patterns`.
- Docs: <https://vuejs.org/guide/best-practices/security.html> · <https://github.com/cure53/DOMPurify> · <https://github.com/braintree/sanitize-url>

## Vue Testing

> This file extends [common/testing.md](../common/testing.md) with Vue specific content.

### Stack

- Vitest (Vite-native runner) plus `@vue/test-utils`. `create-vue` scaffolds `@vitejs/plugin-vue`.
- DOM environment via `happy-dom` or `jsdom`, set in `vite.config.ts` under `test.environment`.

### Rendering and Async

- `mount` for a full render. `shallowMount` to stub all child components.
- `trigger` and `setValue` return promises, `await` them.
- `flushPromises` flushes resolved promise handlers. `nextTick` settles the DOM after a state change.

### What to Test

- Test the public interface only: props, emitted events, slots, rendered output.
- Do not assert private state or internal methods, and do not rely solely on snapshots.

### Composables

- Composables that use only reactivity APIs unit-test directly: call the function, assert on the returned refs.
- Composables that use lifecycle hooks or `inject` must be tested through a host component.

### Pinia

- In components: `createTestingPinia()` from `@pinia/testing`, passed via `global.plugins`. Actions are stubbed by default, set `stubActions: false` to run them. `createSpy: vi.fn` is required under Vitest (no Jest globals).
- In isolation: `beforeEach(() => setActivePinia(createPinia()))` gives a fresh store per test and prevents state leakage.

### Mount Config

- `global.plugins`, `global.stubs` (stubs `Transition` / `TransitionGroup` by default), `global.mocks` (e.g. `$router`), `global.provide` (for `inject`, Symbol keys supported).
- `RouterLinkStub` stubs `router-link` without mounting a full router.

```ts
const wrapper = mount(AuctionCard, {
  props: { id: 1 },
  global: { plugins: [createTestingPinia({ createSpy: vi.fn })] },
})
await wrapper.find('button').trigger('click')
expect(wrapper.emitted('bid')).toBeTruthy()
```

### Reference

- ECC skills: `frontend-patterns`, `vite-patterns`.
- Docs: <https://test-utils.vuejs.org/api/> · <https://pinia.vuejs.org/cookbook/testing.html> · <https://vitest.dev/>
