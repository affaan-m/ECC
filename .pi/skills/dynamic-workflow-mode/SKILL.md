---
name: dynamic-workflow-mode
description: "Design task-local harnesses, eval gates, and reusable skill extraction for Claude dynamic workflow mode and other adaptive agent harnesses."
metadata:
  origin: ECC
---

# Dynamic Workflow Mode

Use this skill when a coding agent can generate or adapt a task-local harness instead of only following a static command flow. The goal is to turn dynamic workflow mode into a disciplined system: temporary harnesses for one-off work, shared skill extraction for repeated work, and observable control pane checkpoints for teams.

## When To Activate

- The user mentions dynamic workflows, custom harnesses, harness-per-task, adaptive workflows, or Claude Code dynamic workflow mode.
- A task needs a custom loop, evaluator, crawler, fixture generator, watcher, or local dashboard.
- Multiple agents need the same repeatable process but the process is not yet captured as a shared skill.
- A workflow needs durable handoff artifacts, eval evidence, or operator approval before merge.

## Core Contract

Dynamic workflow mode should produce a task-local harness only when the harness is cheaper and safer than manually driving the same steps. The harness must have:

- **Objective**: the outcome it owns and the outcome it explicitly does not own.
- **Inputs**: files, URLs, prompts, data sources, credentials policy, and user-provided constraints.
- **Outputs**: commits, reports, screenshots, status files, or control pane snapshots.
- **Eval**: at least one pass/fail check tied to the task, not only "it ran".
- **Handoff**: a short artifact that tells the next operator what happened, what is blocked, and how to resume.

## Dynamic Harness Decision Tree

1. **One-shot task**: keep it inline. Do not invent a harness.
2. **Repeated task with changing inputs**: create a task-local harness and keep it under a temp or project-local working area.
3. **Repeated task across teammates or repos**: extract the pattern into a shared skill.
4. **Task with external state, queueing, or approvals**: add control pane visibility before adding more automation.
5. **Task with safety risk**: add an eval gate and a human merge gate before autonomous execution.

## Task-Local Harness Template

Use this structure before writing code:

```markdown
# Dynamic Workflow Harness

Objective:
- Ship:
- Do not ship:

Inputs:
- Repo or workspace:
- External systems:
- Credentials policy:

Loop:
1. Discover current state.
2. Generate or update the smallest useful artifact.
3. Run eval checks.
4. Record status and handoff.
5. Stop on failed gate, unclear ownership, or unsafe external action.

Eval:
- Command:
- Expected pass signal:
- Failure owner:

Handoff:
- Status:
- Evidence:
- Next action:
```

## Shared Skill Extraction

Promote a task-local harness into a shared skill only when at least two of these are true:

- The same workflow appears in multiple sessions, repos, teams, or launches.
- The workflow needs specific language, tool, or safety sequencing.
- Failures repeat because operators skip a gate or lose context.
- The workflow has a stable input/output contract.
- The workflow benefits from a control pane, status board, or team handoff.

When extracting, write the skill first in `skills/<name>/SKILL.md`. Add command shims only if a legacy slash-entry surface is still required.

## Control Pane Checkpoints

Dynamic workflow mode becomes team-usable when it exposes state. Record these checkpoints whenever the task spans more than one session:

- **Plan**: objective, owner, acceptance criteria, and risky external systems.
- **Queue**: work items, assigned agent role, branch/worktree, and dependency edges.
- **Run**: active harness, current loop step, recent eval result, and token/cost signal if available.
- **Gate**: test results, browser screenshots, security review, and merge readiness.
- **Handoff**: what is done, what failed, what needs a human decision.

If the repo has ECC2 state enabled, prefer adding or reading checkpoints through the ECC control pane or state-store-backed scripts instead of scattering untracked notes.

## Eval Gates

Every dynamic harness needs a task-specific eval. Pick the cheapest reliable gate:

| Work Type | Eval Gate |
| --- | --- |
| Code feature | Focused test, lint, coverage, and one integration path |
| UI/control pane | Browser smoke with screenshot and overflow/error checks |
| Agent workflow | Fixture transcript or seeded work item with expected routing |
| Research/content | Source-neutral brief, claim checklist, and publish-ready outline |
| Integration | Dry-run command, config validation, and no-secret scan |

Do not claim a dynamic workflow is reusable until the eval can be rerun by another teammate.

## Anti-Patterns

- Generating scripts that hide the real decision logic from the operator.
- Treating dynamic workflow mode as permission to skip tests.
- Creating one-off docs when a shared skill or status artifact is the real product.
- Running multiple agents without ownership, merge gate, or conflict policy.
- Letting raw private research data leak into public docs.

## Output Standard

Finish with:

- The harness or skill path.
- The eval commands and results.
- The control pane or handoff artifact path.
- The next reusable extraction candidate.
