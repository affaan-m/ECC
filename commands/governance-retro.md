---
description: Review append-only project history to find modules and defect classes that recur, detect standard drift, and propose repeated failures for deterministic tests, lint, or schema checks.
argument-hint: "[no arguments; reviews all active and archived history]"
---

Perform a **read-only retrospective** over the mapped or discovered history artifact.

This command inspects all active and archived history. Reject arguments rather than silently ignoring a requested cutoff.

1. Run `python3 "${CLAUDE_PLUGIN_ROOT}/skills/docs-governance/scripts/project-log-index.py" status --root "${CLAUDE_PROJECT_DIR:-$PWD}"`. Count events by `## [date] type | summary`, not physical lines.
2. Read `history` and `history_archive` from `.governance/docs-map.json`; otherwise use the default history names. The SQLite index may accelerate queries, but every conclusion must trace back to Markdown. Stop if no history exists.
3. Aggregate:
   - top five modules/files named in fix events;
   - root-cause classes that appear at least twice;
   - every standards-change event, including old value, new value, and reason; flag standards repeatedly relaxed in one direction;
   - longest audit interval and the number of commits across it.
4. Produce a **durable-guard candidate list**. A repeated defect has not yet been owned by a deterministic guard; recommend regression tests, lint, or schema validation and link the appropriate TEST-ID format from `test-collaboration`.
5. Return the retrospective without changing files.
6. Only after the event count exceeds 200 and the user explicitly confirms may a separate action run `project-log-index.py archive --yes`. Archived Markdown remains the source; task state and scheduling stay in the Issue Tracker.

This command judges patterns but does not implement fixes or archive history automatically.
