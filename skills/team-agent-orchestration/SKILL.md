---
name: team-agent-orchestration
description: "Run team-based orchestration for agent squads using work items, ownership, agent Kanban, merge gates, and control pane handoffs."
origin: ECC
---

# Team Agent Orchestration

Use this skill when agents are being managed like a team rather than a single assistant. The purpose is to make team-based orchestration reliable: clear work items, explicit ownership, agent Kanban state, branch isolation, control pane visibility, and merge gates.

## When To Activate

- The task spans multiple agents, tools, harnesses, branches, or worktrees.
- The user mentions team orchestration, agent Kanban, squad, conductor, control pane, manager, desktop app, Zellij, tmux, Hermes, Devin, Codex, Claude Code, or multi-agent work.
- A project needs shared workflow state across people and agents.
- Existing agent fan-out is producing output but not mergeable product.

## Operating Model

Treat every agent as a teammate with a narrow contract:

- **Owner**: the person or agent accountable for the work item.
- **Scope**: files, branch, tool surface, and forbidden areas.
- **State**: backlog, ready, running, review, blocked, merged, or archived.
- **Evidence**: tests, screenshots, logs, review notes, or eval reports.
- **Merge gate**: the exact condition that allows integration.

## Agent Kanban

Use agent Kanban when work must be visible across sessions.

| Column | Meaning | Exit Criteria |
| --- | --- | --- |
| Backlog | Candidate work item, not yet shaped | Acceptance criteria written |
| Ready | Shaped and assignable | Owner and branch/worktree assigned |
| Running | Agent is actively working | Handoff artifact and changed files exist |
| Review | Work is complete but not merged | Tests, diff review, and risk check pass |
| Blocked | Needs external input or failed gate | Blocker has owner and next action |
| Merged | Integrated into mainline | PR merged or local main updated |
| Archived | No longer relevant | Reason recorded |

Each card should fit this schema:

```json
{
  "id": "agent-card-001",
  "title": "Build dynamic workflow skill",
  "owner": "codex",
  "state": "running",
  "branch": "product/dynamic-workflow-team-orchestration",
  "worktree": ".",
  "acceptance": [
    "Skill exists",
    "Tests cover required concepts",
    "Content artifact contains video and article angles"
  ],
  "merge_gate": "lint, focused tests, and catalog check pass",
  "handoff": "path/to/handoff.md"
}
```

## Team-Based Orchestration Flow

1. **Shape the board**: convert fuzzy ambition into work items with owners and merge gates.
2. **Pick execution mode**: single-agent, dynamic workflow mode, dmux/tmux, worktree fan-out, or external desktop orchestrator.
3. **Assign boundaries**: one owner per card, clear file scope, and no overlapping writes without an integrator.
4. **Run agents**: each agent writes evidence and handoff notes, not just code.
5. **Review in sequence**: tests first, then diff review, then security/risk checks, then content/product polish.
6. **Merge deliberately**: one integrator resolves conflicts and updates the control pane or status artifact.
7. **Extract reusable skill**: if the card pattern repeats, promote it into `skills/`.

## Control Pane Requirements

A useful control pane for team orchestration should show:

- Active work items and their agent Kanban state.
- Owner, harness, branch, worktree, and last heartbeat.
- Links to handoff artifacts, tests, screenshots, and PRs.
- Blockers grouped by owner and unblock action.
- Merge readiness by gate, not vibes.
- Reusable workflow candidates that should become shared skills.

Do not add more automation until the operator can answer: who owns this, what changed, what gate failed, and what can safely merge?

## Dynamic Workflow Compatibility

When a card needs dynamic workflow mode:

- Put the task-local harness under the card owner.
- Store inputs and outputs on the card.
- Require an eval before moving from Running to Review.
- Promote the harness to a shared skill only after repeat use.

## Failure Modes To Watch

- **Agent soup**: many agents running, no owner or merge gate.
- **Invisible work**: useful output exists only in a chat transcript.
- **Board theater**: a Kanban board exists but cards have no acceptance criteria.
- **Overlapping writes**: parallel agents edit the same files without worktrees.
- **No product artifact**: the process produces docs but no runnable or publishable surface.

## Output Standard

Finish each orchestration pass with:

- Board/card changes.
- Merged or pending branches.
- Tests and eval evidence.
- Blockers with owner and next action.
- New shared skill candidates.
