---
description: Comprehensive PR review using specialized agents (code-reviewer, comment-analyzer, pr-test-analyzer, silent-failure-hunter, type-design-analyzer, code-simplifier). Use for a multi-agent PR review pass; for the adversarially-verified Workflow pass use /orch-review, and for the standalone step-by-step checklist review use /code-review.
---

Run a comprehensive multi-perspective review of a pull request.

## Usage

`/review-pr [PR-number-or-URL] [--focus=comments|tests|errors|types|code|simplify]`

If no PR is specified, review the current branch's PR. On GitLab, the argument is a merge request IID or URL. If no focus is specified, run the full review stack.

## Steps

1. Identify the PR:
   - If the argument is a URL, its host decides: a GitHub PR URL uses GitHub, a GitLab merge request URL uses GitLab
   - Otherwise (a number or no argument), use GitLab when the `origin` remote points to a GitLab host, and GitHub in every other case
   - GitHub: use `gh pr view` for details and changed files, and `gh pr diff` for the diff
   - GitLab: use `glab mr view` for details and `glab mr diff` for the diff
2. Find project guidance:
   - look for `CLAUDE.md`, lint config, TypeScript config, repo conventions
3. Run specialized review agents:
   - give each agent the diff from step 1 as its review input; do not let an agent substitute local `git diff` output
   - `code-reviewer`
   - `comment-analyzer`
   - `pr-test-analyzer`
   - `silent-failure-hunter`
   - `type-design-analyzer`
   - `code-simplifier`
4. Aggregate results:
   - dedupe overlapping findings
   - rank by severity
5. Report findings grouped by severity

## Confidence Rule

Only report issues with confidence >= 80:

- Critical: bugs, security, data loss
- Important: missing tests, quality problems, style violations
- Advisory: suggestions only when explicitly requested
