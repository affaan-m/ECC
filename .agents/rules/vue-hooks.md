---
paths:
  - "**/*.vue"
  - "**/*.ts"
  - "**/*.tsx"
---

# Vue Hooks

> This file extends [common/hooks.md](common-hooks.md) with Vue specific content.

## PostToolUse Targets

Run on `*.vue`, `*.ts`, and `*.tsx` after edits. Scope to changed files where possible.

## Typecheck

- Use `vue-tsc --noEmit` for SFC plus TypeScript checking. Plain `tsc` cannot read `.vue` single-file components, so it must not be the typecheck hook for this project.
- Typecheck is project-wide. Debounce or scope it so a save-on-every-keystroke loop does not stall the editor.

## Lint and Format

- `eslint --fix` with `eslint-plugin-vue` (flat-config `vue/vue3-recommended`) covers both template and script lint.
- `prettier --write` for formatting. Prefer Prettier-via-ESLint over a separate Prettier pass to avoid double formatting and fight loops.

## Architecture Boundaries

- Optional: enforce Feature-Sliced Design slice boundaries with `@feature-sliced/steiger` or `eslint-plugin-boundaries` to block deep cross-slice imports.

## Sequencing

```bash
# changed files only
eslint --fix "$FILE"
prettier --write "$FILE"
# project-wide, debounced
vue-tsc --noEmit
```

- Run lint and format per-file first, then the project-wide typecheck last so type errors reflect the formatted source.

## Reference

- ECC skills: `frontend-patterns`, `vite-patterns`.
- Docs: <https://github.com/vuejs/language-tools> (vue-tsc) · <https://eslint.vuejs.org/> · <https://github.com/feature-sliced/steiger>
