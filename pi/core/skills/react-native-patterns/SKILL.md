---
name: react-native-patterns
description: React Native and Expo app patterns — Expo Router navigation, state separation (server/client/route/form), TanStack Query data fetching with Zod, performant lists, NativeWind/StyleSheet styling, native APIs, and secure storage. Use when building or editing React Native / Expo screens, components, navigation, or data layers.
origin: ECC
---

# React Native / Expo Patterns

Practical patterns for building production React Native apps with Expo. Covers navigation, state, data fetching, lists, styling, and native APIs. Pairs with the `rules/react-native/` ruleset: rules say *what* to enforce, this skill shows *how*.

Libraries named below (NativeWind, Zustand/Jotai, TanStack Query) are common, well-established options shown for illustration — the patterns matter more than the specific package, and any equivalent works. Zod is used for validation to stay consistent with ECC's existing `typescript/` rules.

These patterns assume the managed Expo workflow (Expo Router, EAS, `expo-*` modules) on the New Architecture (the default in recent Expo SDKs, mandatory from SDK 55+). They do NOT assume the browser DOM — React Native has no `<div>`, no URL bar, and no web data-fetching defaults.

## When to Activate

Use this skill when:

- Building or editing React Native / Expo screens, components, or navigation
- Setting up routing with Expo Router (file-based `app/` directory)
- Deciding where state belongs (server cache vs client store vs route params vs form)
- Wiring data fetching with TanStack Query and validating responses with Zod
- Rendering long or heavy lists
- Choosing or applying a styling approach (NativeWind or StyleSheet)
- Accessing native device APIs (camera, location, notifications) or secure storage
- Reviewing RN code for mobile-specific issues

Do NOT use the web/React-DOM patterns here — URL-as-state, `<div>`, and SWR-for-browser do not apply to React Native.

## Core Concepts

### Project structure (Expo Router)

File-based routing under `app/`. Keep route files thin: they read and validate params, then delegate to a screen component that lives in `components/` or `features/`.

```
app/
  _layout.tsx          # root stack
  (tabs)/
    _layout.tsx        # tab navigator
    index.tsx          # Home
  user/[id].tsx        # dynamic route
components/
features/
  user/UserProfile.tsx
```

### Navigation: validate route params

Deep links and dynamic routes deliver untrusted strings. Validate them with Zod before use.

```tsx
// app/user/[id].tsx
import { useLocalSearchParams, router } from 'expo-router'
import { z } from 'zod'
import { UserProfile } from '@/features/user/UserProfile'

const Params = z.object({ id: z.string().uuid() })

export default function UserRoute() {
  const parsed = Params.safeParse(useLocalSearchParams())
  if (!parsed.success) {
    router.replace('/not-found')
    return null
  }
  return <UserProfile userId={parsed.data.id} />
}
```

### State: keep concerns separate

Do not duplicate server data into a client store. Each concern has its own home.

| Concern | Common choices |
|---------|------|
| Server state (remote data) | a server-cache library (TanStack Query, SWR) |
| Client/UI state | a lightweight store (Zustand, Jotai) or Context |
| Route/navigation state | Expo Router params |
| Form state | a form library (e.g. React Hook Form) + schema validation |
| Secrets / tokens | `expo-secure-store` |
| Non-secret persistence | `AsyncStorage` / MMKV |

Prefer local `useState` until state genuinely needs sharing.

### Data fetching: a cache library + Zod

Use a server-cache library (TanStack Query, SWR) instead of fetch-in-`useEffect`. Validate at the boundary and infer types from the schema. Handle loading, error, and empty states explicitly. (Example uses TanStack Query.)

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

const User = z.object({ id: z.string(), email: z.string().email() })
type User = z.infer<typeof User>

export function useUser(id: string) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: async (): Promise<User> => User.parse(await api.getUser(id)),
  })
}

export function useUpdateEmail(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (email: string) => api.updateEmail(id, email),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user', id] }),
  })
}
```

### Lists: virtualize, never map a big array in a ScrollView

```tsx
import { FlatList } from 'react-native'

<FlatList
  data={items}
  keyExtractor={(item) => item.id}
  renderItem={renderItem}          // memoized
  initialNumToRender={10}
  windowSize={5}
/>
```

Use `FlashList` (Shopify) for large or heterogeneous lists.

### Styling: pick one system

`StyleSheet.create()` is the framework-native option; utility-class libraries (e.g. NativeWind) are a common alternative. Choose one and stay consistent. Never build style objects inline in JSX on hot paths.

```tsx
// NativeWind
<View className="p-4 rounded-2xl bg-white">
  <Text className="text-base font-semibold">Hello</Text>
</View>

// StyleSheet
const styles = StyleSheet.create({ card: { padding: 16, borderRadius: 16, backgroundColor: '#fff' } })
<View style={styles.card}>...</View>
```

### Native APIs: wrap in hooks, clean up effects

Keep Expo SDK calls and subscriptions inside `use*` hooks, not in JSX. Always clean up.

```tsx
import { useEffect, useState } from 'react'
import * as Location from 'expo-location'

type LocationState =
  | { status: 'loading' }
  | { status: 'denied' }
  | { status: 'granted'; coords: Location.LocationObjectCoords }

