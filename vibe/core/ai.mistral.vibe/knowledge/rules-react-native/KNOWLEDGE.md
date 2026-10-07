---
name: rules-react-native
description: ECC react-native engineering rules for coding style, patterns, security, and testing.
display_name: "ECC React Native Rules"
icon: book
---

# ECC React Native Rules

## React Native / Expo Accessibility

> Extends the ECC quality bar to accessibility (a11y). Treat a11y as a release requirement, not an afterthought.
> Target: usable with screen readers (VoiceOver on iOS, TalkBack on Android) and at large font sizes.

### Labeling

- Every interactive element has an `accessibilityRole` and an `accessibilityLabel` (or readable child text).
- Icon-only buttons MUST have an `accessibilityLabel` — there is no visible text for the reader to announce.
- Use `accessibilityHint` only when the action is non-obvious; keep it short.
- Group related elements with `accessible` on the container so they're announced as one unit when appropriate.

```tsx
<Pressable
  accessibilityRole="button"
  accessibilityLabel="Delete item"
  onPress={onDelete}
>
  <TrashIcon />
</Pressable>
```

### State & Live Regions

- Communicate state with `accessibilityState` (e.g. `{ disabled, selected, checked, expanded }`).
- Announce async/transient changes (toasts, validation errors) via `accessibilityLiveRegion` (Android) and `AccessibilityInfo.announceForAccessibility` where needed.
- Reflect loading/error/empty states in text the reader can reach — not just spinners or color.

### Touch Targets & Layout

- Minimum touch target ~44x44pt (iOS) / 48x48dp (Android); use `hitSlop` to enlarge small controls.
- Respect Dynamic Type / font scaling — avoid fixed heights that clip scaled text; test at the largest accessibility font size.
- Honor `prefers-reduced-motion` (`AccessibilityInfo.isReduceMotionEnabled`) — gate non-essential animation.

### Color & Contrast

- Do not convey meaning by color alone; pair with text, icon, or shape.
- Meet WCAG AA contrast: 4.5:1 for body text, 3:1 for large text and meaningful UI/graphical elements.
- Verify both light and dark themes.

### Focus & Navigation

- Logical focus order; move focus to new content (modals, screens) on open and restore on close.
- Ensure custom components are reachable and operable by the screen reader, not just by touch.

### Testing

- Manually test with VoiceOver and TalkBack on real devices — automated checks do not catch everything.
- In component tests, query by role/label (see testing.md) so a11y and tests reinforce each other.
- Add a11y to the pre-release gate: key flows pass a screen-reader walkthrough.

## React Native / Expo Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with React Native / Expo specific content.

### Components

- Define props with a named `interface` or `type`; do not use `React.FC`.
- Keep screens thin: a screen composes hooks + presentational components, it does not hold heavy logic.
- One component per file for anything reusable; co-locate small private subcomponents.
- Prefer function components and hooks. No class components.

```tsx
interface AvatarProps {
  uri: string
  size?: number
  onPress?: () => void
}

export function Avatar({ uri, size = 40, onPress }: AvatarProps) {
  return (
    <Pressable onPress={onPress}>
      <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
    </Pressable>
  )
}
```

### Styling

Pick ONE styling system per project and stay consistent. `StyleSheet.create()` is the framework-native option; utility-class libraries (e.g. NativeWind) are a common alternative. This rule is library-agnostic — what matters is consistency and avoiding inline allocations.

- StyleSheet: define styles with `StyleSheet.create()` at module scope — never build style objects inline inside `render`/JSX on hot paths (it allocates on every render).
- Utility-class approach: extract repeated class strings into shared constants or a variant helper.
- Never hardcode raw colors, spacing, or font sizes scattered across files. Centralize design tokens (theme file or config).

```tsx
// WRONG: inline style object recreated every render
<View style={{ padding: 16, backgroundColor: '#fff' }} />

// CORRECT (StyleSheet)
const styles = StyleSheet.create({ card: { padding: 16, backgroundColor: '#fff' } })
<View style={styles.card} />

// CORRECT (NativeWind)
<View className="p-4 bg-white" />
```

### Platform Differences

- Use platform-specific files (`Component.ios.tsx`, `Component.android.tsx`) for substantial divergence.
- Use `Platform.select()` / `Platform.OS` for small differences only.
- Account for safe areas with `react-native-safe-area-context`; do not hardcode status bar / notch offsets.

### Imports & Project Layout

- Use the Expo/TS path alias (e.g. `@/components/...`) instead of long relative chains.
- Organize by feature/domain, not by type. Keep files focused (200-400 lines typical, 800 max).

### Logging

- No `console.log` in shipped code. Use a logger and strip logs in production builds.
- Surface user-facing errors through UI state, not console.

### TypeScript

All TypeScript rules from `rules/typescript/` apply (explicit types on public APIs, avoid `any`, Zod for validation, immutable updates). This file only adds RN-specific guidance on top.

