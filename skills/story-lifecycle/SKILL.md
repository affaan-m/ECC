---
name: story-lifecycle
description: File-based epic → story → sprint delivery loop without requiring an external PM tool. Use when you want structured delivery planning tracked in markdown files alongside the code.
metadata:
  origin: ECC
---

# Story Lifecycle

Run a full delivery planning loop — from epics down to sprint-ready stories — using plain markdown files checked into the repository. No external PM tool required. Everything lives next to the code, is readable by any agent, and survives tool changes.

## When to Activate

- Starting a new feature or initiative and want structured delivery tracking without leaving the repo
- A `dev-team` or `project-context` session produced a set of goals that need to be broken into deliverable work
- The team wants sprint planning that agents can read and update without a Jira/Linear dependency
- You need a lightweight project management layer that works offline, in air-gapped environments, or with any AI harness

## When NOT to Activate

- Your team already has a PM tool and you want to sync with it — use `jira-integration` or a direct API integration instead
- You need real-time collaboration or notifications — file-based tracking is asynchronous
- The work is a single small task with no sub-parts — just do the task

## File Layout

All delivery tracking files live under `.delivery/`:

```
.delivery/
├── epics/
│   └── EPIC-001-rate-limiting.md
├── stories/
│   ├── STORY-001-redis-setup.md
│   ├── STORY-002-middleware-limit.md
│   └── STORY-003-monitoring.md
└── sprints/
    └── SPRINT-01.md
```

Check this directory into the repository. It is part of the project, not a build artifact. The dot-prefix (`.delivery/`) keeps it out of the way of `src/` and `docs/` browsing while still being tracked by git — similar to how `.github/` holds CI config.

## File Formats

### Epic

```markdown
# EPIC-NNN: [Title]

**Status**: draft | active | complete | deferred
**Owner**: [name or agent]
**Goal**: [one sentence — what does shipping this epic achieve for the user?]
**Success metric**: [how will you know it worked?]

## Why Now

[1-2 sentences on why this epic is being worked now, not later.]

## Scope

- [in scope item]
- [in scope item]

## Out of Scope

- [explicitly deferred item and why]

## Stories

- [ ] STORY-NNN: [title]
- [ ] STORY-NNN: [title]
```

### Story

```markdown
# STORY-NNN: [Title]

**Epic**: EPIC-NNN
**Status**: backlog | ready | in-progress | review | done | blocked
**Owner**: [name or agent]
**Sprint**: SPRINT-NN (or unassigned)
**Estimate**: [S / M / L / XL]

## User Story

As a [role], I want to [action], so that [benefit].

## Acceptance Criteria

- [ ] [concrete, testable condition]
- [ ] [concrete, testable condition]
- [ ] [concrete, testable condition]

## Technical Notes

[Optional. Implementation hints, constraints, or dependencies an agent should
know before starting. Not a design doc — keep it under 5 lines.]

## Blockers

[List anything blocking this story, or leave empty.]
```

### Sprint

```markdown
# SPRINT-NN

**Start**: YYYY-MM-DD
**End**: YYYY-MM-DD
**Goal**: [one sentence — what does the team ship by the end of this sprint?]

## Stories

| Story | Title | Owner | Status | Size |
| --- | --- | --- | --- | --- |
| STORY-NNN | ... | ... | ready | M |
| STORY-NNN | ... | ... | in-progress | L |

## Sprint Notes

[Optional. Decisions made during the sprint, blockers resolved, or scope changes.]
```

## Workflow

### Phase 1: Epic from intent

When a goal or initiative arrives (from `project-context`, a `dev-team` session, or a user request):

1. Write an epic file in `.delivery/epics/EPIC-NNN-[slug].md`.
2. Fill in the goal, success metric, and why-now. Leave stories blank until Phase 2.
3. Confirm the epic scope with the user before breaking it into stories.

### Phase 2: Story decomposition

Break each epic into stories:

