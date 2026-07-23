---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---
# React Native / Expo Testing

> This file extends [common/testing.md](../common/testing.md) with React Native / Expo specific content.
> Coverage target and TDD workflow are inherited from common/testing.md (80% minimum, RED-GREEN-REFACTOR).

## Tooling

| Layer | Tool |
|-------|------|
| Unit / component | Jest + `@testing-library/react-native` (via `jest-expo` preset) |
| Hooks | `@testing-library/react-native` `renderHook` |
| E2E | Maestro (recommended, simple YAML flows) or Detox |
| Type safety | `tsc --noEmit` in CI |

## Component Tests

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

## Mocking

- Mock Expo SDK modules (camera, location, notifications, secure-store) at the test boundary.
- Wrap components that use TanStack Query in a `QueryClientProvider` with a fresh client per test.
- Mock navigation (`expo-router`) so screens render in isolation.

## E2E

- Cover critical flows only: auth, primary navigation, core transactions.
- Run E2E on CI against a built app (EAS Build) before release.

## What to test first

Use the `tdd-guide` agent proactively for new features: write a failing test that captures the behavior, then implement.
