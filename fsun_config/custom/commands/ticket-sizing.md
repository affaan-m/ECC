---
description: Team ticket-sizing / story-point estimation standard. Apply when creating, sizing, or reviewing Jira/GitHub tickets. Pairs with the /jira command.
---

# Ticket Sizing Standard

Team standard for story-point estimation. **Follow this whenever creating, sizing, splitting, or reviewing a ticket** (Jira or GitHub), and when helping plan a sprint. This is the canonical pattern — new tickets should conform to it.

## Core Rules

1. **Use simple sizes only** — `1, 2, 3, 5, 8` only. No 13 or larger. If a ticket feels bigger than 8, it is too big → **split it**.

2. **Estimate the complete delivery effort** — the *total* effort to reach **Done**, not just development. Include analysis, development, testing, peer review, validation, documentation, deployment, and anything else the team's Definition of Done requires to release the change. Estimate **team** effort start-to-finish, not one person's coding speed.

3. **Compare with previous tickets** — never estimate from zero. Ask: *"Is this similar to a previous 2-, 3-, or 5-point ticket?"*

4. **Keep tickets small and sprintable** — most sprint tickets should be **1, 2, or 3**. A **5** should be clear and well understood. An **8 is a warning sign** and should usually be **split before sprint planning**.

5. **Do not size unclear work as delivery work** — if the requirement, acceptance criteria, or expected outcome is unclear, **clarify first**. If the solution is unknown, create a **time-boxed spike**, then estimate the real delivery work later.

6. **Reserve sprint capacity** — do not plan to 100% of average velocity. Reduce planned work for leave, public holidays, support work, incidents, reviews, meetings, and other commitments.

7. **Only fully Done work counts** — only DoD-complete tickets count toward velocity. Partially completed work carries over and is used as **learning** for better future sizing.

8. **Improve sizing every sprint** — at each sprint's end, review what was underestimated, what carried over, and which tickets should have been split earlier. Goal: continuous improvement — smaller tickets, clearer scope, more predictable delivery.

## How to apply

- **Creating a ticket:** ensure scope is clear (rule 5), size the whole-team effort to DoD (rule 2), anchor against a comparable past ticket (rule 3), and if it lands at 8+, propose a split (rules 1, 4).
- **Sprint planning:** don't fill to full velocity (rule 6); flag any 8s for splitting (rule 4).
- **Retro:** surface underestimates / carryovers / should-have-split tickets (rules 7, 8).

Reference issue (seed for the Jira team guideline): Creditcorp-Group/gcp-landing-zone-infra #60.
