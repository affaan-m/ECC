# Security and regression evidence — PR #3980

Source commit: `4ffff8d4c7f96f640597326ab793a4652df7acce`.
Pull request: https://github.com/affaan-m/ECC/pull/3980.

## Recorded secret scan

[GitGuardian Security Checks](https://github.com/affaan-m/ECC/runs/133854775089)
completed successfully for the source commit above. Its recorded summary is:
“**2** commits were scanned without uncovering any secrets.”

This is the secret-scanning result for that source commit. Adding this evidence
document does not establish a scanner result for a later commit.

## Changed surface and regression validation

The change normalizes framework and language aliases before instinct ranking.
The real hook regression is `tests/hooks/instinct-framework-aliases.test.js`.
The patch changes no dependency manifests or lockfiles.

Recorded validation on Linux:

- `ECC_TEST_ONLY=lib/instinct-relevance.test.js,hooks/instinct-framework-aliases.test.js npm test`:
  repository validators and both selected test files passed.
- Relevance suite: 20 passed. Actual project markers cover Next.js, Nest.js, C#,
  F#, and Go. Negative cases reject partial names, a C# match for a C project,
  and the ordinary lowercase verb “go”; underscore boundaries and explicit Go
  metadata are also covered.
- Three real SessionStart subprocess regressions passed. With a one-instinct
  limit, Next.js, C#, and Go projects select relevant guidance; disabling ranking
  restores confidence-only selection.
- Changed-module coverage: 97.77% lines/statements, 88.37% branches, 100% functions.
- ESLint, `git diff --check`, and `npm audit` passed; the audit reported zero
  vulnerabilities.

The complete repository suite and native Windows execution were not run.
