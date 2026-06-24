---
description: "Create a GitHub PR from current branch with unpushed commits — discovers templates, analyzes changes, pushes"
argument-hint: "[base-branch] (default: main)"
---

# Create Pull Request

> Adapted from PRPs-agentic-eng by Wirasm. Part of the PRP workflow series.

**Input**: `$ARGUMENTS` — optional, may contain a base branch name and/or flags (e.g., `--draft`).

**Parse `$ARGUMENTS`**:
- Extract any recognized flags (`--draft`)
- Treat remaining non-flag text as the base branch name
- Default base branch to `main` if none specified

---

## Phase 1 — VALIDATE

Check preconditions:

```bash
git branch --show-current
git status --short
git log origin/<base>..HEAD --oneline
```

| Check | Condition | Action if Failed |
|---|---|---|
| Not on base branch | Current branch ≠ base | Stop: "Switch to a feature branch first." |
| Clean working directory | No uncommitted changes | Warn: "You have uncommitted changes. Commit or stash first. Use `/prp-commit` to commit." |
| Has commits ahead | `git log origin/<base>..HEAD` not empty | Stop: "No commits ahead of `<base>`. Nothing to PR." |
| No existing PR | `gh pr list --head <branch> --json number` is empty | Stop: "PR already exists: #<number>. Use `gh pr view <number> --web` to open it." |

If all checks pass, proceed.

---

## Phase 2 — DISCOVER

### PR Template

Search for PR template in order:

1. `.github/PULL_REQUEST_TEMPLATE/` directory — if exists, list files and let user choose (or use `default.md`)
2. `.github/PULL_REQUEST_TEMPLATE.md`
3. `.github/pull_request_template.md`
4. `docs/pull_request_template.md`

If found, read it and use its structure for the PR body.

### Commit Analysis

```bash
git log origin/<base>..HEAD --format="%h %s" --reverse
```

Analyze commits to determine:
- **PR title**: Use conventional commit format with type prefix — `feat: ...`, `fix: ...`, etc.
  - If multiple types, use the dominant one
  - If single commit, use its message as-is
- **Change summary**: Group commits by type/area

### File Analysis

```bash
git diff origin/<base>..HEAD --stat
git diff origin/<base>..HEAD --name-only
```

Categorize changed files: source, tests, docs, config, migrations.

### PRP Artifacts

Check for related PRP artifacts:
- `.claude/PRPs/reports/` — Implementation reports
- `.claude/PRPs/plans/` — Plans that were executed
- `.claude/PRPs/prds/` — Related PRDs

Reference these in the PR body if they exist.

---

## Phase 3 — PUSH

```bash
git push -u origin HEAD
```

If push fails due to divergence:
```bash
git fetch origin
git rebase origin/<base>
git push -u origin HEAD
```

If rebase conflicts occur, stop and inform the user.

---

## Phase 4 — CREATE

### With Template

If a PR template was found in Phase 2, fill in each section using the commit and file analysis. Preserve all template sections — leave sections as "N/A" if not applicable rather than removing them.

### Without Template

Use this default format:

```markdown
## Summary

<1-2 sentence description of what this PR does and why>

## Changes

<bulleted list of changes grouped by area>

## Files Changed

<table or list of changed files with change type: Added/Modified/Deleted>

## Testing

<description of how changes were tested, or "Needs testing">

## Related Issues

<linked issues with Closes/Fixes/Relates to #N, or "None">
```

### Create the PR

```bash
gh pr create \
  --title "<PR title>" \
  --base <base-branch> \
  --body "<PR body>"
  # Add --draft if the --draft flag was parsed from $ARGUMENTS
```

---

## Phase 5 — VERIFY

```bash
gh pr view --json number,url,title,state,baseRefName,headRefName,additions,deletions,changedFiles
gh pr checks --json name,status,conclusion 2>/dev/null || true
```

---

## Phase 6 — OUTPUT

Report to user:

```
PR #<number>: <title>
URL: <url>
Branch: <head> → <base>
Changes: +<additions> -<deletions> across <changedFiles> files

CI Checks: <status summary or "pending" or "none configured">

Artifacts referenced:
  - <any PRP reports/plans linked in PR body>

Next steps:
  - gh pr view <number> --web   → open in browser
  - /code-review <number>       → review the PR
  - gh pr merge <number>        → merge when ready
```

---

## Edge Cases

- **No `gh` CLI**: Stop with: "GitHub CLI (`gh`) is required. Install: <https://cli.github.com/>"
- **Not authenticated**: Stop with: "Run `gh auth login` first."
- **Force push needed**: If remote has diverged and rebase was done, use `git push --force-with-lease` (never `--force`).
- **Multiple PR templates**: If `.github/PULL_REQUEST_TEMPLATE/` has multiple files, list them and ask user to choose.
- **Large PR (>20 files)**: Warn about PR size. Suggest splitting if changes are logically separable.