1. Each story must be deliverable independently — a story that blocks every other story is a design smell; reshape the epic.
2. Write acceptance criteria as concrete, testable conditions, not vague goals. "User sees an error message" is not testable. "POST /api/rate-limit returns HTTP 429 with a `Retry-After` header when the limit is exceeded" is.
3. Assign estimates: S (half day), M (1-2 days), L (3-5 days), XL (needs to be split).
4. Any story estimated XL must be split before it enters a sprint.

### Phase 3: Sprint planning

1. Create `.delivery/sprints/SPRINT-NN.md`.
2. Pull stories from `backlog` status whose combined size fits the sprint capacity.
3. Set the sprint goal — one sentence that captures what ships, not a list of stories.
4. Update each story's `Sprint:` field.
5. Move stories to `ready` status.

### Phase 4: Execution

During the sprint, update story status as work progresses:

- `ready` → `in-progress` when an agent or person starts the story
- `in-progress` → `review` when the implementation is complete and tests pass
- `review` → `done` when accepted
- any → `blocked` when a blocker appears; record the blocker inline

When an agent is given a story to implement, it should:
1. Read the story file
2. Read `PROJECT-CONTEXT.md` for system-level context
3. Check the story's acceptance criteria — these are the implementation target
4. Use `tdd-workflow` for implementation
5. Update story status to `review` when done

### Phase 5: Sprint close

At sprint end:
1. Move all `done` stories to closed state in the epic's story checklist.
2. Update epic status if all stories are done.
3. Record sprint notes: what shipped, what slipped, and why.
4. Carry unfinished stories into the next sprint with a note on why they slipped.

## Naming Conventions

- Epic IDs: `EPIC-NNN` (zero-padded three digits, sequential)
- Story IDs: `STORY-NNN` (same scheme, global across epics)
- Sprint IDs: `SPRINT-NN` (two digits, sequential)
- File slugs: lowercase with hyphens, derived from the title

## Integration with Other Skills

When handing a story to an agent:

```text
Project context:
---
[contents of PROJECT-CONTEXT.md]
---

Your story:
---
[contents of STORY-NNN.md]
---

Implement the story. Use tdd-workflow. Update the story status to "review" when done.
```

## Quality Checks

Before a story moves to `ready`:
- [ ] User story follows "As a / I want / so that" format
- [ ] All acceptance criteria are concrete and testable
- [ ] Estimate is S, M, or L (not XL)
- [ ] No circular dependencies with other stories in the same sprint
- [ ] Technical notes mention any known constraints an agent must respect

## Anti-Patterns

- Writing stories as task lists instead of user-facing behaviors — agents implement to the wrong target
- XL stories in a sprint — they reliably slip and block reviews
- Acceptance criteria that describe implementation rather than behavior ("use Redis" instead of "rate limit is enforced across restarts")
- Sprint goals that are just a list of story titles — a real goal is "users can sign in with SSO"
- Letting `.delivery/` go stale — outdated story status is noise that misleads agents

## Related Skills

- `project-context` — the shared source of truth that stories reference for system context
- `dev-team` — produces goals and constraints that become epics and stories
- `tdd-workflow` — the implementation loop agents use to work through a story's acceptance criteria
- `architecture-decision-records` — decisions made during a story's implementation should be captured here
- `jira-integration` — if your team uses Jira, use this skill to sync stories there instead of tracking them in `.delivery/`

## Example

A three-story epic for rate limiting:

**EPIC-001**: Add rate limiting to the public API to protect paid tier SLAs.

**STORY-001**: Set up Redis as a shared state store (M)
- AC: `REDIS_URL` env var is read; connection is validated at startup; missing var fails fast with a clear error

**STORY-002**: Enforce per-IP rate limits on all public API routes (L)
- AC: Requests beyond 100/min from one IP receive HTTP 429; response includes `Retry-After` header; limit resets after 60s

**STORY-003**: Emit rate-limit metrics to the observability pipeline (S)
- AC: `rate_limit.exceeded` counter is incremented on every 429; visible in the existing metrics dashboard within 5 minutes

**SPRINT-01 goal**: Rate limiting is live in production and visible in the dashboard.
