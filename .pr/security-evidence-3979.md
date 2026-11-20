# Security and regression evidence — PR #3979

Source commit: `e9300358dac9d0b9460fa78ffe89552bc9fed367`.
Pull request: https://github.com/affaan-m/ECC/pull/3979.

## Recorded secret scan

[GitGuardian Security Checks](https://github.com/affaan-m/ECC/runs/133854741442)
completed successfully for the source commit above. Its recorded summary is:
“**2** commits were scanned without uncovering any secrets.”

This is the secret-scanning result for that source commit. Adding this evidence
document does not establish a scanner result for a later commit.

## Changed surface and regression validation

The change lets nested packages find a shared workspace formatter configuration.
The real hook regression is `tests/hooks/workspace-formatter.test.js`.
The patch changes no dependency manifests or lockfiles.

Recorded validation on Linux:

- `ECC_TEST_ONLY=resolve-formatter,workspace-formatter,stop-format-typecheck npm test`:
  repository validators and all three selected test files passed.
- Resolver suite: 24 passed, including repository and home boundaries, directory
  and worktree-file `.git` markers, child configuration overrides, and simulated
  Windows path-case differences at the home boundary.
- Two real post-edit and Stop hook regressions passed. They verify the root-local
  binary, working directory, file arguments, input pass-through, shared batch,
  and accumulator cleanup.
- Changed-module coverage: 99% lines/statements, 88.09% branches, 100% functions.
- ESLint, `git diff --check`, and `npm audit` passed; the audit reported zero
  vulnerabilities.

The complete repository suite and native Windows execution were not run.