## React Native / Expo Hooks

> This file extends [common/hooks.md](../common/hooks.md) with React Native / Expo-specific automation guidance.

These are recommended PostToolUse automations to keep RN/Expo code healthy. Wire them in your hook runtime (or run manually); adapt commands to your package manager.

### Suggested PostToolUse checks (on edit of *.ts/*.tsx)

- **Type check:** `tsc --noEmit` — catch type errors early.
- **Lint:** `npx expo lint` (uses `eslint-config-expo`; flat config `eslint.config.js` is the default from SDK 53+).
- **Format:** `prettier --write` on changed files.

### Pre-release / periodic

- `npx expo-doctor` — validates Expo/native dependency health and config.
- `npx expo install --check` — keeps native deps aligned with the installed Expo SDK.
- `npm audit` — dependency vulnerability scan.

### Notes

- Do not run heavy native builds inside fast edit hooks; keep edit-time hooks to typecheck/lint/format.
- Reserve `eas build` / E2E for explicit commands or CI, not per-edit automation.
- Keep these consistent with ECC hook runtime controls (`ECC_HOOK_PROFILE`, `ECC_DISABLED_HOOKS`).

## React Native / Expo Patterns

> This file extends [common/patterns.md](../common/patterns.md) with React Native / Expo specific patterns.
> Note: Do NOT install the `web/` ruleset in a React Native project — those patterns assume the DOM (e.g. URL-as-state) and do not apply here.

### Navigation (Expo Router)

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

### State Management

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

### Data Fetching

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

### Lists

- Use `FlatList`/`SectionList` (or `FlashList` for large/heavy lists) — never `.map()` a large array inside a `ScrollView`.
- Provide a stable `keyExtractor`; memoize `renderItem`.
- Paginate or virtualize long data sets.

### Custom Hooks

- Extract reusable logic (data, permissions, device APIs) into `use*` hooks.
- Keep side effects (Expo SDK calls, subscriptions) inside hooks, not in JSX.

### Async & Effects

- Clean up subscriptions, timers, and listeners in the effect's return function.
- Cancel or ignore stale async results on unmount to avoid setState-after-unmount.

## React Native / Expo Performance

> This file extends [common/performance.md](../common/performance.md) with React Native / Expo specific content.

### Rendering

- Memoize expensive components with `React.memo`; memoize callbacks/values passed to children with `useCallback`/`useMemo` only where they prevent real re-renders.
- Keep component state local and narrow — lifting state too high re-renders large subtrees.
- Avoid creating new objects/arrays/functions inline in props on hot paths; they break memoization.
- Split large screens so a state change re-renders the smallest possible subtree.

### Lists

- Use `FlatList`/`SectionList`, or `FlashList` (Shopify) for large or heterogeneous lists.
- Provide `keyExtractor`, a memoized `renderItem`, and stable item heights when possible (`getItemLayout`).
- Tune `initialNumToRender`, `windowSize`, `maxToRenderPerBatch` for heavy rows.
- Never render large data sets with `.map()` inside a `ScrollView`.

### Images & Assets

- Use `expo-image` for caching, priority, and placeholders; serve appropriately sized images.
- Avoid loading full-resolution images into small thumbnails.

### Animations

- Prefer `react-native-reanimated` (runs on the UI thread) over the JS-driven `Animated` API.
- For legacy `Animated`, set `useNativeDriver: true` where supported.
- Keep heavy computation off the JS thread; offload to Reanimated worklets or native modules.

### Runtime & Build

- Build on the **New Architecture** (Fabric + TurboModules). It is the default in recent Expo SDKs (opt-out still available on SDK 53–54) and is mandatory — cannot be disabled — from SDK 55+. Verify every native dependency is New-Arch compatible before shipping.
- Ensure **Hermes** is enabled (default in modern Expo) for faster startup and lower memory.
- Defer non-critical work after first paint; lazy-load heavy screens/modules.
- Use `InteractionManager.runAfterInteractions` for work that can wait until animations finish.

### Measuring

- Profile with the React DevTools profiler, the Hermes sampling profiler, and the in-app performance monitor. (Avoid Flipper — it is deprecated and not supported on the New Architecture.)
- Watch for: long lists without virtualization, oversized images, frequent full-tree re-renders, and synchronous work on the JS thread.

## React Native / Expo Production Readiness

> Extends the ECC philosophy to ship-grade concerns that style/pattern rules cannot encode by themselves.
> A clean codebase is necessary but not sufficient for production — these items are mandatory before release.

### Architecture

- Ship on the **New Architecture** (Fabric + TurboModules). It is the default in recent Expo SDKs and is mandatory (cannot be disabled) from SDK 55+. Audit native deps for compatibility.
- Pin the Expo SDK version; upgrade deliberately with `npx expo install --check` and test on both platforms.

### Build & Release (EAS)

