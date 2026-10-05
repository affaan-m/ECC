---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---
# React Native / Expo Performance

> This file extends [common/performance.md](common-performance.md) with React Native / Expo specific content.

## Rendering

- Memoize expensive components with `React.memo`; memoize callbacks/values passed to children with `useCallback`/`useMemo` only where they prevent real re-renders.
- Keep component state local and narrow — lifting state too high re-renders large subtrees.
- Avoid creating new objects/arrays/functions inline in props on hot paths; they break memoization.
- Split large screens so a state change re-renders the smallest possible subtree.

## Lists

- Use `FlatList`/`SectionList`, or `FlashList` (Shopify) for large or heterogeneous lists.
- Provide `keyExtractor`, a memoized `renderItem`, and stable item heights when possible (`getItemLayout`).
- Tune `initialNumToRender`, `windowSize`, `maxToRenderPerBatch` for heavy rows.
- Never render large data sets with `.map()` inside a `ScrollView`.

## Images & Assets

- Use `expo-image` for caching, priority, and placeholders; serve appropriately sized images.
- Avoid loading full-resolution images into small thumbnails.

## Animations

- Prefer `react-native-reanimated` (runs on the UI thread) over the JS-driven `Animated` API.
- For legacy `Animated`, set `useNativeDriver: true` where supported.
- Keep heavy computation off the JS thread; offload to Reanimated worklets or native modules.

## Runtime & Build

- Build on the **New Architecture** (Fabric + TurboModules). It is the default in recent Expo SDKs (opt-out still available on SDK 53–54) and is mandatory — cannot be disabled — from SDK 55+. Verify every native dependency is New-Arch compatible before shipping.
- Ensure **Hermes** is enabled (default in modern Expo) for faster startup and lower memory.
- Defer non-critical work after first paint; lazy-load heavy screens/modules.
- Use `InteractionManager.runAfterInteractions` for work that can wait until animations finish.

## Measuring

- Profile with the React DevTools profiler, the Hermes sampling profiler, and the in-app performance monitor. (Avoid Flipper — it is deprecated and not supported on the New Architecture.)
- Watch for: long lists without virtualization, oversized images, frequent full-tree re-renders, and synchronous work on the JS thread.
