# Candidate Playbook: Maintainer-Owned Stale Salvage

Candidate id: `maintainer-salvage-branch`

## Use When

- A stale or conflicted PR was closed to keep the public queue usable.
- The closed diff contains a useful focused idea, skill, command, doc, test, or
  bug fix.
- The contributor may not have time or interest to rebase.

## Steps

1. Record the source PR, author, useful concept, and closure reason in
   `docs/stale-pr-salvage-ledger.md`.
2. Re-read the closed PR diff against current `main`.
3. Decide whether the patch can be cherry-picked safely. Prefer reimplementation
   when current architecture has moved.
4. Create a maintainer-owned branch with one focused salvage unit.
5. Preserve attribution in the PR body and, when useful, in the commit body.
6. Update the catalog, docs, tests, or release evidence required by the touched
   surface.
7. Run the same validation gates a normal change would require.
8. After merge, update the ledger from pending/salvage-branch to landed,
   already-present, superseded, skipped, or translator/manual review.

## Reject Conditions

- The patch is bulk generated churn.
- The patch is stale localization that needs translator/manual review.
- The patch imports personal paths, secrets, local settings, or private operator context.
- The patch bypasses current install, catalog, plugin, or release architecture.
- The branch would mix unrelated salvage units into one PR.

## Minimum Validation

- Targeted test for the touched surface.
- `git diff --check`.
- Markdown lint when docs are touched.
- Catalog/install validation when skills, agents, commands, or plugin surfaces
  are touched.
