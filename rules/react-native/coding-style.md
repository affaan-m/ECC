---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---
# React Native / Expo Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with React Native / Expo specific content.

## Components

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

## Styling

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

## Platform Differences

- Use platform-specific files (`Component.ios.tsx`, `Component.android.tsx`) for substantial divergence.
- Use `Platform.select()` / `Platform.OS` for small differences only.
- Account for safe areas with `react-native-safe-area-context`; do not hardcode status bar / notch offsets.

## Imports & Project Layout

- Use the Expo/TS path alias (e.g. `@/components/...`) instead of long relative chains.
- Organize by feature/domain, not by type. Keep files focused (200-400 lines typical, 800 max).

## Logging

- No `console.log` in shipped code. Use a logger and strip logs in production builds.
- Surface user-facing errors through UI state, not console.

## TypeScript

All TypeScript rules from `rules/typescript/` apply (explicit types on public APIs, avoid `any`, Zod for validation, immutable updates). This file only adds RN-specific guidance on top.
