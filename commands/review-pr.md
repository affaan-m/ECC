---
description: Comprehensive PR review using specialized agents (code-reviewer, comment-analyzer, pr-test-analyzer, silent-failure-hunter, type-design-analyzer, code-simplifier). Use for a multi-agent PR review pass; for the adversarially-verified Workflow pass use /orch-review, and for the standalone step-by-step checklist review use /code-review.
---

Run a comprehensive multi-perspective review of a pull request.

## Usage

`/review-pr [PR-number-or-URL] [--focus=comments|tests|errors|types|code|simplify]`

If no PR is specified, review the current branch's PR. On GitLab, the argument is a merge request IID or URL. If no focus is specified, run the full review stack.

## Steps

1. Identify the PR:
   - GitHub (default): use `gh pr view` to get PR details, changed files, and diff
   - GitLab (the argument is a GitLab merge request URL, or the `origin` remote points to a GitLab host): use `glab mr view` for details and `glab mr diff` for the diff
2. Find project guidance:
   - look for `CLAUDE.md`, lint config, TypeScript config, repo conventions
3. Run specialized review agents:
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
