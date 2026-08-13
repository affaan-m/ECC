---
description: Apply living-document governance to an existing project by discovering its real structure, reusing or incrementally updating charter, map, status, and history roles, and adding a thin Codex AGENTS.md bridge when needed.
---

Invoke **docs-governor** for the project in the current working directory.

This command is for an existing codebase. Use `/governance-init` for a new empty project.

Optional `$ARGUMENTS`:

- no argument: discover and govern the complete project;
- a path: limit map/status updates to that module;
- `log: <summary>`: append one event to the mapped or discovered history role and change nothing else.

Requirements:

1. Discover the real project before writing. Never fill templates from assumptions.
2. Read `.governance/docs-map.json` when present and identify existing equivalents. Update incrementally; never rewrite append-only history.
3. Preserve non-overlapping ownership: each fact has one canonical owner.
4. Follow the user's and project's established language; default to English.
5. When the project uses Codex, already has `AGENTS.md`, or requests cross-host compatibility, create or maintain a thin bridge from `skills/docs-governance/templates/AGENTS.example.md`. Do not copy charter or map content.
6. If the repository is Git-based and has no pre-commit hook, ask whether to install the optional reference hook. Do not install it silently.
7. Discover optional artifacts but create them lazily: context for stable domain language, ADRs for hard-to-reverse decisions, and the existing Issue Tracker for tasks and schedules.
8. Run `project-log-index.py status`; it respects the role map. Above 200 events, report and recommend retrospective review. Never archive without confirmation.
9. Report files created or changed, the evidence behind them, and how the user can verify the result. Do not claim completion without reading and changing the project.
