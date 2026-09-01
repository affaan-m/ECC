---
name: "source-command-database-migration"
description: "Workflow command scaffold for database-migration in everything-Codex."
---

# source-command-database-migration

Use this skill when the user asks to run the migrated source command `database-migration`.

## Command Template

# /database-migration

Use this workflow when working on **database-migration** in `everything-Codex`.

## Goal

Database schema changes with migration files

## Common Files

- `**/schema.*`
- `migrations/*`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Create migration file
- Update schema definitions
- Generate/update types

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.
