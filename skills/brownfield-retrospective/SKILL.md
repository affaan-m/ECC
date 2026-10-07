---
name: brownfield-retrospective
description: Run the ECC engineering process retroactively against an existing project slice. Audit current state, reconstruct past decisions, produce a four-axis gap register (thinking, coding practice, missing features, technology selection), then execute fixes forward through the plan-TDD-review pipeline. Use when adopting ECC mid-project, taking over an inherited codebase, or asking what was missed and what would have been built differently from day one.
metadata:
  origin: ECC
---

# Brownfield Retrospective

Run ECC's engineering process retroactively against a project that was built without it. Pick any slice of an existing codebase, audit what exists, reconstruct how it got there, extract a four-axis gap register, then execute the fixes forward through the standard ECC pipeline.

The workflow is slice-first: no whole-repo onboarding is required before it is useful, and every phase is re-enterable from a durable artifact on disk. Start in the middle, work backwards, then move forward.

## When to Activate

- Adopting ECC in a repository that already exists and is already shaped
- User asks to "audit my existing project", "retro this codebase", or "what did we miss?"
- Taking over, inheriting, or returning to a codebase after a long gap
- User asks "why is it like this?" followed by "should it stay like this?"
- A module, feature, or service needs a rethink before the next feature lands on top of it
- Deciding whether a legacy area should be fixed forward, rewritten, or left documented as-is

## When Not to Use

- Greenfield work with no existing code — use `planner` and `tdd-workflow` directly
- Onboarding to spec-driven development without the redesign loop — the `spec-miner` agent does that on its own
- A launch go/no-go production-readiness pass — use `production-audit`
- Security-only sweeps — use `security-review`
- Team process retrospectives (sprint ceremonies) — this audits a codebase, not people

## The Working Set

All artifacts are written inside the audited project, under `docs/retro/<slice>/`:

| File | Phase | Purpose |
|------|-------|---------|
| `gap-register.md` | 0-6 | The state machine. The only file required to resume mid-stream. |
| `baseline-audit.md` | 1 | Reviewer findings, test/CI snapshot, TODO inventory. |
| `reconstructed-spec.md` | 2 | What the code actually does today (Requirements + Invariants). |
| `target-design.md` | 4 | Target shape for the slice and the fix sequence. |

Backfilled decisions go to `docs/adr/` per the `architecture-decision-records` skill. If the project uses OpenSpec, `reconstructed-spec.md` may instead be `openspec/specs/<capability>/spec.md` produced by `spec-miner`.

## How It Works

### Phase 0 — Pick the Entry Point

Start from what the user cares about today. Do not map the whole repo first.

Any of these is a valid slice:

| User signal | Slice |
|-------------|-------|
| Names a directory, module, or service | That path plus its direct callers |
| Names a feature or user flow | The files that implement it, traced from the entry point |
| Names a bug, incident, or pain point | The code that produced it plus one level of call chain |
| Names a dependency or tech choice | Everything that touches it |
| Names nothing | The 2-3 hottest paths by churn — propose them and let the user pick |

Record the perimeter at the top of `gap-register.md` before anything else: paths in scope, entry points, callers, blast radius. Budget the slice at roughly 15 files or 2,000 lines; if the user's pick is bigger, cut it into named sub-slices and register each as its own row of work. A slice too big to audit in one session is a slice that never finishes.

### Phase 1 — Present-State Audit

Establish what exists now, with evidence. Do not fix anything yet.

1. Recon the slice: manifest and framework fingerprint, entry points, test layout, CI checks (borrow the recon steps from `codebase-onboarding`, scoped to the perimeter).
2. Run the reviewers that match the stack, in parallel where possible. Every finding must carry a `file:line` pointer:
   - The language reviewer for the stack (`typescript-reviewer`, `python-reviewer`, `go-reviewer`, ...)
   - `security-reviewer`
   - `silent-failure-hunter` for swallowed errors
   - `type-design-analyzer` where invariants are encoded in types
   - `performance-optimizer` only if the slice is on a hot path
3. Snapshot the current state: test count and coverage, lint/CI status, `TODO`/`FIXME`/`HACK` inventory inside the perimeter.

Write everything to `baseline-audit.md`. Findings that get fixed during this phase corrupt the baseline — hold them for the register.

### Phase 2 — Backward Reconstruction

Work backwards from the present state to the decisions that produced it.

1. Mine the behavioral spec: run `spec-miner` against the slice. Its Requirements (WHEN → THEN) and Invariants become `reconstructed-spec.md` — the baseline truth for Phase 5 tests.
2. Git archaeology on the perimeter:
   - `git log --follow --oneline -- <slice>` — age, authors, cadence
   - Largest and most reverted commits — where the design changed under pressure
   - Churn hotspots — files changed far more often than neighbors
   - Dead ends — branches or scaffolding that never shipped
