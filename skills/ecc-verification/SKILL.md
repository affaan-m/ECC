---
name: ecc-verification
description: Verify an implementation or refactor with project build, typecheck, lint, relevant tests, and diff review.
---

# Change verification

Read local project instructions, manifests, task scripts, and CI to identify the
checks relevant to the changed behavior. Run the required checks and meaningful
tests, preserving failures and exit statuses. For small reversible edits, use
proportionate validation; avoid tests that merely copy implementation details.

Inspect the final diff for accidental files, debug output, secret exposure,
untested failure paths, and unintended behavior changes. Do not impose a blanket
coverage percentage, mandatory TDD, or a new test framework on unrelated projects.

Report what changed, what ran and passed, and any material gaps. Distinguish
unavailable tools from passing checks. Stop after the relevant checks pass unless
new evidence justifies further testing. A request to verify does not itself
request a commit, push, deployment, or global configuration change.
