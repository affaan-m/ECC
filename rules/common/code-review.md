# Code Review Standards

Review code after writing or modifying it, before commits to shared
branches, and always when the change touches security-sensitive areas
(auth, payments, user data) or system architecture. Before requesting
review, make sure automated checks pass, conflicts are resolved, and
the branch is up to date with its target.

## Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Security vulnerability or data-loss risk | Block — fix before merge |
| HIGH | Bug or significant quality issue | Fix before merge |
| MEDIUM | Maintainability concern | Fix when possible |
| LOW | Style or minor suggestion | Optional |

Approve with no CRITICAL or HIGH issues; block on CRITICAL.

## How to Review

Use the `/code-review` command or the **code-reviewer** agent for
general review. Bring in the **security-reviewer** agent (or the
`security-review` skill) whenever the change touches authentication,
user input handling, database queries, file system operations,
external API calls, cryptography, or payments. Language-specific
reviewers exist for TypeScript, Python, Go, and Rust.

Detailed checklists live with the tools that apply them: the
code-review command, the security-review skill,
[security.md](security.md) for the pre-commit security list, and
[testing.md](testing.md) for coverage expectations.