- Use **EAS Build** for production binaries and **EAS Submit** for store delivery. Do not rely on local ad-hoc builds for release.
- Keep separate build profiles (`development`, `preview`, `production`) in `eas.json`.
- Manage signing credentials via EAS; never commit keystores or provisioning profiles.

### Over-the-Air Updates

- Use **EAS Update** (`expo-updates`) for JS-only fixes, with a defined runtime version policy.
- Never push native changes via OTA — those require a new store build.
- Roll out gradually and keep the ability to roll back.

### Observability

- Integrate crash + error reporting (e.g. **Sentry** via `@sentry/react-native`) in production builds.
- Add structured logging and, where useful, analytics — but strip verbose logs from release.
- Capture and surface failed network/mutation states; do not fail silently.

### Configuration & Versioning

- Bump `version` and `ios.buildNumber` / `android.versionCode` per release.
- Public config via `EXPO_PUBLIC_*`; real secrets via EAS secrets only.
- Validate required config at startup and fail fast with a clear message.

### Pre-Release Gate

Before shipping, all must pass:

- [ ] `tsc --noEmit` clean
- [ ] `npx expo lint` clean
- [ ] Tests green, coverage >= 80% (see testing.md)
- [ ] `npx expo-doctor` healthy
- [ ] Critical-flow E2E (Maestro/Detox) pass on a real build
- [ ] No secrets in bundle (see security.md)
- [ ] Crash reporting active and verified
- [ ] Tested on physical iOS and Android devices, not just simulators

## React Native / Expo Security

> This file extends [common/security.md](../common/security.md) with React Native / Expo specific content.
> The mandatory pre-commit checklist and Security Response Protocol from common/security.md still apply.

### The Bundle Is Public

Treat everything shipped in the app as readable by an attacker. A mobile binary can be unpacked.

- NEVER ship real secrets (private API keys, service-role keys, signing secrets) in the JS bundle or `app.config`.
- Public/anon keys (e.g. Supabase anon key, Firebase config) are acceptable ONLY when protected by server-side rules (RLS, security rules). Enforce authorization on the backend, never in the client.
- Keep privileged operations behind your own server / edge functions.

### Secret & Token Storage

- Store auth tokens and sensitive values in `expo-secure-store` (Keychain / Keystore) — never in `AsyncStorage` or plain MMKV.
- Do not persist secrets in Redux/Zustand state that may be serialized to disk.

### Configuration

- Read environment via `expo-constants` / `app.config.ts` `extra`, and `EXPO_PUBLIC_*` only for genuinely public values.
- Keep build secrets in EAS secrets, not in the repo.

### Network & Data

- HTTPS only; reject cleartext. Consider certificate pinning for high-risk apps.
- Validate ALL external data (API responses, deep-link params, push payloads) with Zod before use.
- Validate and sanitize deep links and universal links — never route or grant access based on unvalidated params.

### Permissions & Privacy

- Request the minimum device permissions, at the moment they are needed, with clear rationale.
- Declare data collection accurately for App Store / Play Store privacy disclosures.

### Dependencies

- Run `expo-doctor` and `npm audit` regularly; keep the Expo SDK and native deps current.
- Use `/security-scan` (AgentShield) on the agent configuration itself.

## React Native / Expo Testing

> This file extends [common/testing.md](../common/testing.md) with React Native / Expo specific content.
> Coverage target and TDD workflow are inherited from common/testing.md (80% minimum, RED-GREEN-REFACTOR).

### Tooling

| Layer | Tool |
|-------|------|
| Unit / component | Jest + `@testing-library/react-native` (via `jest-expo` preset) |
| Hooks | `@testing-library/react-native` `renderHook` |
| E2E | Maestro (recommended, simple YAML flows) or Detox |
| Type safety | `tsc --noEmit` in CI |

### Component Tests

- Query by accessible role/label/text, not by `testID` unless necessary — this also enforces accessibility.
- Assert on user-visible behavior, not implementation details.
- Follow Arrange-Act-Assert.

```tsx
import { render, screen, fireEvent } from '@testing-library/react-native'

test('calls onSelect with the user id when pressed', () => {
  const onSelect = jest.fn()
  render(<UserCard user={{ id: '1', email: 'a@b.com' }} onSelect={onSelect} />)

  fireEvent.press(screen.getByText('a@b.com'))

  expect(onSelect).toHaveBeenCalledWith('1')
})
```

### Mocking

- Mock Expo SDK modules (camera, location, notifications, secure-store) at the test boundary.
- Wrap components that use TanStack Query in a `QueryClientProvider` with a fresh client per test.
- Mock navigation (`expo-router`) so screens render in isolation.

### E2E

- Cover critical flows only: auth, primary navigation, core transactions.
- Run E2E on CI against a built app (EAS Build) before release.

### What to test first

Use the `tdd-guide` agent proactively for new features: write a failing test that captures the behavior, then implement.
