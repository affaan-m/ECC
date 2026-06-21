---
name: goal-loop
description: "Bounded objective-driven maker/checker loop for focused, measurable work with strict stop conditions and budget enforcement."
metadata:
  origin: ECC
---

# Goal Loop

A tight, objective-driven loop that alternates between making progress and
checking against acceptance criteria. It is designed to finish, not to run
indefinitely.

## When to Use

- A single, well-scoped objective can be stated in one sentence.
- Success is verifiable with a concrete checklist or test.
- You need a hard budget (time, tokens, iterations, or cost).
- The task is risky enough that a separate checker pass is justified.

Do not use for open-ended exploration, continuous maintenance, or
multi-feature projects. For those, see `continuous-agent-loop` or
`ralphinho-rfc-pipeline`.

## Loop Structure

```text
Start
  |
  +-- Define objective + acceptance criteria + budget
  |
  +-- MAKER pass  --> produce candidate output
  |
  +-- CHECKER pass --> verify against criteria
  |
  +-- Criteria met? -- yes --> STOP (success)
  |
  +-- Budget exhausted? -- yes --> STOP (escalate)
  |
  +-- Refine plan from checker feedback --> repeat
```

## Required Setup

Before the first maker pass, lock these in:

| Element | What to capture |
|---------|-----------------|
| Objective | One-sentence goal. No compound objectives. |
| Acceptance criteria | Numbered checklist. Each item is pass/fail. |
| Budget | Max iterations, max time, max tokens, or max cost. |
| Checkpoint file | A durable file (e.g., `.goal-loop-state.md`) that survives context resets. |

If the objective cannot be expressed as a single sentence, decompose it into
separate goal loops or switch to an RFC-driven pipeline.

## Maker Pass

The maker produces a candidate. Constraints:

- Work against the acceptance criteria, not against a vague idea of "better."
- Produce the smallest viable candidate that could satisfy the checklist.
- Document assumptions in the checkpoint file if they affect the checker.
- Do not gold-plate. The checker will reject scope creep just as fast as bugs.

## Checker Pass

The checker evaluates the candidate against the acceptance criteria. It is
structurally separate from the maker — even when both run in the same session,
the checker must reference the criteria, not the maker's rationale.

Checker output:

```text
GOAL-LOOP CHECK REPORT
======================
Criteria:
1. [PASS/FAIL] <criterion text> — evidence
2. [PASS/FAIL] <criterion text> — evidence
...

Overall: [READY / NEEDS_WORK]

Blockers (if any):
- ...

Recommended next maker focus:
- ...
```

A checker pass that returns no blockers ends the loop immediately.

## State & Checkpoints

Persist state to the checkpoint file after every pass:

```markdown
# Goal-Loop State: <objective slug>

## Budget
- Iteration: 2 / 5
- Time: 12 min / 30 min

## Acceptance Criteria
- [x] Criterion 1
- [ ] Criterion 2 — blocker: edge case X fails

## Current Candidate
- File: src/auth/gate.ts
- Commit: abc1234

## History
- Iteration 1: maker added basic gate; checker found missing null check
```

The checkpoint file is the source of truth if the loop resumes in a new
context window or session.

## Budgets & Bounds

Enforce at least one hard limit:

| Budget type | Example | Action on exhaust |
|-------------|---------|-------------------|
| Iterations | Max 5 maker/checker cycles | Stop and escalate |
| Time | Max 30 minutes | Stop and escalate |
| Tokens / cost | Max $2.00 | Stop and escalate |
| Scope | No new files after iteration 2 | Reject scope expansion |

The loop must stop when **any** budget is exhausted. Do not borrow from one
budget to extend another.

## Stop & Escalation Rules

**Success stop:** All acceptance criteria pass. Produce a final summary and
archive the checkpoint file.

**Budget stop:** A budget is exhausted with criteria still open. Produce:
1. A concise status report (what passed, what remains, why it stalled).
2. A recommendation: escalate to human, decompose into smaller goal loops, or
   switch to a different skill (e.g., `planner`, `architect`).

**Early stop:** The checker finds that the objective itself is flawed,
unreachable, or based on a false premise. Stop and report the finding rather
than iterating on an impossible target.

## Example

Objective: "Add input validation to the `/login` endpoint so that empty email
and passwords return 400."

Acceptance criteria:
1. Empty email returns 400 with error code `EMAIL_REQUIRED`.
2. Empty password returns 400 with error code `PASSWORD_REQUIRED`.
3. Existing valid requests still return 200.
4. All three cases are covered by unit tests.

Budget: 3 iterations, 20 minutes.

**Iteration 1**
- Maker: adds validation logic and tests.
- Checker: criteria 1–3 pass; criterion 4 fails — tests exist but do not assert
  the exact error codes.

**Iteration 2**
- Maker: updates tests to assert exact error codes.
- Checker: all criteria pass.

**Stop:** Success. Archive checkpoint.
