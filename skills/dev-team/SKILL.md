---
name: dev-team
description: Simulate a collaborative dev team session where PM, Architect, Developer, and QA respond to the same problem in one turn. Use when you need multi-role perspective on a feature, bug, or design decision before acting.
metadata:
  origin: ECC
---

# Dev Team

Convene a four-role simulated dev team to assess a problem from every angle before committing to an approach. Each role is launched as an independent subagent with only the problem statement and relevant context — no shared conversation history — so each voice stays unanchored.

This is for **multi-role alignment on a concrete problem**, not open-ended decision making (use `council`) or implementation planning (use `planner`).

## When to Activate

- A feature touches product intent, architecture, implementation, and quality simultaneously
- You want to surface conflicts between what PM wants, what is technically sound, what is buildable now, and what is testable
- The user asks "what would the team think?" or "run this by the team"
- Before starting a significant feature to catch blind spots early
- When a bug or incident needs a post-mortem with all angles covered

## When NOT to Activate

| Instead of dev-team | Use |
| --- | --- |
| Ambiguous go/no-go tradeoffs | `council` |
| Breaking a feature into implementation steps | `planner` agent |
| Code review for an existing diff | `code-reviewer` agent |
| Deciding between two technical approaches | `council` |
| Verifying correctness of output | `santa-method` |

## Roles

| Role | Lens |
| --- | --- |
| PM | user value, scope, success metrics, and what to cut |
| Architect | system design, dependencies, long-term maintainability, and risk |
| Developer | implementation feasibility, effort, edge cases, and concrete steps |
| QA | testability, acceptance criteria, failure modes, and regression risk |

## Workflow

### 1. Extract the problem statement

Reduce the request to one clear prompt:
- what are we building or fixing?
- what constraints matter (time, scope, existing system)?
- what counts as done?

If the problem is vague, ask one clarifying question before convening the team.

### 2. Gather only the necessary context

Collect relevant files, snippets, issue text, or specs. Keep it compact — each subagent gets the same context block, so include only what is genuinely needed to respond from that role's perspective.

### 3. Launch all four roles in parallel

Each subagent gets:
- the problem statement
- compact context
- a strict role
- no unnecessary conversation history

Prompt shape:

```text
You are the [ROLE] on a four-person dev team.

Problem:
[problem statement]

Context:
[only the relevant snippets, specs, or constraints]

Respond as [ROLE] with:
1. Take — your 1-2 sentence position on this problem
2. Concerns — 2-3 bullets on what your role sees as risks or blockers
3. Asks — 1-2 things you need from the other roles before this ships
4. Definition of done — the condition from your role's perspective that says this is finished

Be concrete. No hedging. Keep it under 250 words.
```

Role emphasis:
- **PM**: focus on user impact, scope discipline, and what to defer
- **Architect**: focus on system boundaries, dependencies, and what breaks under load or change
- **Developer**: focus on what is actually hard to build, hidden complexity, and the first concrete step
- **QA**: focus on how you would test this, what could silently break, and what the acceptance criteria should be

### 4. Synthesize the team read

After the four voices return, synthesize a team summary:
- where all four roles agree
- where two or more roles are in conflict
- the most important open question before starting work
- a suggested first concrete action

Do not hide conflicts. The value is making disagreements visible before writing code.

### 5. Present the output

Use this structure:

```markdown
## Dev Team: [short problem title]

**PM:** [take]
- Concern: ...
- Ask: ...
- Done when: ...

**Architect:** [take]
- Concern: ...
- Ask: ...
- Done when: ...

**Developer:** [take]
- Concern: ...
- Ask: ...
- Done when: ...

**QA:** [take]
- Concern: ...
- Ask: ...
- Done when: ...

### Team Read
- **Alignment:** [where all four agree]
- **Conflict:** [biggest disagreement]
- **Open question:** [what must be resolved before starting]
- **First action:** [the single most useful next step]
```

Keep it scannable. Strip padding.

## Persistence

Do not write team session notes to ad-hoc paths.

If the team session changes the plan or surfaces a significant architectural decision:
- use `architecture-decision-records` to formalize it
- use `project-context` to update the shared source of truth
- use `story-lifecycle` to translate the outcome into a story or sprint item

Only persist when the outcome changes something real.

## Anti-Patterns

- using dev-team for pure code review — use the `code-reviewer` agent
- feeding subagents the full conversation history
- hiding role disagreements in the synthesis output
- running dev-team on trivial one-liner changes
- using dev-team output as a substitute for an actual `project-context` file

## Related Skills

- `council` — strategic decision-making under ambiguity
- `project-context` — shared source of truth loaded by every agent
- `story-lifecycle` — translate dev-team output into deliverable stories
- `architecture-decision-records` — formalize decisions that become long-lived policy
- `planner` — break the agreed approach into implementation steps

## Example

Problem:

```text
We need to add rate limiting to the public API. We're seeing abuse from scrapers
and free-tier accounts are affecting paid users. Deadline is end of sprint.
```

Expected team shape:
- PM flags that "end of sprint" is aggressive and asks which endpoints matter most
- Architect surfaces that the existing middleware chain has no shared state store and Redis is needed
- Developer calls out that Redis is not in the current stack and estimates 2 days for setup alone
- QA asks for a test plan covering limit thresholds, retry-after headers, and monitoring hooks

The value is catching the Redis gap before the sprint starts, not after.
