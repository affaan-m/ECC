---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---
# React Native / Expo Accessibility

> Extends the ECC quality bar to accessibility (a11y). Treat a11y as a release requirement, not an afterthought.
> Target: usable with screen readers (VoiceOver on iOS, TalkBack on Android) and at large font sizes.

## Labeling

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

## State & Live Regions

- Communicate state with `accessibilityState` (e.g. `{ disabled, selected, checked, expanded }`).
- Announce async/transient changes (toasts, validation errors) via `accessibilityLiveRegion` (Android) and `AccessibilityInfo.announceForAccessibility` where needed.
- Reflect loading/error/empty states in text the reader can reach — not just spinners or color.

## Touch Targets & Layout

- Minimum touch target ~44x44pt (iOS) / 48x48dp (Android); use `hitSlop` to enlarge small controls.
- Respect Dynamic Type / font scaling — avoid fixed heights that clip scaled text; test at the largest accessibility font size.
- Honor `prefers-reduced-motion` (`AccessibilityInfo.isReduceMotionEnabled`) — gate non-essential animation.

## Color & Contrast

- Do not convey meaning by color alone; pair with text, icon, or shape.
- Meet WCAG AA contrast: 4.5:1 for body text, 3:1 for large text and meaningful UI/graphical elements.
- Verify both light and dark themes.

## Focus & Navigation

- Logical focus order; move focus to new content (modals, screens) on open and restore on close.
- Ensure custom components are reachable and operable by the screen reader, not just by touch.

## Testing

- Manually test with VoiceOver and TalkBack on real devices — automated checks do not catch everything.
- In component tests, query by role/label (see testing.md) so a11y and tests reinforce each other.
- Add a11y to the pre-release gate: key flows pass a screen-reader walkthrough.
