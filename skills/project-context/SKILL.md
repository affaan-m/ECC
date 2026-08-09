---
name: project-context
description: Create and maintain a PROJECT-CONTEXT.md file as the shared source of truth loaded by every agent. Use at project start, when onboarding a new agent, or when the team's shared understanding of the project has drifted.
metadata:
  origin: ECC
---

# Project Context

Create and maintain a `PROJECT-CONTEXT.md` file that serves as the single shared source of truth for any agent working on the project. When every agent starts from the same compact document, you eliminate repeated re-discovery, contradictory assumptions, and context drift between sessions.

## When to Activate

- Starting a new project and want agents to share a baseline immediately
- Onboarding a new agent (or new team member) who needs fast ramp-up
- The project's shared understanding has drifted — agents are making contradictory assumptions
- A significant decision or pivot has happened and the context file needs updating
- Before running `dev-team` or `story-lifecycle` so all roles start from the same foundation

## When NOT to Activate

- Detailed architecture decisions — use `architecture-decision-records` for those
- Sprint-level task tracking — use `story-lifecycle` for that
- Per-session memory — use `/save-session` or `knowledge-ops` for ephemeral notes

## The PROJECT-CONTEXT.md File

Place it at the project root: `PROJECT-CONTEXT.md`.

It is not a README. It is an agent briefing document — dense, factual, and always current. Agents are instructed to read it at the start of every session. Humans update it when the project changes.

### Structure

```markdown
# PROJECT-CONTEXT.md

> Last updated: YYYY-MM-DD | Status: [active | paused | shipped]

## What This Is

[1-3 sentences. What the project builds, who it is for, and the core value proposition.]

## Current State

[2-4 bullets. What works today, what is in progress, what is deliberately deferred.]

## Architecture

[Compact description of the stack, key services, and their relationships.
No more than 10 lines. Link to ADRs for decisions that need justification.]

## Active Constraints

[Non-negotiable constraints that every agent must respect: deadlines, API limits,
team size, external dependencies, or banned patterns.]

## Accepted Decisions

[2-5 bullets of the most important already-made decisions. Each one should answer
"why did we do it this way?" in one sentence. Link to full ADRs when they exist.]

## Open Questions

[Things the team has not yet decided. Each one should note who owns the decision
and by when it needs to be resolved.]

## Agent Instructions

[Anything every agent must do at the start of a session: which files to read,
which commands to run, which directories are off-limits.]
```

Keep it under 100 lines. If it grows beyond that, move detail to linked documents and keep the context file as a pointer map.

## Workflow

### Creating the file

1. Read the project: skim `README.md`, `package.json` or equivalent manifest, recent commits, and any existing planning docs.
2. Interview the user for anything the code does not make obvious: goals, constraints, open decisions, and team context.
3. Draft `PROJECT-CONTEXT.md` using the structure above.
4. Show it to the user for a quick review before committing.
5. Commit it with a clear message: `docs: add PROJECT-CONTEXT.md`.

Do not invent decisions or constraints. If something is genuinely unknown, record it in **Open Questions**.

### Updating the file

Update `PROJECT-CONTEXT.md` when:
- A significant architectural decision is made (cross-reference the ADR)
- A sprint or phase completes and the current state changes
- A constraint is lifted or added
- An open question is resolved

Update it inline — do not create a separate changelog. The git history is the changelog.

### Loading it in agents

When spawning a subagent (via `dev-team`, `story-lifecycle`, or any other skill), include the contents of `PROJECT-CONTEXT.md` as the first block of context. This replaces repeated re-discovery in every subagent prompt.

Prompt prefix pattern:

```text
Project context (read before responding):
---
[contents of PROJECT-CONTEXT.md]
---

Your task:
[actual task]
```

## Quality Checks

Before committing, verify:
- [ ] Under 100 lines
- [ ] No invented decisions — only what has actually been decided
- [ ] Every open question has an owner
- [ ] Agent instructions are specific enough to act on
- [ ] The architecture section would let a new agent write code without asking what the stack is

## Anti-Patterns

- Making it a README — it is an agent briefing, not documentation for humans
- Letting it go stale — a stale context file is worse than none; agents act on wrong assumptions
- Over-specifying architecture — link to ADRs for deep decisions, keep the file scannable
- Using it as a task list — use `story-lifecycle` for that
- Writing it once and never updating it — schedule a review at the end of each sprint

## Related Skills

- `dev-team` — uses PROJECT-CONTEXT.md as the shared starting point for all four roles
- `story-lifecycle` — turns decisions and goals into deliverable stories, fed by project context
- `architecture-decision-records` — captures the decisions referenced in the Accepted Decisions section
- `council` — decisions made here should be recorded back into PROJECT-CONTEXT.md

## Example

A minimal `PROJECT-CONTEXT.md` for a new SaaS product:

```markdown
# PROJECT-CONTEXT.md

> Last updated: 2026-01-15 | Status: active

## What This Is

A B2B invoice automation tool for small logistics companies. Users upload PDFs;
the system extracts line items, matches them to purchase orders, and flags
discrepancies for human review.

## Current State

- PDF extraction pipeline is live (Textract + custom parser)
- PO matching logic is 80% complete; edge cases for multi-currency POs are deferred
- Human review UI is in design; no code yet

## Architecture

- Backend: Node.js + Express, deployed on Railway
- Storage: PostgreSQL (Supabase) + S3 for raw PDFs
- PDF extraction: AWS Textract via Lambda
- Frontend: Next.js 14, App Router

## Active Constraints

- No new AWS services until the current Railway bill is understood
- All PII must stay in the Supabase VPC; never log file contents to stdout
- Two-person team; no PRs require review from both

## Accepted Decisions

- Textract over open-source OCR: accuracy on scanned PDFs is meaningfully better (ADR-001)
- Supabase over raw RDS: built-in auth and row-level security saves 2 weeks (ADR-002)
- Deferred multi-currency until v2: only 8% of beta users need it

## Open Questions

- How do we handle invoices with no matching PO? (Owner: @alex, by 2026-01-22)
- Do we need an audit log for compliance? (Owner: @maya, by end of Q1)

## Agent Instructions

- Read `src/extraction/README.md` before touching the PDF pipeline
- Never modify `supabase/migrations/` without running the test suite first
- The `staging` branch deploys to Railway staging automatically; `main` is manual
```
