# CI Failure Diagnosis Playbook

Candidate id: `log-backed-minimal-fix`

Use this playbook when a PR, maintainer branch, or release-readiness branch has
one or more red GitHub Actions checks.

## Accepted Path

1. Capture PR and branch context:
   - `gh pr view <pr-number> --json files,statusCheckRollup,headRefName,baseRefName`
   - `gh run view <run-id> --json jobs`
2. Fetch the failed log evidence:
   - `gh run view <run-id> --log-failed`
3. Record the failing job, step, OS, Node/Python/Rust version, package manager,
   and shortest useful error excerpt.
4. Compare the failing step to the PR changed files.
5. Search current docs, tests, and prior PRs for a known matching failure mode.
6. Promote the smallest fix path only when it includes a local reproduction or
   regression command.
7. After a separate implementation branch exists, rerun the focused local gate,
   then wait for the full GitHub Actions matrix before merge.

## Rejected Path

Do not keep rerunning CI until a transient green result appears without
recording the original failure and why it is safe to ignore.

Do not weaken tests, skip matrix legs, or broaden the patch to unrelated files
just to make the check pass.

Do not claim release readiness from a branch with required checks still red.

## Minimum Validation

- `gh run view <run-id> --log-failed`
- Focused local command matching the failing surface, such as:
  - `node tests/<matching-test>.js`
  - `npm run harness:audit -- --format json`
  - `npm run observability:ready`
  - `cargo test`
- `git diff --check`
- Full required GitHub Actions matrix before merge

Record the failed-log excerpt and the chosen regression command in the
maintainer PR body or handoff before merging the fix.
