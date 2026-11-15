---
name: intent-driven-development
description: Turn ambiguous or high-impact product and engineering changes into scoped, verifiable acceptance criteria before or alongside implementation. Use when a user asks to clarify a feature, define acceptance criteria, de-risk a security/data/migration/integration change, prepare implementation requirements for another agent, or make a complex request testable. Do not trigger for trivial edits, straightforward fixes, active debugging, code review, or implementation requests whose acceptance conditions are already clear unless the user explicitly invokes this skill.
---

# Intent-Driven Development

Produce useful acceptance criteria without turning specification into ceremony. Inspect
available context first, expose genuine ambiguity, and choose verification methods that fit
the work and its risk.

## When to Activate

- User asks to clarify a feature, define acceptance criteria, or de-risk a change before implementation
- Request touches security, authentication, persistent data, migrations, external APIs, or compliance
- User wants to prepare a handoff artifact for another agent or team
- Request is ambiguous enough that the expected outcome is not yet observable or testable
- User explicitly invokes this skill with `/intent-driven-development`

Do not activate for trivial edits, straightforward one-line fixes, active debugging sessions,
code review requests, or implementation requests whose acceptance conditions are already clear.

## How It Works

1. **Inspect context first** — reads the repository, docs, schemas, and test infrastructure for technical facts before asking any question, while treating product/business constraints as something only the user or a product artifact can supply
2. **Choose depth** — selects Quick Capture (3-7 criteria, low/moderate risk) or Full Acceptance Brief (security, data, migration, cross-system changes) based on the risk profile
3. **Ask minimally** — only asks questions whose answers cannot be inferred and that materially change scope or behavior
4. **Write observable criteria** — each AC-NNN describes a starting condition, trigger, expected outcome, prohibited side effect, verification method, and priority; no vague words like "correctly" or "securely" without evidence
5. **Proceed or hand off** — for clear requests with no blocking risks, records criteria and continues; for risky changes, presents blockers and waits for confirmation
6. **Handle revision** — if an AC fails mid-implementation due to architectural constraints, marks it `[revised]`, updates scope or verification method, increments the revision number, and re-presents only the changed criteria

## Examples

**Quick Capture — "Add CSV export to the dashboard"**

```
Goal: Authenticated users can download dashboard data as a CSV file.
In scope: Export of currently filtered rows; filename includes date.
Out of scope: Scheduled exports, email delivery, Excel format.
Assumptions: Max row count is under 10k; no PII in exported fields.

AC-001: Export generates file with correct headers
- Scenario: authenticated user, at least one data row visible
- Action: click "Export CSV"
- Expected: browser downloads file with columns [id, name, created_at]
- Must not: expose internal fields or rows belonging to other users
- Verification: automated integration test + manual schema spot-check
- Priority: Required
```

**Full Acceptance Brief trigger — "Migrate user auth to OAuth"**

Auth change + external dependency + existing session data → Full Brief with Risk Review table,
blocking decisions on session invalidation strategy, and explicit rollback AC.

**Existing spec review — user pastes a PRD**

Skill reviews it for missing scope boundaries, unverifiable requirements ("the system shall be fast"),
and silent assumptions, then returns corrected or supplemental criteria without restarting discovery.

## Operating Rules

1. Inspect the available repository, documentation, issue, design, and test context before
   asking for technical facts that can be discovered locally.
2. Do not infer product or business constraints from code. Business rules, compliance and
   regulatory obligations, contractual SLAs, pricing, data-retention policy, prioritization,
   and target users cannot be read from a repository. Treat them as unknown until the user
   supplies them or an authoritative product artifact (PRD, contract, policy document) states
   them. Record them as assumptions flagged for confirmation, never as discovered facts. The
   repository tells you how the system behaves today, not what the business requires it to do.
3. Ask only questions whose answers are required and cannot be safely inferred. Group short,
   related questions when that saves unnecessary turns.
4. Do not block implementation by default. When the user has asked to implement a sufficiently
   clear change, record key assumptions and acceptance criteria briefly, then proceed or hand
   them to the implementation workflow.
5. Require explicit user confirmation before proceeding only when an unresolved decision could
   create material security exposure, data loss, irreversible migration, contractual/API
   breakage, meaningful cost, or destructive external action.
6. Do not write an acceptance document into a repository, alter project files, create a branch,
   commit, or invoke another skill unless the user requests it or the active repository
   workflow explicitly requires it.
7. Treat automated tests as evidence, not truth. Prefer automation when reliable and
   proportionate; allow manual UX, accessibility, security, legal, or operational verification
   where automation cannot establish the outcome.
8. Never include real secrets, credentials, tokens, private keys, personal data, or sensitive
   production payloads in acceptance criteria, fixtures, examples, or saved artifacts. Use
   redacted or synthetic values.
