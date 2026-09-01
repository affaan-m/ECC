---
name: "source-command-add-language-rules"
description: "Workflow command scaffold for add-language-rules in everything-Codex."
---

# source-command-add-language-rules

Use this skill when the user asks to run the migrated source command `add-language-rules`.

## Command Template

# /add-language-rules

Use this workflow when working on **add-language-rules** in `everything-Codex`.

## Goal

Adds a new programming language to the rules system, including coding style, hooks, patterns, security, and testing guidelines.

When the request is ambiguous or edge cases arise, prefer to ask a clarifying question rather than guess; by default create placeholders (see Suggested Sequence step 2).

## Common Files

- `rules/*/coding-style.md`
- `rules/*/hooks.md`
- `rules/*/patterns.md`
- `rules/*/security.md`
- `rules/*/testing.md`

Each file must include at minimum these sections: `Purpose`, `Recommended Rules`, `Examples` (3 short examples), and `Automated Checks` (commands or linters to verify rules).

## Suggested Sequence

1. Discover the current state and failure mode before editing. To understand state, run: (a) list existing rules directories (for example `ls rules`), (b) run repository tests (for example `node tests/run-all.js` or the project's test command), and (c) check open issues/PRs mentioning the language. If tests fail, include the failing commands and captured outputs in your summary.

2. Make the smallest coherent change that satisfies the workflow goal: prefer adding placeholder files under `rules/{language}/` with the required headings (`Purpose`, `Recommended Rules`, `Examples`, `Automated Checks`). Only populate full, detailed content if the user explicitly requests it. If the user request is `add-language-rules` with no further instruction, create `rules/{language}/` and add the five files as placeholders with the required headers.

3. Run the following verifications in order for touched files: (a) repository unit tests (run `node tests/run-all.js` or the project's test command), (b) repository linters (e.g. `npm run lint` or `npx markdownlint-cli`), (c) language-specific linter for `rules/{language}/` (e.g. `eslint`, `rubocop`), and (d) run CI workflow if available (for example `gh workflow run <workflow>`). If any verification fails, halt further changes and return: (A) the failing command, (B) the captured output, and (C) suggested next steps (revert, fix, or open PR).

4. Summarize what changed and what still needs review using this bulleted format: (A) list of created/modified files, (B) one-sentence rationale per file, (C) outstanding review items (max 5), and (D) verification status per item.

If the user does not supply a language identifier and required metadata, ask: "Which language should be added? Provide language id, canonical name, and any reference style guides or example repos."

## Typical Commit Signals

- Create a new directory under rules/{language}/
- Add coding-style.md, hooks.md, patterns.md, security.md, and testing.md files with language-specific content
- Optionally reference or link to related skills

If `rules/{language}/` already exists, do not overwrite it. Stop and ask the user: "The directory rules/{language}/ already exists. Reply with one of: (a) abort, (b) create rules/{language}-v2, or (c) merge — provide a merge plan." Do not overwrite without explicit confirmation.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.
 - If you encounter edge cases not covered by these steps, ask the user a clarifying question rather than making unilateral, large changes.
