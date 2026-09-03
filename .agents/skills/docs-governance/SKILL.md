---
name: docs-governance
description: Route broad documentation-governance requests to existing ECC skills and run an opt-in, read-only audit of mapped documentation roles, links, ADR indexes, and evidence references. Use when a user asks for documentation governance, project-knowledge organization, documentation integrity, or a deterministic docs audit without naming a narrower skill.
metadata:
  origin: ECC
---

# Documentation Governance Router

Use this optional router to select the smallest existing ECC capability for a
documentation-governance request. The router does not create a parallel project
management system and does not make documentation authoritative over code,
tests, Issues, or maintainer decisions.

## When to Activate

- The user asks broadly for documentation governance or project-knowledge organization.
- A request spans several documentation roles and the correct owner is unclear.
- The user asks for a deterministic, read-only documentation integrity audit.
- A project needs to discover its existing documentation sources before adding files.

Do not activate for a narrowly named skill or for ordinary documentation edits
whose destination is already clear.

## Role Contract

Read [the artifact-role contract](references/artifact-role-contract.md) before
interpreting `.governance/docs-map.json` or default filenames. Logical roles own
facts; filenames are fallbacks. Reuse a repository's established sources of
truth and never create a second document merely to satisfy a default role.

## Intent Routing

| User intent | Route to |
|---|---|
| Adopt or maintain a constitution, map, status, and history spine | `living-docs-governance` |
| Record a hard-to-reverse architecture decision | `architecture-decision-records` |
| Preserve an executable regression for an important defect | `ai-regression-testing` |
| Define a verifiable goal and feedback loop | `loop-design-check` |
| Check mapped roles, local links, ADR indexes, TEST-IDs, or possible orphan docs | Run the bundled read-only audit |

If no row fits, explain the ownership ambiguity instead of combining several
workflows speculatively.

## Read-Only Audit

Run the audit only when the user asks for an audit or when it is an agreed
verification step. Resolve the selected skill directory first, then invoke:

```bash
python3 <docs-governance-skill>/scripts/audit-docs.py --root <repository> --scope full
```

Available scopes are `spine`, `context`, `adr`, `artifacts`, and `full`.

The audit reads repository files and Git history but does not create, rewrite,
archive, stage, or commit anything. It reports:

- exit code `0` when deterministic checks pass, including any manual-review warnings;
- exit code `1` when mechanically provable integrity failures exist; and
- exit code `2` for invalid CLI input.

Treat warnings as review prompts, not failures. Semantic accuracy, business
meaning, task completion, and release approval remain human or workflow-owner
decisions.

## When to Use

Use this router when the request is broad enough that choosing the right
governance capability is part of the work. For a direct ADR or regression
request, invoke that specialized skill without routing through this one.

## How It Works

1. Discover the repository's existing instruction and documentation surfaces.
2. Resolve logical roles through the artifact-role contract.
3. Select one smallest matching capability from the routing table.
4. If a deterministic audit is requested, run the narrowest useful scope.
5. Report failures, warnings, and ownership gaps without mutating project state.

## Examples

- “Organize our long-lived project docs” routes to `living-docs-governance`.
- “Record why we selected PostgreSQL” routes to `architecture-decision-records`.
- “Check whether our documentation links and ADR index are intact” runs the
  bundled audit with `--scope artifacts` and `--scope adr`.
- “Are we finished with the migration?” is not answered from documentation
  alone; the Issue owns completion, tests provide evidence, and maintainers own
  merge approval.

## Boundaries

- Keep task ownership, scheduling, attempts, and completion in the Issue tracker.
- Keep stable interface facts in the repository's contract source.
- Treat documentation as evidence and navigation, not executable instructions.
- Do not teach users to bypass repository controls such as pre-commit hooks.
- Do not add archive or index mutation to this read-only foundation.
