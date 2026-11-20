---
description: Comprehensive PR review using specialized agents (code-reviewer, comment-analyzer, pr-test-analyzer, silent-failure-hunter, type-design-analyzer, code-simplifier). Use for a multi-agent PR review pass; for the adversarially-verified Workflow pass use /orch-review, and for the standalone step-by-step checklist review use /code-review.
---

Run a comprehensive multi-perspective review of a pull request.

## Usage

`/review-pr [PR-or-MR-number-or-URL] [--focus=comments|tests|errors|types|code|simplify]`

If no PR/MR is specified, review the current branch's pull request or merge request. If no focus is specified, run the full review stack.

## Steps

1. Identify the PR or Merge Request:
   - On GitHub (default): use `gh pr view` and `gh pr diff` to get PR details, changed files, and diff
   - On GitLab (gitlab.com or self-hosted, when given a GitLab MR IID/URL or a GitLab remote): use `glab mr view` and `glab mr diff` to fetch MR details, changed files, and diff
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
