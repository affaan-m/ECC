---
description: Comprehensive React/JSX code review for hook correctness, render performance, server/client component boundaries, accessibility, and React-specific security. Invokes the react-reviewer agent (and typescript-reviewer alongside on TSX/JSX changes).
---

# React Code Review

This command invokes the **react-reviewer** agent for React-specific code review. For pull requests touching `.tsx`/`.jsx` files, both `react-reviewer` and `typescript-reviewer` should run — each owns a distinct lane.

## What This Command Does

1. **Identify React Changes**: Find modified `.tsx`/`.jsx` files (and React-containing `.ts`/`.js` files) via `git diff`
2. **Run Lint**: Execute `eslint` with `eslint-plugin-react-hooks` and `eslint-plugin-jsx-a11y`
3. **Typecheck**: Run `tsc --noEmit` or the project's canonical typecheck command
4. **Review React Lanes Only**: Hook rules, RSC boundaries, accessibility, render performance, React-specific security
5. **Generate Report**: Categorize issues by severity (CRITICAL / HIGH / MEDIUM)

## When to Use

Use `/react-review` when:

- A PR or commit touches `.tsx`/`.jsx` files
- After writing or modifying React components, custom hooks, or pages
- Before merging React code
- Auditing accessibility on UI components
- Reviewing a new hook for rules-of-hooks and dependency correctness
- Auditing a Next.js App Router server/client component boundary

For pure `.ts`/`.js` changes with no React imports, use `/code-review` (general) or invoke `typescript-reviewer` directly.

## Scope vs `/code-review` and TypeScript Review

| Tool | Scope |
|---|---|
| `react-reviewer` (this command) | Hooks rules, JSX, RSC, a11y, React-specific security, render perf |
| `typescript-reviewer` | Generic TS/JS — `any` abuse, async correctness, Node security |
| `security-reviewer` | Project-wide security audit |
| `/code-review` | Generic uncommitted-changes or PR review |

On a TSX/JSX PR, invoke both `react-reviewer` and `typescript-reviewer`. Findings from each are non-overlapping by design.

## Review Categories

### CRITICAL (Must Fix)

- `dangerouslySetInnerHTML` with unsanitized input
- `href`/`src` with unvalidated user URLs (`javascript:`, `data:`)
- Server Action without input validation
- Secret in client bundle (`NEXT_PUBLIC_*`, `VITE_*`, `REACT_APP_*`)
- `localStorage`/`sessionStorage` for session tokens
- Conditional hook calls (violates Rules of Hooks)
- Direct state mutation
- Hook called outside a component or custom hook

### HIGH (Should Fix)

- Missing `useEffect`/`useMemo`/`useCallback` deps (disabled `exhaustive-deps` without justification)
- Effect for derived state
- Effect missing cleanup
- Stale closures in handlers/intervals
- Server-only imports in Client Components
- Sensitive data leaked via props to Client Components
- Server Actions without auth checks
- Accessibility violations (missing labels, non-semantic interactive elements, ARIA misuse)
- `key={index}` in dynamic lists
- Duplicated state, useEffect chains

### MEDIUM (Consider)

- Over-memoization without measured win
- Inline new object/function as prop to memoized child
- Suspense at route root only (no progressive reveal)
- Long lists without virtualization
- High-frequency value via `useContext`
- Roll-your-own validation in non-trivial forms
- Prop drilling beyond 3 levels
- Component over 200 lines
- Class components in new code

## Automated Checks Run

```bash
# Lint (required for any meaningful review)
npx eslint . --ext .tsx,.jsx,.ts,.js

# Typecheck (skip cleanly for JS-only projects)
npm run typecheck --if-present
[ -f tsconfig.json ] && tsc --noEmit -p tsconfig.json

# Targeted a11y rules
npx eslint . --rule 'jsx-a11y/alt-text: error' \
              --rule 'jsx-a11y/anchor-is-valid: error' \
              --rule 'jsx-a11y/click-events-have-key-events: error'

# Supply-chain
npm audit
```

If `eslint-plugin-react-hooks` or `eslint-plugin-jsx-a11y` is not configured, the review will flag the gap as a HIGH config issue and continue.

## Example Usage

````text
User: /react-review

Agent:
# React Code Review Report

## Files Reviewed
- src/components/UserCard.tsx (modified)
- src/hooks/useUser.ts (new)

## Lint Results
PASS: eslint clean
PASS: typecheck clean

## Issues Found

[CRITICAL] Unsanitized dangerouslySetInnerHTML
File: src/components/UserCard.tsx:42
Issue: User-controlled bio rendered as raw HTML.
Why: XSS via stored script tags in user input.
Fix: Sanitize with DOMPurify or render as text:
```tsx
import DOMPurify from "isomorphic-dompurify";
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(user.bio) }} />
```

[HIGH] Effect cleanup missing
File: src/hooks/useUser.ts:18
Issue: `fetch` call without AbortController; setState on unmounted component possible.
Fix: Add AbortController and cleanup:
```ts
useEffect(() => {
  const ac = new AbortController();
  fetch(`/api/users/${id}`, { signal: ac.signal })
    .then(r => r.json())
    .then(setUser);
  return () => ac.abort();
}, [id]);
```

## Summary
- CRITICAL: 1
- HIGH: 1
- MEDIUM: 0

Recommendation: FAIL: Block merge until CRITICAL issue is fixed
````

## Approval Criteria

| Status | Condition |
|---|---|
| PASS: Approve | No CRITICAL or HIGH issues |
| WARNING: Warning | Only MEDIUM issues (merge with caution) |
| FAIL: Block | CRITICAL or HIGH issues found |

## Integration with Other Commands

- Run `/react-build` first if the build is broken
- Run `/react-test` to ensure component tests pass
- Run `/react-review` before merging
- Use `/code-review` for non-React-specific concerns on the same PR

## Related

- Agent: `agents/react-reviewer.md`
- Companion agent: `agents/typescript-reviewer.md` (run alongside for TSX/JSX PRs)
- Skills: `skills/react-patterns/`, `skills/react-testing/`, `skills/accessibility/`
- Rules: `rules/react/`
