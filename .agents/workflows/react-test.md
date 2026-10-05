---
description: Enforce TDD workflow for React. Write React Testing Library tests first (behavior-focused, accessibility-first), then implement components. Detects Vitest or Jest and verifies coverage targets.
---

# React TDD Command

This command enforces test-driven development for React using React Testing Library plus Vitest or Jest, detected at runtime.

## What This Command Does

1. **Define Component Signature**: Scaffold the component, prop type, and exports
2. **Write Behavior Tests First**: RTL queries (role-first), `userEvent`, MSW for network — RED
3. **Run Tests**: Verify they fail for the right reason
4. **Implement Minimal Code**: Just enough to pass — GREEN
5. **Refactor**: Improve while keeping tests green
6. **Check Coverage**: Hit the targets in [rules/react/testing.md](../rules/react-testing.md)

## When to Use

Use `/react-test` when:

- Implementing a new React component or custom hook
- Adding test coverage to an untested component
- Fixing a bug (write failing test first that reproduces it)
- Building forms, state machines, or accessibility-critical UI
- Onboarding to RTL + Vitest/Jest workflow

## TDD Cycle

```
RED      -> Write failing test for the next behavior
GREEN    -> Implement minimal component code to pass
REFACTOR -> Improve component, tests stay green
REPEAT   -> Next behavior
```

## Runner Detection

```bash
test -f vitest.config.ts -o -f vitest.config.js -o -f vite.config.ts   # Vitest
grep -l '"jest"' package.json                                          # Jest
```

Prefer Vitest for new Vite-based projects; respect Jest for existing setups.

## Example Session

````text
User: /react-test I need a SearchInput component with debounced search

Agent:
# TDD Session: SearchInput

## Step 1: Define Signature

```tsx
// src/components/SearchInput.tsx
type Props = {
  onSearch: (query: string) => void;
  placeholder?: string;
  debounceMs?: number;
};

export function SearchInput({ onSearch, placeholder, debounceMs }: Props) {
  throw new Error("not implemented");
}
```

## Step 2: Write Behavior Tests (RED)

```tsx
// src/components/SearchInput.test.tsx
import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchInput } from "./SearchInput";

describe("SearchInput", () => {
  test("renders with placeholder", () => {
    render(<SearchInput onSearch={() => {}} placeholder="Search users" />);
    expect(screen.getByPlaceholderText("Search users")).toBeInTheDocument();
  });

  test("calls onSearch after typing", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSearch = vi.fn();
    render(<SearchInput onSearch={onSearch} debounceMs={300} />);

    await user.type(screen.getByRole("textbox"), "alice");

    expect(onSearch).not.toHaveBeenCalled();        // before debounce
    vi.advanceTimersByTime(300);
    expect(onSearch).toHaveBeenCalledWith("alice"); // after debounce

    vi.useRealTimers();
  });

  test("does not call onSearch when typing pauses then continues", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSearch = vi.fn();
    render(<SearchInput onSearch={onSearch} debounceMs={300} />);

    await user.type(screen.getByRole("textbox"), "ali");
    vi.advanceTimersByTime(200);                    // mid-debounce
    await user.type(screen.getByRole("textbox"), "ce");
    vi.advanceTimersByTime(300);

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith("alice");

    vi.useRealTimers();
  });

  test("is keyboard reachable and accessible", () => {
    render(<SearchInput onSearch={() => {}} />);
    const input = screen.getByRole("textbox");
    input.focus();
    expect(input).toHaveFocus();
  });
});
```

## Step 3: Run Tests — Verify FAIL

```bash
$ vitest run src/components/SearchInput.test.tsx

× src/components/SearchInput.test.tsx (4 tests) ✘ Error: not implemented
```

✓ Tests fail as expected.

## Step 4: Implement Minimal Code (GREEN)

```tsx
import { useEffect, useState } from "react";

export function SearchInput({ onSearch, placeholder, debounceMs = 300 }: Props) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const id = setTimeout(() => onSearch(query), debounceMs);
    return () => clearTimeout(id);
  }, [query, onSearch, debounceMs]);

  return (
    <input
      type="text"
      value={query}
      placeholder={placeholder}
      onChange={(e) => setQuery(e.target.value)}
    />
  );
}
```

## Step 5: Run Tests — Verify PASS

```bash
$ vitest run src/components/SearchInput.test.tsx

✓ src/components/SearchInput.test.tsx (4 tests) 47ms
```

## Step 6: Coverage

```bash
$ vitest run --coverage src/components/SearchInput.test.tsx

% Stmts: 100  % Branch: 100  % Funcs: 100  % Lines: 100
```

## TDD Complete!
````

## Test Patterns

### Behavior, not implementation

Use `getByRole`, `getByLabelText`, `getByText`. Avoid `container.querySelector` and asserting on component state.

### `userEvent.setup()` per test

```tsx
const user = userEvent.setup();
await user.click(screen.getByRole("button", { name: /save/i }));
```

### MSW for network

```tsx
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

server.use(http.post("/api/users", () => HttpResponse.json({ id: "1" }, { status: 201 })));
```

### Custom hooks

```tsx
const { result } = renderHook(() => useCounter(0));
act(() => result.current.increment());
expect(result.current.count).toBe(1);
```

### Accessibility

```tsx
import { axe } from "vitest-axe";
expect(await axe(container)).toHaveNoViolations();
```

## Coverage Targets

| Layer | Target |
|---|---|
| Pure utilities | >=90% |
| Custom hooks | >=85% |
| Presentational components | >=80% |
| Container components | >=70% |
| Pages | E2E covered separately |

Configure in `vitest.config.ts` / `jest.config.js` to enforce thresholds in CI.

## Anti-Patterns to Avoid

- `container.querySelector(...)` — bypasses accessibility queries
- Asserting on render count
- Mocking `react` itself (`jest.mock("react", ...)`)
- Mocking child components by default (mock only when child has heavy side effects)
- Ignoring `act()` warnings — they signal real bugs
- Snapshot tests of rendered components (brittle, rubber-stamped) — use Playwright/Cypress visual diff instead

## Test Commands

```bash
# Vitest
vitest                              # watch
vitest run                          # one-shot
vitest run --coverage               # with coverage
vitest run path/to/file.test.tsx    # single file

# Jest
jest --watch
jest --coverage
jest path/to/file.test.tsx

# CI mode
CI=true vitest run --coverage
```

## Related Commands

- `/react-build` — fix build errors before running tests
- `/react-review` — review after implementation
- `verification-loop` skill — full verification loop

## Related

- Skills: `skills/react-testing/`, `skills/tdd-workflow/`, `skills/accessibility/`, `skills/e2e-testing/`
- Rules: `rules/react/testing.md`
- Agents: `react-reviewer` (reviews test quality), `tdd-guide` (enforces TDD process)
