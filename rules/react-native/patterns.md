---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---
# React Native / Expo Patterns

> This file extends [common/patterns.md](../common/patterns.md) with React Native / Expo specific patterns.
> Note: Do NOT install the `web/` ruleset in a React Native project — those patterns assume the DOM (e.g. URL-as-state) and do not apply here.

## Navigation (Expo Router)

Expo Router is Expo's built-in, file-based router (`app/` directory); React Navigation is the established alternative. The examples below use Expo Router; the principles apply either way.

- Keep route files (`app/**`) thin — they wire params + hooks to a screen component that lives in `components/` or `features/`.
- Type route params; validate untrusted params (e.g. from deep links) with Zod before use.
- Use typed navigation helpers (`useLocalSearchParams`, `Link`, `router.push`).
- Centralize linking config; never trust deep-link params without validation.

```tsx
// app/user/[id].tsx
import { useLocalSearchParams, router } from 'expo-router'
import { z } from 'zod'

const Params = z.object({ id: z.string().uuid() })

export default function UserScreen() {
  // Use safeParse, not parse: a malformed deep link would otherwise throw
  // during render and crash the screen. Redirect instead of throwing.
  const parsed = Params.safeParse(useLocalSearchParams())
  if (!parsed.success) {
    router.replace('/not-found')
    return null
  }
  return <UserProfile userId={parsed.data.id} />
}
```

## State Management

The rule is to keep these concerns separate and not duplicate server data into client stores. The tools listed are common choices, not requirements — pick what fits your project.

| Concern | Common choices |
|---------|---------|
| Server state | a server-cache library (TanStack Query, SWR) |
| Client/UI state | a lightweight store (Zustand, Jotai) or Context |
| Navigation/route state | Expo Router params (NOT a global store) |
| Form state | a form library (e.g. React Hook Form) with schema validation |
| Secure persistence | `expo-secure-store` |
| Non-secure persistence | `AsyncStorage` / MMKV |

- Derive values instead of storing redundant computed state.
- Keep global client state minimal; prefer local `useState` until sharing is actually needed.

## Data Fetching

Use a server-cache library (TanStack Query, SWR) instead of ad-hoc fetch-in-`useEffect`. The examples use TanStack Query.

- Route server reads through the cache (e.g. `useQuery`) and mutations through it (e.g. `useMutation`) with cache invalidation.
- Validate API responses with Zod at the boundary; infer types from the schema. (Zod is already the validation default in ECC's `typescript/` rules.)
- Handle the three states explicitly in UI: loading, error, empty.
- Use optimistic updates for fast interactions: snapshot, apply, roll back on failure with visible feedback.
- Fetch independent data in parallel; avoid request waterfalls between parent and child.

```tsx
function useUser(id: string) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: async () => userSchema.parse(await api.getUser(id)),
  })
}
```

## Lists

- Use `FlatList`/`SectionList` (or `FlashList` for large/heavy lists) — never `.map()` a large array inside a `ScrollView`.
- Provide a stable `keyExtractor`; memoize `renderItem`.
- Paginate or virtualize long data sets.

## Custom Hooks

- Extract reusable logic (data, permissions, device APIs) into `use*` hooks.
- Keep side effects (Expo SDK calls, subscriptions) inside hooks, not in JSX.

## Async & Effects

- Clean up subscriptions, timers, and listeners in the effect's return function.
- Cancel or ignore stale async results on unmount to avoid setState-after-unmount.
