---
description: Fix React build failures (Vite, webpack, Next.js, CRA, Parcel, esbuild, Bun) incrementally — JSX/TSX compile errors, hydration mismatches, server/client component boundary failures, missing types. Invokes the react-build-resolver agent for minimal, surgical fixes.
---

# React Build and Fix

This command invokes the **react-build-resolver** agent to incrementally fix React build errors with minimal changes.

## What This Command Does

1. **Detect Build System**: Identify Vite, webpack, Next.js, CRA, Parcel, esbuild, or Bun
2. **Run Build**: Execute the project's build script
3. **Parse Errors**: Group by layer (TypeScript / bundler config / runtime / hydration)
4. **Fix Incrementally**: One error at a time, re-running build after each change
5. **Report Summary**: Show what was fixed and what remains

## When to Use

Use `/react-build` when:

- `npm run build` (or pnpm/yarn/bun equivalent) fails
- JSX/TSX compile errors after a TypeScript or React upgrade
- Next.js hydration mismatch errors at runtime
- Server/Client Component boundary errors in App Router
- After installing or upgrading `react`, `react-dom`, `@types/react`, or a bundler
- Missing types or "module not found" errors involving React

## Scope

This command owns **React build/bundler/runtime hydration** failures. For pure TypeScript type errors with no React involvement, use `/build-fix` (generic) instead.

## Diagnostic Commands Run

```bash
# Project build script (preferred)
npm run build --if-present
pnpm build 2>/dev/null
yarn build 2>/dev/null
bun run build 2>/dev/null

# Standalone typecheck
npm run typecheck --if-present
tsc --noEmit -p tsconfig.json

# Bundler-specific fallback
next build                          # Next.js
vite build                          # Vite
react-scripts build                 # CRA
webpack --mode=production           # webpack
parcel build src/index.html         # Parcel
bun build ./src/index.tsx --outdir=dist
```

## Example Session

````text
User: /react-build

Agent:
# React Build Resolution

## Build System Detected
Vite (vite.config.ts present, @vitejs/plugin-react in deps)

## Initial Diagnostics

```bash
$ npm run build
> tsc -b && vite build

src/components/UserCard.tsx:1:8 - error TS6133: 'React' is declared but its value is never read.
src/components/Modal.tsx:12:15 - error TS7016: Could not find a declaration file for module 'react-portal'.
src/pages/Home.tsx:42:5 - error: 'useState' is not defined
```

Errors found: 3

## Fix 1: Old JSX transform leftover

File: src/components/UserCard.tsx:1
Cause: `tsconfig.json` already uses `"jsx": "react-jsx"`; the explicit `import React` is unused.

```tsx
// Removed
- import React from 'react';
```

```bash
$ npm run build
# 2 errors remaining
```

## Fix 2: Missing types

File: src/components/Modal.tsx
Cause: `@types/react-portal` not installed.

```bash
$ npm i -D @types/react-portal
added 1 package
```

```bash
$ npm run build
# 1 error remaining
```

## Fix 3: Missing hook import

File: src/pages/Home.tsx
Cause: `useState` referenced but not imported.

```tsx
- import { useEffect } from "react";
+ import { useEffect, useState } from "react";
```

```bash
$ npm run build
# Build successful!
```

## Final Verification

```bash
$ npm run build
✓ built in 2.34s

$ npm test
✓ 47 tests passed
```

## Summary

| Metric | Count |
|--------|-------|
| Build errors fixed | 3 |
| Files modified | 2 |
| Dependencies added | 1 (@types/react-portal) |
| Remaining issues | 0 |

Build Status: PASS: SUCCESS
````

## Common Errors Fixed

| Error | Typical Fix |
|---|---|
| `'React' is not defined` | Set `"jsx": "react-jsx"` in tsconfig (React 17+) |
| Missing `@types/react` | `npm i -D @types/react @types/react-dom` |
| `Unexpected token '<'` | Add `@vitejs/plugin-react` / `babel-loader` |
| `You're importing a component that needs useState` (Next.js) | Add `"use client"` or move hook to a Client Component child |
| `Module not found: Can't resolve 'fs'` (Next.js) | Remove `fs` import or move logic into Server Component / API route |
| `Hydration failed because the initial UI does not match` | Move `Date.now()`/`Math.random()`/`window.*` to `useEffect` |
| `Invalid hook call` | Multiple React copies — dedupe via `resolutions`/`overrides` |
| `Element type is invalid` | Default vs named import mismatch |

## Fix Strategy

1. **Compile errors first** — code must build
2. **Hydration errors second** — affects production correctness
3. **Bundler config third** — restore plugin/loader correctness
4. **One fix at a time** — verify each change
5. **Minimal changes** — never `// @ts-ignore` without explanation
6. **Re-run after each fix** — surface new errors immediately

## Stop Conditions

The agent will stop and report if:

- Same error persists after 3 attempts
- Fix introduces more errors than it resolves
- Requires architectural change beyond build resolution (e.g., redesigning the RSC boundary)
- Bundler version no longer supports the installed React major

## Related Commands

- `/react-test` — run tests after the build is green
- `/react-review` — review code quality after the build succeeds
- `/build-fix` — generic build fixer (non-React)
- `verification-loop` skill — full verification loop

## Related

- Agent: `agents/react-build-resolver.md`
- Skills: `skills/react-patterns/`, `skills/frontend-patterns/`
- Rules: `rules/react/coding-style.md`, `rules/react/patterns.md`
