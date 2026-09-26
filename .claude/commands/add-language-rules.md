---
name: add-language-rules
description: Workflow command scaffold for add-language-rules in everything-claude-code.
allowed-tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-language-rules

Use this workflow when working on **add-language-rules** in `everything-claude-code`.

## Goal

Adds a new programming language to the rules system, including coding style, hooks, patterns, security, and testing guidelines.

## Common Files

- `rules/*/coding-style.md`
- `rules/*/hooks.md`
- `rules/*/patterns.md`
- `rules/*/security.md`
- `rules/*/testing.md`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Create a new directory under rules/{language}/
- Add coding-style.md, hooks.md, patterns.md, security.md, and testing.md files with language-specific content
- Optionally reference or link to related skills

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.