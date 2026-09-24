---
name: github-ops
description: GitHub操作、自動化、APIインテグレーション、およびCI/CDワークフロー。
origin: ECC
---

# GitHub Operations

Manage GitHub repositories with a focus on community health, CI reliability, and contributor experience.

## When to Activate

- Triaging issues (classifying, labeling, responding, deduplicating)
- Managing PRs (review status, CI checks, stale PRs, merge readiness)
- Debugging CI/CD failures
- Preparing releases and changelogs
- Monitoring Dependabot and security alerts
- Managing contributor experience on open-source projects
- User says "check GitHub", "triage issues", "review PRs", "merge", "release", "CI is broken"

## Tool Requirements

- **gh CLI** for all GitHub API operations
- Repository access configured via `gh auth login`

## Issue Triage

Classify each issue by type and priority:

**Types:** bug, feature-request, question, documentation, enhancement, duplicate, invalid, good-first-issue

**Priority:** critical (breaking/security), high (significant impact), medium (nice to have), low (cosmetic)

### Triage Workflow

1. Read the issue title, body, and comments
2. Check if it duplicates an existing issue (search by keywords)
3. Apply appropriate labels via `gh issue edit --add-label`
4. For questions: draft and post a helpful response
5. For bugs needing more info: ask for reproduction steps
6. For good first issues: add `good-first-issue` label
7. For duplicates: comment with link to original, add `duplicate` label

```bash
# Search for potential duplicates
gh issue list --search "keyword" --state all --limit 20

# Add labels
gh issue edit <number> --add-label "bug,high-priority"

# Comment on issue
gh issue comment <number> --body "Thanks for reporting. Could you share reproduction steps?"
```

## PR Management

### Review Checklist

1. Check CI status: `gh pr checks <number>`
2. Check if mergeable: `gh pr view <number> --json mergeable`
3. Check age and last activity
4. Flag PRs >5 days with no review
5. For community PRs: ensure they have tests and follow conventions

### Stale Policy

- Issues with no activity in 14+ days: add `stale` label, comment asking for update
- PRs with no activity in 7+ days: comment asking if still active
- Auto-close stale issues after 30 days with no response (add `closed-stale` label)

```bash
# Find stale issues (no activity in 14+ days)
gh issue list --label "stale" --state open

# Find PRs with no recent activity
gh pr list --json number,title,updatedAt --jq '.[] | select(.updatedAt < "2026-03-01")'
```

## CI/CD Operations

When CI fails:

1. Check the workflow run: `gh run view <run-id> --log-failed`
2. Identify the failing step
3. Check if it is a flaky test vs real failure
4. For real failures: identify the root cause and suggest a fix
5. For flaky tests: note the pattern for future investigation

```bash
# List recent failed runs
gh run list --status failure --limit 10

# View failed run logs
gh run view <run-id> --log-failed

# Re-run a failed workflow
gh run rerun <run-id> --failed
```

## Release Management

When preparing a release:

1. Check all CI is green on main
2. Review unreleased changes: `gh pr list --state merged --base main`
3. Generate changelog from PR titles
4. Create release: `gh release create`

```bash
# List merged PRs since last release
gh pr list --state merged --base main --search "merged:>2026-03-01"

# Create a release
gh release create v1.2.0 --title "v1.2.0" --generate-notes

# Create a pre-release
gh release create v1.3.0-rc1 --prerelease --title "v1.3.0 Release Candidate 1"
```

## Security Monitoring

```bash
# Check Dependabot alerts
gh api repos/{owner}/{repo}/dependabot/alerts --jq '.[].security_advisory.summary'

# Check secret scanning alerts
gh api repos/{owner}/{repo}/secret-scanning/alerts --jq '.[].state'

# Review and auto-merge safe dependency bumps
gh pr list --label "dependencies" --json number,title
```

- Review and auto-merge safe dependency bumps
- Flag any critical/high severity alerts immediately
- Check for new Dependabot alerts weekly at minimum

## Quality Gate

Before completing any GitHub operations task:
- all issues triaged have appropriate labels
- no PRs older than 7 days without a review or comment
- CI failures have been investigated (not just re-run)
- releases include accurate changelogs
- security alerts are acknowledged and tracked
