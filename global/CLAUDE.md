# Development Guidelines

## Language

- **Code, commits, PR/MR**: English
- **Conversation with user**: Korean

## Before Writing Any Code

Always orient yourself first:

- Read existing code in the affected area before making changes
- Match the project's naming conventions, patterns, and idioms
- Check how similar problems were solved elsewhere in the codebase
- If a local `CLAUDE.md` or style guide exists, read it before proceeding

## Scope Assessment

Before choosing Simple vs Complex path:

- Files affected: 1–2 → Simple candidate
- Files affected: 3+ or cross-directory → Complex
- Risky/irreversible change → Complex regardless of size

## Simple Changes

Trivial fixes (typos, single-line, obvious bugs): fix → verify → commit directly.

## Complex Changes Workflow

### 1. Plan

**Planning comes first — before writing any code.**

Before doing anything, think through:

- What is the actual problem being solved?
- What are the edge cases and risks?
- What parts of the codebase are affected?
- What is the right approach, and why?
- Are there simpler alternatives?

Only after this thinking is done, decide whether to document it.
For non-trivial work, create `IMPLEMENTATION_PLAN.md` in the worktree root:

```markdown
## Stage N: [Name]
**Goal**: [Specific deliverable]
**Success Criteria**: [Testable outcomes]
**Tests**: [Specific test cases]
**Status**: [Not Started|In Progress|Complete]
```

- Update status as you progress
- Before removing the file, leave a short summary in the related issue and PR/MR:
  - completed stages
  - key decisions
  - verification/test results
- Remove file only after the summary is recorded

### 2. Create Issue

- GitHub: `gh issue create`
- GitLab: `glab issue create`

### 3. Create Branch & Worktree

Branch naming: `<type>/<short-description>`
Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

Worktree policy:

- Required for medium/large changes (multiple files,
  cross-directory refactors, risky changes)
- Optional for small scoped changes (single file, low
  risk, easy rollback)

### 4. Implement

For each stage: implement → verify quality (lint, format, type check, tests) → **commit**

Commit at the end of **every stage**, not all at once at the end.

### 5. Tests

- If the touched area has a test infrastructure,
  write/update unit tests for new or changed behavior
- If user-facing flows are affected and E2E
  infrastructure exists, create/update E2E tests
- If no automated test infrastructure exists (common
  in dotfiles), document manual verification steps
  and outcomes

### 6. Create PR/MR

**Get explicit user confirmation before creating the PR/MR.**

- GitHub: `gh pr create`
- GitLab: `glab mr create`

## Definition of Done

- [ ] Tests written and passing
- [ ] Code follows project conventions
- [ ] No linter/formatter warnings
- [ ] Commit messages are clear
- [ ] Implementation matches plan (if plan exists)
- [ ] No TODOs without issue numbers

## When Stuck

Maximum **3 attempts**. After that, stop and report
to user:

- What you tried and why it failed
- 2-3 alternative approaches
- Ask for direction before proceeding

## NEVER

- Use `--no-verify` to bypass commit hooks
- Disable tests instead of fixing them
- Commit code that doesn't compile
- Make assumptions — verify with existing code
- Keep trying after 3 failed attempts
- Create a PR/MR without user confirmation
- Skip planning and jump straight into implementation
