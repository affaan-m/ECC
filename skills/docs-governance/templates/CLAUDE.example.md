# CLAUDE.md — Project Charter

> Keep this file short. Link details elsewhere; if it grows beyond one page, move details to the artifact that owns them and leave only a pointer here.

## Session Reading Order

Read this file in full and the red-line block at the top of `PROJECT_STATUS.md` by default.

Read `CLAUDE_MAP.md` only when locating a file, understanding non-obvious directory responsibility, or learning the overall structure. Before creating, deleting, renaming, or changing files across modules, read both `CLAUDE_MAP.md` and the STATUS deletion zone. Use `ls` or glob for ordinary directory structure; do not freeze or duplicate the tree here. See the `living-docs-governance` skill for the complete tiered-reading protocol.

## Hard Rules

> The first 10–15 rules usually provide the highest leverage. More rules reduce compliance, and an overloaded charter is itself documentation decay. Stop when the essentials are covered.

- Use UTF-8 for all files.
- Use absolute imports; do not use `from . import ...`.
- Do not create a new file unless explicitly requested; edit the existing implementation instead of creating `main_v2.py`.
- `{add project-specific naming, commit, and verification rules}`

## Pointers

- Project structure and where to find things → `CLAUDE_MAP.md`
- Current health, red lines, and intentionally deleted items → `PROJECT_STATUS.md`
- What changed and why → `PROJECT_LOG.md`
- Stable domain terminology → `CONTEXT.md` when enabled
- Hard-to-reverse architecture or database decisions → the repository's ADR index when enabled
- Tasks, ownership, blockers, and scheduling → the project's existing Issue Tracker; do not copy them into STATUS or LOG
