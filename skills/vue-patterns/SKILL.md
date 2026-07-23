---
name: vue-patterns
description: Vue.js 3 Composition API patterns, component architecture, reactivity best practices, Pinia state management, Vue Router navigation, and Nuxt SSR patterns. Activates for Vue, Nuxt, Vite, or Pinia projects.
origin: ECC
---

# Vue.js Patterns and Best Practices

Comprehensive guide for Vue.js 3 development using Composition API (`<script setup>`), covering component design, reactivity, state management, routing, testing, and SSR patterns. Nuxt-specific guidance is included where it differs from vanilla Vue.

## When to Activate

Activate this skill when:
- The project uses Vue.js (any version), Nuxt, Vite + Vue, or Pinia.
- The user asks about Vue component architecture, composables, reactivity, or state management.
- Reviewing Vue Single-File Components (`.vue` files).
- Setting up Vue Router, Pinia stores, or Vite/Vitest configuration.
- Discussing Vue-specific performance, security, or SSR patterns.

---

## 1. Project Structure

### Recommended Layout (Feature-First)

```
src/
├── api/              # API client and endpoint definitions
├── assets/           # Static assets (images, fonts, icons)
├── components/       # Shared/reusable components
│   ├── base/         # Base UI primitives (Button, Input, Modal)
│   └── features/     # Feature-specific shared components
├── composables/      # Reusable Composition API logic
├── layouts/          # Page layouts (optional)
├── pages/            # Route-level page components
├── router/           # Vue Router configuration
├── stores/           # Pinia stores
├── types/            # TypeScript type definitions
├── utils/            # Pure utility functions
└── App.vue           # Root component
```

### File Naming

| Convention | When to Use |
|-----------|-------------|
| `PascalCase.vue` | All components (enforced by `vue/multi-word-component-names`) |
| `useCamelCase.ts` | Composables |
| `camelCase.ts` | Utilities, API clients, types |
| `kebab-case` directories | Route segments, feature folders |

---

## 2. Component Architecture

### Single-File Component Order

```vue
<script setup lang="ts">
// 1. Imports (vue → ecosystem → absolute → relative)
// 2. Props & Emits & Slots
// 3. Composables
// 4. Local state (ref/reactive)
// 5. Computed properties
// 6. Methods
// 7. Watchers
// 8. Lifecycle hooks
</script>

<template>
  <!-- Template content -->
</template>

<style scoped>
  /* Scoped styles */
</style>
```

### Presentational vs Container

- **Container components**: Own data fetching, state, and side effects. Render presentational components.
- **Presentational components**: Receive props, emit events. No API calls, no store access. Pure rendering.

### Props Best Practices

```ts
// Type-based props with defaults
interface Props {
  label: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  items: Item[];
}

const props = withDefaults(defineProps<Props>(), {
  variant: "primary",
  disabled: false,
});
```

- Always provide `type`, and `required`/`default` where appropriate.
- Boolean props: `isXxx`, `hasXxx`, `canXxx`.
- Never mutate props — emit events instead.
- For v-model binding, use `defineModel()` (Vue 3.4+) or `modelValue` + `update:modelValue`.

### Events

```ts
const emit = defineEmits<{
  submit: [];
  "update:modelValue": [value: string];
  select: [id: string, index: number];
}>();
```

- Use kebab-case in templates (`@update:model-value`).
- Use camelCase in script (`emit("update:modelValue", val)`).

---

## 3. Composables (Reusable Logic)

### Structure

```ts
// composables/useDebounce.ts
export function useDebounce<T>(value: MaybeRef<T>, delay: number): Ref<T> {
  const debounced = ref(toValue(value)) as Ref<T>;

  let timer: ReturnType<typeof setTimeout>;
  watch(
    () => toValue(value),
    (newVal) => {
      clearTimeout(timer);
      timer = setTimeout(() => { debounced.value = newVal; }, delay);
    }
  );

  onUnmounted(() => clearTimeout(timer));
  return readonly(debounced);
}
```

### Rules

- Must start with `use` prefix.
- Return reactive values (`ref`, `computed`, `reactive`), never plain primitives.
- Accept reactive inputs via `MaybeRef` / `toRef()` / `toValue()`.
- Clean up side effects in `onUnmounted` or watcher `onCleanup`.
- No module-scope side effects.

### vs Mixins

