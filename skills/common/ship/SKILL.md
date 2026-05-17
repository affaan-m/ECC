---
name: ship
description: End-to-end delivery workflow — plan the work, open a GitHub issue, create a worktree under .claude/, implement with TDD, make staged commits, run the project quality gate, open a PR from the worktree branch, then await merge before safe cleanup. Use when the user asks to "ship" a feature/fix or wants the full deliver-to-PR flow.
---

# Ship

Take a unit of work from idea to merged PR using the project's isolated-worktree
workflow. This skill chains the full lifecycle and hands off to the `cleanup`
skill once the PR is merged.

## Prerequisites

- A clean working tree on `main` (or the repo's default branch).
- `gh` CLI authenticated (`gh auth status`).
- A clear description of the work to ship. If it is ambiguous, ask the user
  before proceeding.

## Workflow

### 1. Plan the work

- Restate the actual problem, edge cases, risks, and affected areas.
- Decide Simple vs Complex scope:
  - 1–2 files, trivial → Simple (lightweight plan, no plan file).
  - 3+ files / cross-directory / risky → Complex.
- For Complex work, write `IMPLEMENTATION_PLAN.md` in the worktree root (after
  step 3) with staged goals, success criteria, tests, and status.
- Do NOT write code yet.

### 2. Create a GitHub issue

```bash
gh issue create --title "<type>: <concise summary>" --body "<problem, approach, acceptance criteria>"
```

- Capture the returned issue number (`ISSUE`) for the branch and PR.

### 3. Create a branch and worktree under `.claude/`

Worktree is **always required**, even for Simple changes.

```bash
BRANCH="<type>/<short-description>"   # type ∈ feat|fix|refactor|docs|test|chore|perf|ci
WT=".claude/worktrees/${BRANCH//\//-}"
git worktree add "$WT" -b "$BRANCH"
cd "$WT"
```

- All subsequent steps run inside the worktree.
- Ensure `.claude/worktrees/` is git-ignored (it is via the repo's `.claude/`
  ignore entry); do not commit the worktree itself.

### 4. Implement with TDD

For each stage:

1. Write or update a failing test (RED).
2. Implement the minimal code to pass (GREEN).
3. Refactor (IMPROVE).
4. If no test infrastructure exists, document manual verification steps and
   outcomes instead.

### 5. Make staged commits

- Commit at the end of **every stage**, not all at once.
- Conventional format: `<type>: <description>`.
- Never use `--no-verify`; never disable tests to make a commit pass.

### 6. Run the project quality gate

Run the repo's lint, format, type check, and test suite, e.g.:

```bash
uv run ruff format && uv run ruff check && uv run ty check && uv run pytest --cov   # Python
# or: bun run lint && bun run typecheck && bun test                                  # Node
```

- Detect the correct toolchain from the project (`pyproject.toml`,
  `package.json`, Makefile). All checks must pass before opening a PR.

### 7. Open a PR from the worktree branch

**Get explicit user confirmation before creating the PR.**

```bash
git push -u origin "$BRANCH"
gh pr create --head "$BRANCH" --fill --body "Closes #$ISSUE

## Summary
...
## Test plan
- [ ] ..."
```

- Use `git diff main...HEAD` to draft a complete summary across all commits.
- Link the issue with `Closes #$ISSUE`.

### 8. Await merge, then safe cleanup

- Report the PR URL and stop active work. Do not delete anything yet.
- Poll merge state when asked, or when the user confirms it merged:

```bash
gh pr view "$BRANCH" --json state,mergedAt
```

- Once `state == MERGED`, invoke the **`cleanup`** skill to remove the
  worktree, delete the local branch, and pull `main`.
- Before removing `IMPLEMENTATION_PLAN.md`, record a summary (completed stages,
  key decisions, verification results) in the issue and PR.

## Output Contract

When invoked, report at the end:

1. Issue created (number + URL)
2. Branch and worktree path
3. Stages implemented and quality-gate result
4. PR created (URL) — pending user confirmation
5. Merge/cleanup status (awaiting merge, or cleaned up)

## Safety Rules

- NEVER skip the worktree, even for trivial changes.
- NEVER create the PR without explicit user confirmation.
- NEVER bypass commit hooks (`--no-verify`) or disable failing tests.
- NEVER clean up before the PR is confirmed merged.
- Stop and report after 3 failed attempts at any stage instead of continuing.
