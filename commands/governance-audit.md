---
description: Read-only audit of documentation governance and artifact-link integrity. Run deterministic checks first; only after they pass, judge semantic ownership and evidence drift. Never modify files.
argument-hint: "[spine|context|adr|artifacts|full; default: full]"
---

Perform a **read-only documentation governance audit** of the current working directory. Always start with the cheapest decision layer and short-circuit on failure.

## Step 1 — Deterministic Checks

First parse the input: no argument means scope `full`; one of `spine`, `context`, `adr`, `artifacts`, or `full` selects that deterministic scope; `contract` or a repository-relative path is a semantic focus and still runs deterministic scope `full`. Reject any other value before running a command. Then run only the validated scope:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/docs-governance/scripts/audit-cheap.sh" "<validated-scope>"
```

The script uses the reference layout by default. If the project reuses different filenames or locations, first establish `.governance/docs-map.json` as the project's role mapping. Without a mapping, do not treat a different filename as proof that governance is missing.

Scopes: `spine`, `context`, `adr`, `artifacts`, or `full`. Checks include broken paths and links, ADR index integrity, append-only active and archived history, the >200-event threshold, committed derived databases, resurrected deletion-zone paths, and cross-document TEST-ID references.

- Exit code 1: stop. Turn the script output into a report and do not invoke `docs-auditor`. Deterministic failures must be fixed first.
- Exit code 0: continue to semantic review.

## Step 2 — Semantic Review

Invoke **docs-auditor** only for questions the deterministic script cannot settle: CONTEXT boundaries and terminology conflicts, conflicting ADRs, archived material treated as current truth, Spec/Issue/code/TEST-ID/review traceability, evidence behind STATUS metrics, overloaded spine documents, and duplicated sources of truth.

Optional `$ARGUMENTS`:

- no argument: `full`;
- a scope: review only that scope;
- a path or `contract`: run deterministic scope `full`, then emphasize that object in the semantic review without changing the read-only boundary.

Requirements:

1. Do not modify files.
2. Read `.governance/docs-map.json` when present; otherwise discover existing artifacts before falling back to reference role names.
3. Sample map paths and confirm they exist.
4. Treat unmeasured STATUS metrics as `unverified`.
5. Confirm the history role remains append-only.
6. If a contract artifact exists, verify it is the single interface source and is linked to consumer/provider locations.
7. Confirm host entry files remain thin bridges and do not copy the shared charter or map.
8. When the external Issue Tracker is unavailable, mark task state `unverified` rather than inferring completion.
9. Report an overall verdict, P0/P1/P2 findings, evidence, recommendations, and items requiring human confirmation.
10. Return the report in the response by default. Save under `docs/audits/` only when explicitly requested.