Composables replace Vue 2 mixins entirely:
- **Mixins**: Opaque data flow, source-of-truth collisions, name conflicts.
- **Composables**: Explicit imports, clear return values, composable and tree-shakable.

---

## 4. State Management

### When to Use What

| Pattern | Use Case |
|---------|----------|
| `ref()` / `reactive()` | Local component state |
| Props + Emits | Parent-child communication |
| Provide / Inject | Theme, config, plugin API |
| Pinia store | Global, shared, complex state |
| Server state composable | API data with caching (wrap `fetch`/TanStack Query) |

### Pinia Setup Store (Preferred)

```ts
// stores/useCartStore.ts
export const useCartStore = defineStore("cart", () => {
  const items = ref<CartItem[]>([]);
  const isLoading = ref(false);

  const totalPrice = computed(() =>
    items.value.reduce((sum, i) => sum + i.price * i.quantity, 0)
  );
  const itemCount = computed(() =>
    items.value.reduce((sum, i) => sum + i.quantity, 0)
  );

  async function addItem(productId: string) {
    isLoading.value = true;
    try {
      const item = await fetchProduct(productId);
      const existing = items.value.find(i => i.id === item.id);
      if (existing) existing.quantity++;
      else items.value.push({ ...item, quantity: 1 });
    } finally {
      isLoading.value = false;
    }
  }

  return { items, isLoading, totalPrice, itemCount, addItem };
});
```

- Use Setup Store syntax (not Options Store).
- Prefer actions for business-level mutations and `$patch()` for grouped updates.
- Every async action: handle loading + success + error.

---

## 5. Vue Router

### Route Definitions

```ts
const routes = [
  {
    path: "/users/:id",
    name: "user-detail",
    component: () => import("@/pages/UserDetail.vue"), // lazy
    props: true, // pass params as props
    meta: { requiresAuth: true },
  },
];
```

### Navigation Guards

```ts
router.beforeEach((to, from) => {
  const { isLoggedIn } = useAuthStore();
  if (to.meta.requiresAuth && !isLoggedIn) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
});
```

### Reactive Route Params

When a component stays mounted but route params change:

```ts
const route = useRoute();
const id = computed(() => route.params.id as string);
watch(id, (newId) => fetchItem(newId));
```

---

## 6. Template Patterns

### Template Syntax

```vue
<!-- v-if/v-else-if/v-else -->
<div v-if="isLoading">Loading...</div>
<div v-else-if="error">Error: {{ error }}</div>
<div v-else>{{ content }}</div>

<!-- v-show for frequent toggles -->
<div v-show="isOpen">Toggled content</div>

<!-- v-for with stable keys -->
<div v-for="item in items" :key="item.id">{{ item.name }}</div>

<!-- Computed filtered list (not v-if + v-for on same element) -->
<div v-for="item in activeItems" :key="item.id">{{ item.name }}</div>

<!-- Event handling -->
<form @submit.prevent="handleSubmit">
  <button type="submit">Save</button>
</form>

<!-- v-model -->
<input v-model="name" />
<CustomInput v-model="value" v-model:title="title" />
```

---

## 7. Performance

| Technique | When to Use |
|-----------|-------------|
| `v-memo` | List items that rarely change |
| `v-once` | Content rendered once and static forever |
| `shallowRef()` | Large data structures replaced wholesale |
| `shallowReactive()` | Only top-level properties are reactive |
| `v-show` over `v-if` | Frequent visibility toggles |
| `<KeepAlive :max="10">` | Cache toggled views |
| Lazy routes | `() => import(...)` for non-critical routes |
| `Suspense` | Async component loading with fallback |

---

## 8. Testing

### Stack

- **Vitest** for unit and component tests
- **Vue Test Utils** for mounting and interaction
- **@pinia/testing** for store mocking
- **Playwright** for E2E

### Component Test Pattern

```ts
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import UserCard from "./UserCard.vue";

beforeEach(() => { setActivePinia(createPinia()); });

it("renders and emits", async () => {
  const wrapper = mount(UserCard, {
    props: { user: { id: "1", name: "Alice" } },
  });
  expect(wrapper.text()).toContain("Alice");
  await wrapper.find("button").trigger("click");
  expect(wrapper.emitted("select")![0]).toEqual(["1"]);
});
```

---

## 9. Nuxt-Specific Patterns

