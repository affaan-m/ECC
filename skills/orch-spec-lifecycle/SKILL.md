---
name: orch-spec-lifecycle
description: Orchestrate the full OpenSpec lifecycle — mine specs from brownfield code, fuzz for weaknesses, generate test skeletons, implement tests via TDD, and verify spec compliance. Use when onboarding a project to spec-driven development or running a quarterly spec audit.
origin: ECC
---

# orch-spec-lifecycle

Actor · action · target: **orch · spec · lifecycle**. Delegates each phase to the matching ECC agent: `spec-miner` → `spec-fuzzer` → `spec-to-test` → `tdd-guide` → `code-reviewer`. Optionally gates on `spec-freshness-checker` between phases.

## When to Use

- Onboarding a brownfield project to spec-driven development ("extract specs from this codebase")
- Quarterly spec health audit ("audit all specs, re-mine stale ones, refresh test coverage")
- After a major refactor that invalidated many specs ("re-extract specs post-refactor")
- The user says "mine specs", "extract behaviors", or "generate specs from this"

Not for per-PR delta updates — use `orch-spec-delta` for those.

## Operation Settings

- **Default size floor:** heavy — always runs Research (spec discovery) + Plan (scope classification).
- **Phase mask:** 0 → 1 → 2 → 3 → 4 → 5 (full pipeline, no skip).
- **Gates:** Gate 1 after phase 2 (fuzz results review), Gate 2 before commit.
- **First move (phase 1):** invoke `spec-miner` to extract baseline specs.

## How It Works

### Phase 0: Scope Discovery

1. Scan the codebase: identify modules, entry points, and existing specs (if any).
2. Classify modules by spec coverage: COVERED, STALE, UNCOVERED.
3. Report scope to user — let them narrow or confirm.

### Phase 1: Spec Mining (spec-miner)

1. Invoke `spec-miner` on each uncovered or stale module.
2. Spec-miner produces `openspec/specs/<capability>/spec.md` with:
   - `### Requirement:` blocks with `#### Scenario:` children
   - `### Invariant:` blocks with `<!-- enforced: -->` anchors
   - Machine-parseable `<!-- id: -->` metadata
3. Verify output: every Requirement has at least one Scenario, every Invariant has an enforcement point.
4. If spec-miner fails on a module, flag it — do not block the pipeline, but record the gap.

### Phase 2: Spec Fuzzing (spec-fuzzer)

1. Invoke `spec-fuzzer` on each newly mined spec.
2. Fuzzer reads Invariants and Requirements, generates adversarial test cases:
   - Boundary Violation, Type Confusion, Ordering/Sequencing, State Exhaustion, Trust Boundary, Invariant Interaction
3. Each fuzz case includes "Expected if correct" AND "Expected if broken" outcomes.
4. **Gate 1:** Present fuzz findings to user. Fuzz cases that expose spec weaknesses should be addressed (tighten the spec) before proceeding to test generation. Weak specs produce weak tests.

### Phase 3: Test Skeleton Generation (spec-to-test)

1. Invoke `spec-to-test` on each spec with passing fuzz results.
2. Produces `openspec/tests/<capability>/` with test files matching the project's framework:
   - Unit test skeletons for isolated Scenarios
   - Integration test skeletons for cross-module Scenarios
   - Invariant property-based test skeletons
3. Each skeleton maps 1:1 to a Scenario via `<!-- generated-from: -->` markers.

### Phase 4: Test Implementation (tdd-guide)

1. Invoke `tdd-guide` with the generated skeletons.
2. TDD workflow per skeleton: fill TODO → run (RED) → implement → run (GREEN) → refactor.
3. Cross-reference: every Scenario must map to at least one test.
4. Flag gaps: `<!-- uncertainty: untested scenario -->`.

### Phase 5: Spec Compliance Verification (code-reviewer)

1. Invoke `code-reviewer` with spec compliance checks enabled.
2. Verify: Invariants hold, Requirements are satisfied, no un-spec'd behavioral changes.
3. Report spec coverage: scenarios tested vs. total, invariants verified vs. total.

### Phase 6: Commit

1. Commit specs, test skeletons, and implemented tests.
2. Update `Last verified` timestamps in all spec files.
3. **Gate 2:** Confirm before committing.

## Spec Freshness Gate (Optional)

Between phases, optionally invoke `spec-freshness-checker` to verify no spec has gone stale since the last phase. Enable with `ECC_SPEC_LIFECYCLE_FRESHNESS_GATE=1`.

## Agent Map

| Phase | Agent | Model | Produces |
|-------|-------|-------|----------|
| 1 | spec-miner | opus | `openspec/specs/<capability>/spec.md` |
| 2 | spec-fuzzer | opus | `openspec/fuzz/<capability>/fuzz.md` |
| 3 | spec-to-test | sonnet | `openspec/tests/<capability>/*.test.*` |
| 4 | tdd-guide | sonnet | Implemented tests (GREEN) |
| 5 | code-reviewer | sonnet | Spec compliance report |

## Example

```
orch-spec-lifecycle: onboard nws-poller to spec-driven development
→ phase 0: scan 23 modules, 0 spec'd, 23 uncovered
→ phase 1: spec-miner extracts 47 Requirements, 31 Invariants across 12 capability specs
→ phase 2: spec-fuzzer generates 183 fuzz cases, 12 expose weak boundaries — user tightens 4 specs
  [GATE 1: user approves tightened specs]
→ phase 3: spec-to-test generates 231 test skeletons (Vitest)
→ phase 4: tdd-guide implements tests, 89% pass rate, 11 flagged for review
→ phase 5: code-reviewer verifies spec compliance, 3 HIGH issues found and fixed
→ phase 6: commit specs + tests
  [GATE 2: confirm commit]
```

## Related

- `orch-spec-delta` — per-PR delta workflow (lighter, faster)
- `spec-miner` — individual spec extraction agent
- `spec-freshness-checker` — CI gate for spec staleness
