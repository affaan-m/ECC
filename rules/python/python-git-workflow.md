# Git Workflow

## Commit Message Format

```text
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

Note: Attribution disabled globally via ~/.claude/settings.json.

## Pull Request Workflow

When creating PRs:

1. Analyze full commit history (not just latest commit)
2. Use `git diff [base-branch]...HEAD` to see all changes
3. Draft comprehensive PR summary
4. Include test plan with TODOs
5. Push with `-u` flag if new branch

## Feature Implementation Workflow

1. **Plan First**
   - Use **planner** agent to create implementation plan
   - Identify dependencies and risks
   - Break down into phases

2. **TDD Approach**
   - Write tests first with pytest (RED)
   - Implement to pass tests (GREEN)
   - Refactor (IMPROVE)
   - Verify coverage with `uv run pytest --cov`

3. **Code Quality**
   - `uv run ruff check` for linting
   - `uv run ruff format` for formatting
   - `uv run ty check` for type checking

4. **Commit & Push**
   - Detailed commit messages
   - Follow conventional commits format
