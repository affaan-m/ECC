---
description: Synchronize project governance at stage closeout from the actual diff: spine, CONTEXT, ADR, CONTRACT, TESTS, REGRESSION, and Issue Tracker references.
argument-hint: "[what this stage completed]"
---

Invoke **docs-governor** to perform a stage-closeout synchronization in the current working directory.

Optional `$ARGUMENTS`:

- no argument: inspect current project state, recent changes, and governance artifacts;
- one sentence: treat it as the user-confirmed stage outcome;
- `contract`: emphasize whether the interface contract must be synchronized.

Requirements:

1. Read `living-docs-governance` and `skills/docs-governance/references/governance-sync-matrix.md` first.
2. Inventory the session outcome, recently modified files, project structure, actual diff, and existing governance artifacts.
3. Use the matrix to route updates:
   - structure/entry changes → project map;
   - health/risk/deletion changes → project status;
   - durable hard rules → shared charter;
   - meaningful outcomes → append-only history;
   - interface fields → contract artifact;
   - stable domain language → context artifact when enabled;
   - hard-to-reverse decisions → ADR methodology;
   - success criteria and evidence → Spec/Issue plus TEST-ID registry;
   - module behavior and downstream commands → regression ledger.
4. Update evidence-backed current truth incrementally. Put uncertain items under `Needs confirmation` instead of inventing them.
5. Reconcile the planned impact from `change-impact` with the actual diff, including out-of-scope work, unverified items, and temporary compatibility logic.
6. History remains append-only. Archive only after the deterministic >200-event threshold and explicit user confirmation.
7. Report artifacts actually changed, why each changed, artifacts intentionally unchanged, and items requiring human confirmation.