3. Decision inventory: list the significant decisions frozen into the code (stack and framework choices, data model, boundaries, error strategy, state management). Check each against `docs/adr/`, README, and comments. Every decision with no written record is itself a pre-existing thinking gap — record it in Phase 3, do not silently backfill it here.
4. Where behavior is opaque, use `code-explorer` to trace execution paths before guessing at intent.

### Phase 3 — Gap Analysis (Four Axes)

Convert the audit and reconstruction into register rows. One axis per class of gap:

| Axis | Question | Sources |
|------|-----------|---------|
| Thinking | What was decided but never recorded? Which invariants live only in code? | Decision inventory, reconstructed spec |
| Coding practice | Where does the code diverge from how ECC would have written it? | Phase 1 findings, the `rules/` pack for the language, spec items with no test anchor |
| Missing features | What would a day-one build have included that this slice never got? | Boundary input validation, observability, rate limiting, idempotency, migrations plus rollback, a11y, i18n, user docs, CI gates |
| Technology selection | Is the chosen tech fighting the codebase? Outdated, duplicated, risky, or missing? | Dependency inventory, git archaeology, recon |

Register format (the table is the skill's durable output):

```markdown
| ID | Axis | Gap | Evidence | Forward fix | Severity | Effort | Status |
|----|------|-----|----------|-------------|----------|--------|--------|
| G-001 | practice | Errors swallowed in retry loop | src/api/retry.ts:42 | Propagate + map at boundary | P1 | S | open |
```

- Severity: `P0` security exposure or data loss, `P1` correctness, `P2` practice and observability, `P3` selection and cleanup.
- Effort: `S` under a session, `M` a few sessions, `L` needs its own plan.
- Status: `open`, `in-progress`, `done`, `wont-fix`.
- Every row needs an evidence pointer. A gap you cannot point at is an opinion.

### Phase 4 — Redesign / Rethink

Turn the register into a sequenced plan.

1. Run `architect` or `code-architect` over the `P0` and `P1` rows to produce `target-design.md`: target shape for the slice, the fix sequence, and an explicit "what does not change" list to protect working behavior.
2. Backfill retro-ADRs for every undocumented decision from Phase 2. Mark them as reconstructed (`status: accepted (reconstructed)`, date of the retro, note the original decision predates the record). Never present a backfilled ADR as if it were written at decision time.
3. Triage every register row into one of: `fix-forward` (repair in place), `rewrite` (replace the slice), `leave-documented` (wont-fix). A `wont-fix` must record its reason in the register — a wont-fix with a reason closes the thinking gap; a silent one reopens it.
4. Sequence the backlog: `P0` first, then interleave quick wins with larger repairs to keep momentum.

### Phase 5 — Forward Execution

Work the register through the standard ECC pipeline, one row per session as a baseline pace:

```text
planner (scope the row)
  → tdd-guide (failing test first — for a legacy gap the first test
    usually encodes the missing invariant from reconstructed-spec.md)
  → implement
  → code-reviewer
  → security-reviewer (if the row touches input, auth, or data)
  → doc-updater + ADR (if the decision changed)
  → conventional commit
  → mark the register row done
```

- Update `gap-register.md` statuses as rows close; the register is the durable state, not the conversation.
- On session boundaries, hand off through the project's memory mechanism (`unified-memory`, context carriers) so the next session resumes from the register alone.

### Phase 6 — Closure and Re-Audit

When every row is `done` or `wont-fix`:

1. Re-run the Phase 1 audit over the same perimeter.
2. Diff against `baseline-audit.md` and verify with `verification-loop` — the gaps claimed closed must stay closed.
3. Record the delta (findings then, findings now, rows closed, rows deferred) at the bottom of `gap-register.md`.
4. Anything that resurfaced becomes a new row, not a failure — the register is a loop, not a one-shot.

## Resuming Mid-Stream

Any session can start in the middle. Read `docs/retro/<slice>/gap-register.md` first:

- Register exists with a row `in-progress` → Phase 5, finish that row.
- Register exists, all rows closed → Phase 6.
- No register, but `baseline-audit.md` exists → Phase 2.
- No artifacts at all → Phase 0 with the user.

## Anti-Patterns

- Auditing the whole repo before any slice — the workflow is slice-first by design.
- Fixing code during Phases 1-3 — audit phases produce the register; edits mid-audit corrupt the baseline.
- Register rows without evidence pointers.
- `wont-fix` without a recorded reason.
- Presenting backfilled ADRs as contemporaneous records.
- Skipping the Phase 6 re-audit — closure is verified, not declared.

## Related Skills

- `codebase-onboarding` — recon baseline for Phase 1
- `architecture-decision-records` — retro-ADR backfill in Phase 4
- `tdd-workflow` — Phase 5 execution discipline
- `verification-loop` — Phase 6 closure
- `production-audit` — launch-readiness lens (complementary, later)
- `security-review` — security-only requests
