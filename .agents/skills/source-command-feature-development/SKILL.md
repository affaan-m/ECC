---
name: "source-command-feature-development"
description: "Workflow command scaffold for feature-development in everything-Codex."
---

# source-command-feature-development

Use this skill when the user asks to run the migrated source command `feature-development`.

## Command Template

# /feature-development

Use this workflow when working on **feature-development** in `everything-Codex`.

## Goal

Standard feature implementation workflow

## Common Files

- `manifests/*`
- `schemas/*`
- `**/*.test.*`
- `**/api/**`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Add feature implementation
- Add tests for feature
- Update documentation

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.
