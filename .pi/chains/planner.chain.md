---
name: planner
description: Plan an implementation based on the user's intent. Output a detailed plan document and await parent approval.
chain:
  - agent: planner
    task: 'Review {task} and create an implementation plan document at `docs/implementation/plan.md`. Create a list of todos reflecting this plan using the `todo` tool.'
    output: docs/implementation/plan.md
---

# Planner Chain

1. Analyzes the task.
2. Creates `docs/implementation/plan.md`.
3. Sets up task items via the `todo` tool.
4. Returns execution context to the parent for approval via `ask_user_question`.