9. Do not run destructive tests, migrations, security probes, load tests, paid external calls,
   or operations against production/live data without explicit authorization and an identified
   safe environment.
10. When an acceptance criterion cannot be satisfied due to an architectural, platform, or
   external constraint discovered during implementation, do not silently drop or workaround it.
   Update the affected criterion (mark it `[revised]`, state the constraint, and adjust scope or
   verification method), increment the revision number, and re-present only the changed criteria
   to the user before continuing. Require explicit confirmation only if the revision changes a
   blocking decision or materially reduces safety or correctness guarantees.

## Choose The Depth

Use the smallest useful output.

### Quick Capture

Use for a clear but non-trivial change with low or moderate risk. Produce:

- Goal
- In scope / out of scope
- Assumptions
- 3-7 acceptance criteria with verification methods
- Blocking questions, if any

Do not delay implementation for approval unless a blocking risk from the operating rules
exists or the user specifically asked for a specification first.

### Full Acceptance Brief

Use for ambiguous, cross-system, security-sensitive, data-changing, migration, compliance,
or high-cost changes, or when the user requests a handoff artifact. Produce the full template
below and request confirmation for unresolved blocking decisions before risky implementation.

### Existing Specification Review

When the user already supplied a PRD, issue, plan, or acceptance criteria:

1. Review it instead of restarting discovery.
2. Identify missing scope boundaries, unsafe assumptions, contradictions, and unverifiable
   requirements.
3. Return corrected or supplemental criteria.

## Workflow

### 1. Establish Goal And Risk

Extract or ask for:

- The observable outcome for the user or system.
- The actors affected.
- The main failure consequence.
- Risk dimensions that actually apply: security/privacy, persistent data, compatibility/API,
  migration, external dependencies, cost, concurrency, performance, usability/accessibility.

Avoid asking generic questions about irrelevant risks.

### 2. Discover Context

When local or connected artifacts are available, inspect only what is needed:

- Existing behavior and directly related files or interfaces.
- Repository conventions, product docs, API contracts, data schemas, or migration history.
- Existing verification infrastructure and realistic commands.
- External dependencies and whether they are testable in isolation.

Record discovered facts separately from user-provided assumptions. If context cannot be
inspected, say what is unknown and ask focused questions.

The repository reveals technical facts — how the system behaves today, its conventions, and
its contracts. It does not reveal product or business constraints: business rules, compliance
and regulatory obligations, contractual SLAs, pricing, data-retention policy, prioritization,
and target users. Never reconstruct these from code or naming. Capture them only from the user
or an authoritative product artifact, and list them as assumptions to confirm until then.

### 3. Define Scope

State:

- Goal: one sentence describing the intended outcome.
- In scope: behavior this change must deliver.
- Out of scope: tempting adjacent work explicitly excluded.
- Assumptions: claims not yet proven.
- Blocking decisions: unresolved choices that materially affect safety or behavior.

### 4. Write Acceptance Criteria

Use `AC-001`, `AC-002`, and so on. Each criterion must describe observable behavior and an
appropriate verification method; criteria and tests are not required to map one-to-one.

For each applicable criterion include:

- Scenario or starting condition.
- Action or trigger.
- Expected observable behavior.
- Prohibited side effect when meaningful.
- Verification method: automated test, integration check, manual UX review, accessibility
  check, security review, operational check, or stakeholder acceptance.
- Environment/safety constraint when verification could affect data, services, cost, or secrets.
- Priority: required, important, or optional.

Do not use words such as "correctly", "securely", "fast", "intuitive", or "robust" without
defining observable evidence or recording them as a human-review judgment.

### 5. Cover Only Relevant Boundaries

Consider these categories, but include only categories that apply:

| Category | Include when | Typical evidence |
| --- | --- | --- |
| Happy path | New or changed user-visible behavior | Successful workflow or state transition |
| Validation | The change accepts input | Rejected malformed or boundary value without mutation |
| Authorization/privacy | Data or actions have access boundaries | Denied access and no sensitive disclosure |
| Persistence/migration | Stored data or schemas change | Backward read, migration, rollback or backup behavior |
| Compatibility | Public APIs, files, events, or clients may break | Existing contract or fixture remains valid |
| Failure recovery | Network, service, or asynchronous failure exists | No partial state or clear retry/degraded behavior |
| Idempotency/concurrency | Repeats or simultaneous writes are plausible | No duplicate side effect or invalid final state |
| Performance | A user or service threshold matters | Defined measurement conditions and threshold |
| UX/accessibility | A person interacts with the result | Keyboard, feedback, error recovery, visual/manual review |

### 6. Present And Continue

- For a clarification/specification request, present the brief and ask for decisions only on
  listed blockers.
