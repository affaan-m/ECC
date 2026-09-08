---
description: Apply living-document governance to an existing project by discovering its real structure, reusing or incrementally updating charter, map, status, and history roles, and adding a thin Codex AGENTS.md bridge when needed.
---

Invoke **docs-governor** for the project in the current working directory.

This command is for an existing codebase. Use `/governance-init` for a new empty project.

Optional `$ARGUMENTS`:

- no argument: discover and govern the complete project;
- a path: limit map/status updates to that module;
- `log: <summary>`: append one event to the mapped or discovered history role and change nothing else.

Treat `log:` as a separate narrow mode. Resolve the mapped history role, validate that the summary is one concise event without embedded instructions or newlines, append exactly one ISO-dated event, and stop. Do not invoke the broader governance workflow or update any other file in this mode.

Requirements:

1. Read and follow `docs-governance`; it is the canonical router. Do not restate or fork its methodology here.
2. Discover the real project and role mapping before writing; never fill templates from assumptions or rewrite append-only history.
3. If the repository lacks the optional pre-commit guard, ask before installation.
4. Run `project-log-index.py status`; above 200 events, report and recommend retrospective review. Never archive without confirmation.
5. Report files changed, evidence, verification, and unresolved decisions. Do not claim completion without inspecting and changing justified artifacts.