### Auto-Imports

Nuxt auto-imports `ref`, `computed`, `watch`, `useFetch`, `useAsyncData`, etc. Use them directly without importing. For non-Nuxt projects, always import explicitly.

### useAsyncData / useFetch

```ts
const { data: user, pending, error, refresh } = await useAsyncData(
  "user", // unique key for caching
  () => $fetch(`/api/users/${id}`),
);

const { data: posts } = await useFetch("/api/posts", {
  query: { page: 1 },
  key: "posts-page-1", // dedupes requests
});
```

### Server Routes

```ts
// server/api/users/[id].ts
export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, z.object({
    id: z.string().uuid(),
  }).parse);
  // ... fetch and return
});
```

### Runtime Config

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    // server-only
    apiSecret: "",
    // public (exposed to client)
    public: {
      apiBase: "https://api.example.com",
    },
  },
});
```

---

## 10. Vue 3.5+ New APIs

### Reactive Props Destructure

Vue 3.5 stabilized reactive props destructure — destructured variables from `defineProps()` are automatically reactive:

```ts
// Vue 3.5+: destructured props are reactive (no need for toRefs)
const { count = 0, msg = "hello" } = defineProps<{
  count?: number;
  msg?: string;
}>();

// Limitation: cannot watch destructured prop directly
watch(() => count, (newVal) => { ... }); // PASS getter required
```

### `useTemplateRef()`

Replace name-matched plain refs with `useTemplateRef()` for template references:

```ts
import { useTemplateRef } from "vue";
const inputEl = useTemplateRef<HTMLInputElement>("input");
// "input" matches the ref="input" attribute in template, not the variable name
```

Supports dynamic ref IDs: `useTemplateRef(dynamicRefId)`.

### `onWatcherCleanup()`

Globally importable watcher cleanup API (Vue 3.5+). It must be called synchronously inside the watcher callback:

```ts
import { watch, onWatcherCleanup } from "vue";

watch(userId, async (newId) => {
  const controller = new AbortController();
  onWatcherCleanup(() => controller.abort());
  // ... fetch with signal
});
```

### `useId()`

SSR-stable unique ID generation for form elements and accessibility:

```ts
import { useId } from "vue";
const id = useId();
```

### `defer` Teleport

`<Teleport defer>` allows teleporting to targets rendered in the same cycle:

```vue
<Teleport defer to="#container">Content</Teleport>
<div id="container"></div>
```

### Lazy Hydration (SSR)

`defineAsyncComponent()` now supports `hydrate` strategy:

```ts
import { defineAsyncComponent, hydrateOnVisible } from "vue";
const AsyncComp = defineAsyncComponent({
  loader: () => import("./Comp.vue"),
  hydrate: hydrateOnVisible(),
});
```

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | The Fix |
|-------------|---------------|---------|
| Destructuring `defineProps()` (Vue < 3.5) | Captures snapshot, loses reactivity | Access via `props.xxx` or use `toRefs()` |
| `watch()` on destructured prop (Vue 3.5+) | Compile-time error — destructured props can't be watched directly | Use getter wrapper: `watch(() => count, ...)` |
| `v-if` + `v-for` on same element | Ambiguous execution order | Use computed filtered array |
| `v-for` key = index | Broken state on reorder | Use stable database IDs |
| Mutating props | Violates one-way data flow | Emit events or use `v-model` |
| `v-html` with user content | XSS vulnerability | Sanitize with DOMPurify |
| Mixins in Vue 3 | Opaque, collision-prone | Replace with composables |
| Module-scope side effects in composable | Shared across instances | Scope in `onMounted` + `onUnmounted` |
| `reactive()` for replaceable state | Replacement breaks reactivity | Use `ref()` instead |
| Watcher without cleanup | Memory leaks, race conditions | Use `onCleanup` or `onWatcherCleanup()` (Vue 3.5+) |
| Options API in new Vue 3 code | Ecosystem move to Composition API | Use `<script setup>` |
| Plain ref for template references | No dynamic ref support, name-matching fragile | Use `useTemplateRef()` (Vue 3.5+) |

## Related Skills

- `accessibility` — ARIA, semantic HTML, focus management
- `frontend-patterns` — Cross-framework frontend architecture
- `typescript` — TypeScript best practices applied to Vue projects
- `coding-standards` — General code quality standards
