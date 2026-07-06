---
name: story-lifecycle
description: Manage a file-based epic → story → sprint development loop without requiring an external project management tool. Creates and tracks epics, breaks them into user stories, assigns them to sprints, and drives implementation story by story. Use when starting a new feature initiative or when the team has no Jira/Linear/Taiga but needs structured delivery tracking.
metadata:
  origin: community
  inspired-by: bmad-method (bmad-create-epics-and-stories, bmad-dev-story, bmad-sprint-planning)
---

# Story Lifecycle

A self-contained, file-based delivery loop: **Epic → Stories → Sprint → Implement → Done**.

No external PM tool required. All state lives in the repo under `.stories/`.

## When to Activate

- Starting a feature initiative and wanting structured delivery without a Jira/Linear/Taiga setup
- Breaking down a PRD or architecture doc into implementable units
- User says "create epics and stories", "plan this sprint", "what's next to build", or "implement the next story"
- Onboarding a project that tracks work in markdown files

### When NOT to Use

| Condition | Use Instead |
| --- | --- |
| Team already uses Taiga | `project-flow-ops` (GitHub/Linear) or Taiga MCP directly |
| One-off task with no breakdown needed | just do it |
| Architecture design first | `ecc:architect` then return here |
| PRD creation first | `ecc:plan-prd` then return here |

## Directory Layout

```
.stories/
  epics/
    <slug>.md          # one file per epic
  sprints/
    sprint-<n>.md      # one file per sprint
  <story-id>.md        # individual story files at root
```

Story IDs follow the pattern `<epic-slug>-<n>` (e.g. `auth-flow-3`).

## Commands

Invoke this skill with one of these sub-commands:

| Sub-command | What it does |
| --- | --- |
| `create-epic <title>` | Create a new epic file |
| `create-stories <epic-slug>` | Break an epic into user stories |
| `plan-sprint <n>` | Assign ready stories to a sprint |
| `implement <story-id>` | Drive implementation of a single story |
| `status` | Print a summary of all epics and story states |

If no sub-command is given, run `status` first and ask which action to take.

## Epic File Format

```markdown
# Epic: <Title>

**Slug:** <slug>
**Status:** draft | ready | in-progress | done
**Created:** YYYY-MM-DD

## Goal

<One paragraph: what user problem this epic solves and what success looks like.>

## Scope

- <in-scope item>
- <in-scope item>

## Out of Scope

- <explicitly excluded item>

## Stories

| ID | Title | Status |
| --- | --- | --- |
| <slug>-1 | <title> | todo |
```

## Story File Format

```markdown
# Story: <Title>

**ID:** <epic-slug>-<n>
**Epic:** <epic-slug>
**Sprint:** <n or unassigned>
**Status:** todo | in-progress | review | done
**Points:** <1 | 2 | 3 | 5 | 8>

## Context

<Why this story exists. One sentence linking it to the epic goal.>

## Acceptance Criteria

- [ ] <concrete, testable criterion>
- [ ] <concrete, testable criterion>
- [ ] <concrete, testable criterion>

## Technical Notes

<Constraints, edge cases, or implementation hints. Omit if none.>

## Definition of Done

- [ ] Code merged to main
- [ ] Tests cover the acceptance criteria
- [ ] No new lint errors
```

## Sprint File Format

```markdown
# Sprint <n>

**Start:** YYYY-MM-DD
**End:** YYYY-MM-DD
**Goal:** <one sentence>

## Stories

| ID | Title | Points | Status |
| --- | --- | --- | --- |
| <id> | <title> | <pts> | todo |

## Total Points: <sum>
```

## Workflow

### 0. Bootstrap (run once per project)

Before any sub-command writes to `.stories/`, check whether the directory exists:

```bash
test -d .stories || mkdir -p .stories/epics .stories/sprints
```

`create-epic` runs this check automatically. All other sub-commands assume `.stories/` exists and fail with a clear message if it does not: "Run `story-lifecycle create-epic` first to initialise the .stories/ layout."

### 1. create-epic

1. Run the bootstrap check above
2. Ask for the epic title and goal if not provided
3. Derive a slug (lowercase, hyphen-separated)
4. Write `.stories/epics/<slug>.md` using the epic template
5. Print: `Epic created: .stories/epics/<slug>.md`

### 2. create-stories

1. Read the epic file
2. Decompose the scope into 3–8 user stories following "As a… I want… so that…" format
3. Write one `.stories/<slug>-<n>.md` per story
4. Update the stories table in the epic file
5. Print a summary table

When decomposing:
- Prefer vertical slices (end-to-end thin feature) over horizontal (all backend first)
- Keep each story implementable in one session
- Mark dependencies between stories in Technical Notes

### 3. plan-sprint

1. Run `status` to show all `todo` stories with their points
2. Ask for sprint goal and dates if not provided
3. Ask the user to select stories by ID (or select automatically to fill ~80% of last sprint's velocity; default to 8 points for a first sprint)
4. Write `.stories/sprints/sprint-<n>.md`
5. Update `Sprint` field in each selected story file

### 4. implement

1. Read the story file
2. Read `PROJECT-CONTEXT.md` if it exists
3. Summarize the story goal and acceptance criteria to the user
4. Ask: "Ready to start? Any blockers?"
5. Implement the story using the appropriate ECC agents:
   - Code: implement, then delegate review to the language-specific reviewer agent
     (`python-reviewer`, `typescript-reviewer`, `go-reviewer`, `rust-reviewer`, etc.
     — detect from project files; fall back to `ecc:code-reviewer` if unsure)
   - Tests: delegate to `tdd-workflow` or `tdd-guide`
   - Docs: update inline
6. Walk through each acceptance criterion and verify it is met
7. Mark story status as `done`, update the epic's stories table, and update the matching row in `.stories/sprints/sprint-<n>.md`'s stories table to `done`

### 5. status

Print:

```
Epic: <title> [<status>]
  ✓ <story-id> <title>
  → <story-id> <title>   ← in-progress
  · <story-id> <title>   ← todo
```

Show sprint assignment when relevant.

## Anti-Patterns

- Writing stories that are too large to implement in one session
- Storing story files outside `.stories/` — breaks the status command
- Duplicating content already in `PROJECT-CONTEXT.md`
- Skipping acceptance criteria — they are the only definition of done

## Related Skills

- `dev-team` — reads and can generate `PROJECT-CONTEXT.md`; run it first to establish the project brief before creating epics
- `ecc:plan-prd` — create a PRD first if requirements are unclear
- `ecc:architect` — design the architecture before creating stories for a new system
- `council` — use when stories surface a genuine design tradeoff before implementation
- `project-flow-ops` — sync completed epics to GitHub issues or Linear