export function useCurrentLocation() {
  // Track status, not just coords — so the UI can tell "still loading" apart
  // from "permission denied" and show an actionable message.
  const [state, setState] = useState<LocationState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    ;(async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        if (active) setState({ status: 'denied' })
        return
      }
      const pos = await Location.getCurrentPositionAsync({})
      if (active) setState({ status: 'granted', coords: pos.coords })
    })()
    return () => { active = false }   // ignore stale result after unmount
  }, [])

  return state
}
```

### Secure storage for tokens

```tsx
import * as SecureStore from 'expo-secure-store'

await SecureStore.setItemAsync('auth_token', token)   // Keychain / Keystore
const token = await SecureStore.getItemAsync('auth_token')
```

## Code Examples

### A full screen: route → query → list → states

```tsx
// app/(tabs)/orders.tsx
import { memo, useCallback } from 'react'
import { FlatList, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

const OrderSchema = z.object({ id: z.string(), total: z.number(), status: z.string() })
const OrdersSchema = z.array(OrderSchema)
type Order = z.infer<typeof OrderSchema>

function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: async () => OrdersSchema.parse(await api.listOrders()),
  })
}

// Memoized so its reference is stable across renders (see the lists guidance).
const OrderRow = memo(function OrderRow({ item }: { item: Order }) {
  return (
    <View className="px-4 py-3 border-b border-neutral-200">
      <Text className="font-medium">#{item.id}</Text>
      <Text className="text-neutral-500">{item.status} · ${item.total}</Text>
    </View>
  )
})

export default function OrdersScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useOrders()
  const renderItem = useCallback(({ item }: { item: Order }) => <OrderRow item={item} />, [])

  if (isLoading) return <Centered><Text>Loading…</Text></Centered>
  if (isError) return <Centered><Text accessibilityRole="alert">Could not load orders.</Text></Centered>
  if (!data?.length) return <Centered><Text>No orders yet.</Text></Centered>

  return (
    <FlatList
      data={data}
      keyExtractor={(o) => o.id}
      onRefresh={refetch}
      refreshing={isRefetching}
      renderItem={renderItem}
    />
  )
}
```

### A form: React Hook Form + Zod resolver

```tsx
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { TextInput, Button, Text } from 'react-native'

const Schema = z.object({ email: z.string().email('Invalid email') })
type FormValues = z.infer<typeof Schema>

export function EmailForm({ onSubmit }: { onSubmit: (v: FormValues) => void }) {
  const { control, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: { email: '' },
  })

  return (
    <>
      <Controller
        control={control}
        name="email"
        render={({ field: { value, onChange, onBlur } }) => (
          <TextInput
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            autoCapitalize="none"
            keyboardType="email-address"
            accessibilityLabel="Email address"
          />
        )}
      />
      {errors.email && <Text accessibilityRole="alert">{errors.email.message}</Text>}
      <Button title="Save" onPress={handleSubmit(onSubmit)} />
    </>
  )
}
```

## Anti-Patterns

```tsx
// WRONG: large array mapped inside a ScrollView (no virtualization, janky, high memory)
<ScrollView>{items.map((i) => <Row key={i.id} item={i} />)}</ScrollView>
// RIGHT: FlatList / FlashList

// WRONG: server data copied into a client store (two sources of truth, stale data)
const useStore = create((set) => ({ users: [], setUsers: (u) => set({ users: u }) }))
useEffect(() => { getUsers().then(setUsers) }, [])
// RIGHT: useQuery owns server state; derive what you need

// WRONG: tokens in AsyncStorage (not encrypted)
await AsyncStorage.setItem('auth_token', token)
// RIGHT: expo-secure-store

// WRONG: trusting deep-link params
const { id } = useLocalSearchParams(); fetchUser(id)
// RIGHT: validate with Zod before use

// WRONG: inline style object recreated every render on a hot path
<View style={{ padding: 16, backgroundColor: '#fff' }} />
// RIGHT: StyleSheet.create at module scope, or NativeWind className

// WRONG: real secret shipped in the bundle
const STRIPE_SECRET = 'sk_live_...'
// RIGHT: keep privileged calls server-side; ship only public keys protected by backend rules
```

## Best Practices

- Keep route files thin; put logic in screen components and `use*` hooks.
- Validate every external input (API responses, route params, push payloads) with Zod.
- Let TanStack Query own server state; keep client stores small.
- Always render loading, error, and empty states — never just a spinner with no fallback.
- Virtualize lists; memoize `renderItem`; provide a stable `keyExtractor`.
- Use `react-native-reanimated` for animation (UI thread); avoid heavy work on the JS thread.
- Store tokens in `expo-secure-store`; never trust the client for authorization.
- Respect safe areas, Dynamic Type, and accessibility roles/labels from the start.
- Confirm New Architecture compatibility for every native dependency before release.

## Related Skills

- `frontend-patterns` — React/Next.js (web) patterns; useful for shared React concepts, but DOM-specific.
- `coding-standards` — TypeScript/JavaScript idioms that apply to RN code.
- `tdd-workflow`, `e2e-testing` — testing process (use Jest + React Native Testing Library, Maestro/Detox for RN).
- `security-review` — general security checklist that complements the RN bundle/secret guidance above.
