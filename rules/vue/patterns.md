---
paths:
  - "**/*.vue"
---

# Vue Patterns

> This file extends [common/patterns.md](../common/patterns.md) with Vue specific content.

## Composables

- The composable (`useXxx`) is the reusable-logic unit. In Feature-Sliced Design it lives in the slice `model` segment.
- Accept `MaybeRefOrGetter<T>` inputs and normalize with `toValue`, so callers can pass a ref, a getter, or a raw value.
- Return `toRefs(reactive(...))` so consumers can destructure without losing reactivity.
- A composable that uses lifecycle hooks or `provide` / `inject` must be called inside a component `setup`, not lazily or conditionally.

## Props, Emits, v-model

- Type-based `defineProps<Props>()` and tuple-form `defineEmits<{ change: [id: number] }>()`.
- `defineModel<T>('name', { default })` for two-way binding. It compiles to a prop plus an `update:*` emit.

## Provide / Inject

- Use `provide` / `inject` for tree-scoped data without prop drilling.
- Type-safe collision-free keys: `const key = Symbol() as InjectionKey<T>`.
- The provider owns mutations. Expose a `readonly` ref plus an explicit updater function, never a raw mutable ref.

## Pinia (FSD model segment)

- Prefer setup stores: `ref` is state, `computed` is getters, `function` is actions.
- Setup stores do not get `$reset` for free. Define your own.
- Use `storeToRefs` for state and getters. Destructure actions directly off the store.
- Never persist raw auth tokens to `localStorage`.

## vue-router

- Lazy-load route components with dynamic `import()`.
- A global `beforeEach` auth gate keyed on `meta.requiresAuth`. Guards return `false` (cancel), a route location (redirect), or `undefined` / `true` (continue).
- Watch `() => route.params.id`, not the whole `route` object.

## vue-query (server cache)

- `@tanstack/vue-query` owns server-cache state. Pinia owns client state.
- Put request functions plus `queryOptions` factories in the FSD `api` segment.
- Critical: put the ref or computed ITSELF in the query key, never `.value`. Passing `.value` freezes the key and kills reactive refetch.

```ts
useQuery({ queryKey: ['auction', id], queryFn: () => fetchAuction(toValue(id)) })
// after a mutation
queryClient.invalidateQueries({ queryKey: ['auction', id] })
```

## Reference

- ECC skills: `frontend-patterns`, `vite-patterns`.
- Docs: https://pinia.vuejs.org/ · https://router.vuejs.org/ · https://tanstack.com/query/latest/docs/framework/vue/overview · https://vuejs.org/guide/reusability/composables.html