- For an implementation request with no blocker, present a compact criteria summary as part of
  the work and continue with implementation.
- For handoff to another agent or team, include enough context and verification detail for them
  to act without inventing requirements.
- Save the brief to a file only when requested. Use a repository-approved path when one exists;
  otherwise ask for or state the chosen destination before writing.

## Output Template

Use this template for a Full Acceptance Brief. Omit irrelevant sections for Quick Capture.

```markdown
# Acceptance Brief: <Change Name>

**Status:** Draft | Approved | Implemented | Verified
**Revision:** <number>
**Prepared for:** <user/team/agent, when known>
**Approval required before risky work:** Yes | No - <reason>

## Revision Log

| Rev | Date | Changed criteria | Reason |
| --- | --- | --- | --- |
| 1 | <date> | — | Initial draft |

## Goal

<One observable outcome sentence.>

## Scope

**In scope**
- <behavior included>

**Out of scope**
- <adjacent work excluded>

## Context

**Discovered facts** (technical, verified from repository or artifact)
- <how the system behaves today, conventions, contracts>

**Product/business constraints** (supplied by user or product artifact, never inferred from code)
- <business rule, compliance/SLA obligation, retention policy, priority, target user — or "none supplied yet">

**Assumptions**
- <unverified claim to confirm or validate>

**Dependencies and constraints**
- <external service, local convention, compatibility obligation, environment limit>

## Risk Review

| Risk area | Applies? | Required handling |
| --- | --- | --- |
| Security/privacy | Yes/No | <redaction, authorization, review, etc.> |
| Persistent data/migration | Yes/No | <compatibility, backup, rollback, etc.> |
| External effects/cost | Yes/No | <sandbox/test environment/authorization> |
| Compatibility/API | Yes/No | <contract to preserve or version> |
| UX/accessibility | Yes/No | <manual or automated evidence> |

## Acceptance Criteria

### AC-001: <observable behavior>
- **Scenario:** <starting condition>
- **Action:** <single trigger>
- **Expected:** <observable result>
- **Must not:** <prohibited side effect, if applicable>
- **Verification:** <method and intended evidence>
- **Environment/safety:** <constraints, if applicable>
- **Priority:** Required | Important | Optional

## Blocking Decisions

- [ ] <only decisions that prevent safe or correct progress>

## Verification Plan

| Criterion | Verification evidence | Status |
| --- | --- | --- |
| AC-001 | <test/check/review command or evidence type> | Pending |
```

## Pass/Fail Examples

Use these to judge whether the skill actually produced a verifiable brief, not planning prose.

**A failing acceptance criterion**

```
AC-001: The export works correctly and is secure.
```

Fails — "works correctly" and "secure" are not observable, there is no scenario, trigger,
expected result, or verification method, and nothing states what must not happen. A reader
cannot tell whether the implementation satisfied it.

**A passing acceptance criterion**

```
AC-001: Export generates file with correct headers
- Scenario: authenticated user, at least one data row visible
- Action: click "Export CSV"
- Expected: browser downloads file with columns [id, name, created_at]
- Must not: expose internal fields or rows belonging to other users
- Verification: automated integration test + manual schema spot-check
- Priority: Required
```

Passes — a concrete observable outcome, a prohibited side effect, and a named verification
method. Two people would agree on whether it was met.

**A failing context entry**

```
Discovered facts: Users on the free tier are limited to 100 exports per month.
```

Fails — a per-tier limit is a business rule. It must not appear under discovered facts inferred
from code; it belongs under Product/business constraints, supplied by the user, or be listed as
an assumption to confirm.

### Pass/Fail Rubric

A brief passes only if every answer is "yes". Any "no" means revise before returning it.

- [ ] Does every required criterion have a scenario, an observable expected result, and a named verification method?
- [ ] Are all vague terms ("correctly", "secure", "fast", "robust") either replaced with observable evidence or marked as human judgment?
- [ ] Are product/business constraints listed as supplied/assumed, with none silently inferred from code?
- [ ] Is scope explicit, with out-of-scope items named?
- [ ] Are blocking decisions limited to choices that actually affect safety or correctness, not preferences?

## Quality Check

Before returning the brief, check:

- The goal describes an outcome rather than an implementation choice.
- Scope boundaries and assumptions are explicit.
- Every required criterion is observable or clearly marked for human judgment.
- Security, privacy, data, compatibility, external-effect, and UX risks were considered only
  where relevant and not silently ignored.
- Verification methods identify safe environments for risky operations.
- No secret or production-sensitive information was copied into the output.
- No repository mutation or implementation block is imposed without justification or request.

## Handoff

When another planning or implementation workflow is available, pass the acceptance brief or
criterion IDs to it. When no dedicated workflow exists, provide the brief directly as the
implementation reference. Do not assume any named skill or tool is installed.
