---
name: orch-spec-delta
description: Orchestrate per-PR OpenSpec delta updates — diff code changes against baseline specs, write deltas, classify changes in the plan, update tests, and verify spec compliance. Use before committing any PR that touches spec'd behavior.
origin: ECC
---

# orch-spec-delta

Actor · action · target: **orch · spec · delta**. Thin wrapper over the shared `orch-pipeline` engine, specialized for keeping OpenSpec specs in sync with code changes at PR granularity.

## When to Use

- Before committing a PR that changes spec'd behavior ("update specs for this change")
- After `orch-add-feature` or `orch-change-feature` that touched spec'd modules
- When `spec-freshness-checker` reports STALE or ORPHANED specs on the current branch
- The user says "update specs", "write deltas", or "sync specs with code"

Not for greenfield spec extraction — use `orch-spec-lifecycle` for that.

## Operation Settings

- **Default size floor:** standard — runs Delta Write + Plan + TDD + Review. Small deltas (single file, single spec) collapse to Delta Write + Review.
- **Phase mask:** Δ → 1 → 4 → 5 (delta-writer, planner classify, tdd update, review).
- **Gates:** Gate 1 after delta write (review delta before planning), Gate 2 before commit.
- **First move (phase Δ):** invoke `spec-delta-writer` to compare git diff against baseline specs.

## How It Works

### Phase Δ: Delta Writing (spec-delta-writer)

1. Invoke `spec-delta-writer` on the current branch.
2. It compares `git diff` against `openspec/specs/` baseline, matching behavior by `<!-- id: -->` anchors (not by name).
3. Produces `openspec/deltas/<capability>/delta.md` with three sections:

   ```markdown
   ## ADDED Requirements
   (new behavior not in baseline — new `<!-- id: -->` assigned)

   ## MODIFIED Requirements
   (behavior exists but conditions/outcomes changed — old id preserved)

   ## REMOVED Requirements
   (behavior deleted — old id recorded for traceability)
   ```

4. Cross-validates: every ADDED/MODIFIED/REMOVED entry must reference actual code in the diff.
5. **Gate 1:** Present delta to user. Confirm the classification (ADDED/MODIFIED/REMOVED) is correct before the delta drives planning and testing.

### Phase 1: Plan with Delta Awareness (planner)

1. Invoke `planner` with the delta file as input.
2. Planner's OpenSpec Awareness section consumes the delta:
   - Classifies each change against spec IDs
   - Includes a `## Spec Impact` table in the plan
   - References `<!-- id: -->` anchors for traceability
3. If delta says MODIFIED but the code actually ADDED behavior (or vice versa), planner flags the discrepancy.

### Phase 4: Test Updates (tdd-guide)

1. Invoke `tdd-guide` with the delta and plan.
2. Delta-driven test workflow:
   - `## ADDED Requirements` → write new failing tests for new scenarios
   - `## MODIFIED Requirements` → update existing tests to match updated scenarios
   - `## REMOVED Requirements` → mark corresponding tests as skipped/deprecated
3. If `openspec/tests/` already has skeletons (from `spec-to-test`), fill them. Otherwise write tests from spec Scenarios.
4. Cross-reference after: every ADDED/MODIFIED Scenario has a corresponding test.

### Phase 5: Spec Compliance Verification (code-reviewer)

1. Invoke `code-reviewer` with spec compliance checks enabled.
2. Step-by-step verification:
   - **Step 1 (Find):** Grep changed files against `<!-- enforced: -->` anchors
   - **Step 2 (Invariants):** Verify invariants still hold in changed code
   - **Step 3 (Requirements):** Trace WHEN→THEN through changed code
   - **Step 4 (Delta):** ADDED=exists, MODIFIED=matches, REMOVED=gone
3. Spec violations are HIGH severity — the code disagrees with its documented contract.

### Phase 6: Commit

1. Commit the delta file alongside code changes.
2. Update `Last verified` timestamps on affected specs.
3. **Gate 2:** Confirm before committing.

## Size Classification

| Delta Size | Pipeline | Description |
|------------|----------|-------------|
| **Trivial** | Δ → 5 | Single spec, single file. Delta write + review only. |
| **Small** | Δ → 1 → 5 | 2-5 specs. Delta + plan + review (skip TDD if no new scenarios). |
| **Standard** | Δ → 1 → 4 → 5 | Full pipeline. Most common case. |
| **Large** | Δ → 1 → 4 → 5 + security-reviewer | 10+ specs or security-sensitive paths. |

## Agent Map

| Phase | Agent | Model | Produces |
|-------|-------|-------|----------|
| Δ | spec-delta-writer | opus | `openspec/deltas/<capability>/delta.md` |
| 1 | planner | opus | Plan with `## Spec Impact` table |
| 4 | tdd-guide | sonnet | Updated tests (ADDED/MODIFIED/REMOVED) |
| 5 | code-reviewer | sonnet | Spec compliance report |

## Example

```
orch-spec-delta: update specs for fraud-check PR on nws-poller
→ phase Δ: spec-delta-writer compares diff, produces deltas/orders/delta.md
  - ADDED: FraudCheckService.validate (new)
  - MODIFIED: OrderService.placeOrder (added fraud-check scenario)
  - REMOVED: (none)
  [GATE 1: user confirms delta classification]
→ phase 1: planner consumes delta, produces plan with Spec Impact table
  - OrderService.placeOrder | orders | MODIFIED | Added fraud-check scenario
  - FraudCheckService.validate | orders | ADDED | New fraud detection
→ phase 4: tdd-guide writes 2 new tests for ADDED, updates 1 test for MODIFIED
→ phase 5: code-reviewer verifies:
  - Invariant 'order total = SUM(line_items)' still holds
  - Scenario 'Successful order with fraud check' traceable through code
  - ADDED Requirement FraudCheckService.validate exists in diff
→ phase 6: commit delta + code + tests
  [GATE 2: confirm commit]
```

## Related

- `orch-spec-lifecycle` — full lifecycle for greenfield onboarding / quarterly audits
- `spec-delta-writer` — individual delta generation agent
- `orch-add-feature` — feature addition pipeline (invoke this first, then run delta)
