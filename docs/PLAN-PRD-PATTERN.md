# Plan-PRD Pattern: Markdown-Staged Planning Flow

A lightweight, SDLC-aligned planning workflow where each phase of the lifecycle produces a committable markdown **staging file** that the next command consumes.

> Short version: `/plan-prd` writes a PRD, `/plan` writes a plan, the `tdd-workflow` skill implements it, and `/pr` ships it. Each arrow is a file on disk, not a conversation in memory.

## Feature: Markdown Staging Files

Every planning artifact is a plain `.md` file under `.claude/`:

```
.claude/
  prds/      # Product Requirements Documents from /plan-prd
  plans/     # Implementation plans from /plan
  reviews/   # Code review artifacts from /code-review
```

These files are:

- **Plain markdown** — readable by humans, diffable in PRs, grep-able at CLI.
- **Committable** — check them in alongside code so the intent travels with the implementation.
- **Composable** — each command accepts the previous stage's file as its `$ARGUMENTS`, so the toolchain composes via paths rather than in-context state.
- **Resumable** — close the session, open a new one tomorrow, pass the file path back in.

## Flow

```
┌───────────────────────────┐
│ /plan-prd "<idea>"        │  Requirements phase
│  → .claude/prds/X.prd.md  │   Problem · Users · Hypothesis · Scope
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ /plan <prd-path>          │  Design phase
│  → .claude/plans/X.plan.md│   Patterns · Files · Tasks · Validation
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ tdd-workflow skill         │  Implementation phase
│  → code + tests           │   Test-first, minimal diff
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ /pr                        │  Delivery phase
│  → GitHub PR               │   Links back to PRD + plan
└───────────────────────────┘
```

Each box is a **gate**. You can:

- Stop between gates — the artifact persists.
- Restart from any gate using the artifact path.
- Skip gates for small work — feed `/plan` free-form text and ignore `/plan-prd`.
- Run a gate standalone — `/plan "refactor X"` produces a conversational plan with no artifact.

## Why `/plan-prd` Is Additional to `/plan`

They answer different questions. Mixing them causes scope creep.

| Command | Answers | SDLC Phase | Artifact |
|---|---|---|---|
| `/plan-prd` | *What problem? For whom? How do we know we're done?* | Requirements | `.claude/prds/{name}.prd.md` |
| `/plan` | *What files, patterns, and tasks satisfy the requirement?* | Design + Implementation strategy | `.claude/plans/{name}.plan.md` (PRD mode) or inline (text mode) |

### Why not combine them?

- **Separation of concerns.** PRDs ask *why*; plans ask *how*. Bundling them creates one oversized command that does both poorly, as the old `/prp-prd` → `/prp-plan` pair demonstrated (8-phase interrogation with implementation-phase tables mixed into requirements).
- **Different audiences.** A stakeholder reviewing a PRD does not care about file paths or type-check commands. An engineer reading a plan does not need the market-research phase.
- **Different lifespans.** A PRD can remain stable while its plan is rewritten multiple times as implementation assumptions change.
- **Optional step.** Many changes (bug fixes, small refactors, single-file additions) don't need a PRD. `/plan` alone is enough. Forcing a PRD on every change is bureaucracy.

### When to use each

Use `/plan-prd` when:

- Scope is unclear or contested.
- Multiple stakeholders need to align on the problem before solutioning.
- The change is large enough that writing down the hypothesis is cheaper than relitigating scope mid-implementation.

Use `/plan` directly when:

- Requirements are already clear (a bug report, a scoped refactor, a known migration).
- The work is small enough that a conversational plan + confirmation gate is sufficient.
- You already have a PRD — pass it to `/plan` and skip `/plan-prd`.

## Usage

### Full flow (feature with unclear scope)

```bash
# 1. Draft the PRD
/plan-prd "Per-user rate limits on the public API"

# → .claude/prds/per-user-rate-limits.prd.md created
# Answer the framing questions, provide evidence, define hypothesis and scope.

# 2. Pick the next pending milestone and produce a plan
/plan .claude/prds/per-user-rate-limits.prd.md

# → .claude/plans/per-user-rate-limits.plan.md created
# The plan includes patterns to mirror, files to change, and validation commands.
# PRD's Delivery Milestones table updates the selected row to `in-progress`.

# 3. Implement test-first
Use the tdd-workflow skill

# 4. Open the PR
/pr
# → PR body auto-references .claude/prds/... and .claude/plans/...
```

### Quick flow (scope already clear)

```bash
/plan "Add retry with exponential backoff to the notifier"
# Conversational planning, no artifact.
# Confirm, then use the tdd-workflow skill.
```

### Reference an existing PRD from elsewhere

```bash
# PRD was written by someone else, lives in your repo
/plan docs/rfcs/0042-rate-limiting.prd.md
```

`/plan` detects any `.prd.md` path and switches to artifact mode, parsing the Delivery Milestones table.

## Why staging files beat in-context state

- **Transferable**: drop the PRD path into a fresh session and you're caught up — no replaying a long conversation.
- **Auditable**: the PR reviewer sees *what you intended* next to *what you built*.
- **Versioned**: the staging file evolves in git history, same as code.
- **Machine-parseable**: `/plan` programmatically picks the next pending milestone; `/pr` programmatically links artifacts in the PR body. No prompt engineering required.

## Related commands

- `/plan-prd` — requirements (this pattern entry point).
- `/plan` — planning (consumes PRDs or free-form text).
- `tdd-workflow` skill — test-first implementation.
- `/pr` — open a PR that references PRDs and plans.
- `/code-review` — reviews local diffs or PRs; auto-detects `.claude/prds/` and `.claude/plans/` as context.

## Compatibility

This pattern adds ECC-native staging-file commands alongside the existing `prp-*` command set. The legacy PRP commands remain available for deeper PRP workflows and for users who already have `.claude/PRPs/` artifacts.

- `/plan-prd` is the lean requirements entry point for `.claude/prds/`.
- `/plan` can consume `.prd.md` files and produce `.claude/plans/` artifacts without requiring the legacy PRP directory layout.
- `/pr` is the ECC-native PR creation command and can reference `.claude/prds/` and `.claude/plans/`.
- `/prp-prd`, `/prp-plan`, `/prp-implement`, `/prp-commit`, and `/prp-pr` remain valid legacy/deep workflow commands.
