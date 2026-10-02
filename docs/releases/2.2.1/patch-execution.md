# ECC 2.2.1 bug and security patch execution

Status: in progress, 2026-09-07. Ticket: ECC-031.

## Outcome and authority

The user authorized reviewing, repairing, and merging critical bug and security
PRs, followed by publishing ECC 2.2.1. This advances the M0 distribution and
release-evidence contract. ECC retains policy, canonical state, and release
authority. New feature platforms, ECC 3 contracts, and broad refactoring remain
outside this patch.

## Integration sequence

1. Independently review and merge the verified PowerShell security fix #2961.
2. Repair installer ownership and uninstall dry-run data-loss reports #2964 and
   #2952. Exercise install, upgrade, dry-run, and uninstall on disposable roots.
3. Repair hook JSON truncation #2924, Pi/OMP recursive process spawning #2909,
   and project-scoped GateGuard exemptions #2921 without weakening denials.
4. Review manual Claude hook activation #2982 and plugin dependency loading
   #2822. Include complete, verified fixes; document any remaining limitation.
5. Verify memory MCP compatibility and existing heredoc fixes in current source
   and the actual packed artifact. Avoid duplicating already merged repairs.
6. Review the integrated diff, run focused and full tests, lint, coverage,
   security checks, and hosted platform and packed-lifecycle checks.
7. Update release notes to actual merged behavior. Verify exact current main,
   tag/version availability, signing identity, and registry publishing path.
8. Push the verified signed tag, watch the existing staged publication workflow,
   and verify public registry integrity, release, and install lifecycle.

## Working rules

- Independent reviews and fixes use separate worktrees. One integration owner
  serializes merges and checks the final combined result.
- Preserve contributor attribution. Consolidated or superseded PRs are linked
  to the actual merged fix; PR closure alone is not repair evidence.
- Hosted checks must correspond to the source being merged or released. Failed
  checks are diagnosed before a rerun.
- Never run lifecycle tests against real user homes. Never include credentials
  in logs, source, release notes, or dashboard records.
- Keep v2.2.0 immutable and publish only the single tested 2.2.1 artifact through
  the existing release workflow, with registry readback before latest promotion.

## Initial evidence

- Base: e04ea0b9cc8248686edf5ac751cadff550e162b8.
- Current GitHub account: haelyra, repository write permission verified.
- Repository NPM_TOKEN secret is configured; validity still needs publication.
- No remote v2.2.1 tag; registry lookup returns E404 for ecc-universal@2.2.1.
- Registry latest is 2.2.0. No local GPG private signing key or loaded SSH agent
  identity was available in the initial check. Signing remains an open gate.
- Independent review found that a later scalar assignment could mask an earlier
  unresolved PowerShell invocation in #2961. Commit bf0ac4e4 closes that bypass;
  52 classifier cases and 253 hook cases pass. Updated hosted checks are pending.

## Reviewed integration candidates

| Area | Source | Verification and scope |
| --- | --- | --- |
| Hook truncation | #2925, #2924 | 37 direct-entrypoint cases, 16 MiB bounded input, existing production limits preserved |
| Pi recursive spawning | #2911, #2909 | 28 adapter and 7 actual adapter-boundary tests, never launches compiled OMP as Node |
| GateGuard exemptions | #2979, #2921 | 192 cases; relative globs constrained to project, explicit absolute globs retained |
| Plugin dependency loading | #2994, #2822 | 10 cases; help/list paths need no third-party modules, required dependency failures are explicit |
| Yarn dependency security | Dependabot alert #62 | toml 4.3.0 matches npm lock; immutable Yarn install and recursive audit pass |
| PowerShell security | #2961 | 52 classifier cases, combined governance and GateGuard regressions; late-assignment bypass repaired |
| Manual Claude hooks | #2992, #2982 | 36 settings, 66 lifecycle, 42 install-apply cases; concurrent-edit and observed parent-swap tests |
| Installer data protection | #2980, #2981, #2956 | 23 ownership, 13 uninstall cases; all 15 target collision checks and failed-checkpoint regressions |
| Observer retention | #2971, #2673 | Merged cf065358 after 45 green hosted checks and independent review |
| Harness setup instructions | #2977, #2958, #2957 | 4 regressions; documented CLI, pinned real optional memory package, no fabricated scheduling server |

Plugin dependency handling does not bundle or automatically install modules.
Database and schema-validation features still require declared runtime packages.
The installer, PowerShell, and manual Claude registration fixes are now combined
and independently reviewed. Conflict resolutions preserve both project-scoped
exemptions and PowerShell enforcement, plus Claude settings locking and installer
ownership/checkpoint protections. Focused combined suites pass.

Claude settings pathname checks detect observed parent swaps and concurrent
edits; they are not a native filesystem isolation boundary. The residual race
between a final check and rename remains a follow-up, not a race-free claim.
Successful managed-file upgrades retain their existing replacement semantics.

## Completion evidence

First batch 82bfd225 passed 4,215/4,215 tests and lint. The first combined run
at 8cc31f1e passed 4,370/4,372 tests, with 89.27% line and 81.52% branch coverage.
Its two failures exposed guided setup reporting success after a late collision
was filtered. Full-preview revalidation fixes that interaction; all 22 guided
setup tests now pass, including initially identical unowned files before later
writes. Final full-suite and hosted validation are pending.

Windows hosted checks exposed fixture-owned descriptor cleanup and directory
rename assumptions in two new settings tests. The repaired fixtures preserve
Windows OS-refusal assertions and ECC parent-identity checks. CodeQL findings
338-341 were confined to test-source patterns; minimal assertion/interception
changes preserve coverage without alert dismissals. Hosted rescanning remains
required.

The first combined packed artifact passed the isolated macOS lifecycle, 13
memory MCP regressions, 12 actual Codex/Hermes protocol sessions, and 196
GateGuard cases including quoted, unquoted, and tab-stripped heredocs. Package
helpers, public CLI aliases, and dry-run entrypoints were exercised from the
installed archive, not just the source checkout. Final source must be repacked
after the guided-setup integration repair. Signing remains unavailable locally.

Pending final hosted validation, signed tag, publication, registry
integrity readback, and clean lifecycle canaries. This document does not claim
that 2.2.1 has shipped.

## Resumed verification, September 7

The secure GitHub gateway authenticated as an authorized repository maintainer.
All GitHub API requests in this continuation use that gateway. No local
credential inspection or signing-key discovery is part of this continuation.
The v2.2.1 tag and release are absent; npm returns E404 for 2.2.1 and still
reports latest 2.2.0.

The ba3a64a2 hosted run passed coverage, lint, CodeQL, and Linux tests, but nine
Windows test jobs failed. Gateway downloads for both job logs and test artifacts
returned HTTP 401 from redirected storage. Check metadata confirms failures
occur during tests after successful dependency installation. Failed-suite
annotations now expose bounded diagnostic context through the checks API.
The runner also counts subprocess failure when a suite prints `Failed: 0`.
Eight isolated runner regressions pass.

Follow-up review reproduced additional release defects. Ordered JSON merges
to one Kimi destination were collapsed by destination-only preview indexing;
operation-specific previews preserve the supported merge sequence (24 focused
tests pass). Array-form Claude commands now receive the same plugin-root
materialization as strings, including rejection of unresolved reads (seven new
and 36 existing settings tests pass). Static PowerShell alias and stdin values
are resolved conservatively, with independent review covering mixed named and
positional alias arguments. Hosted verification on the final patch remains
required before merge or release.

Run 34164970113 on 14e731c6 exposed the Windows failure through the new check
annotations: the Antigravity ownership fixture searched a native Windows source
path using a POSIX-only literal, then dereferenced a missing operation. The
fixture now normalizes separators and asserts both planned operations exist;
all 23 ownership tests pass locally. The diagnostic matcher also uses escaped
Unicode literals to satisfy the repository's Unicode gate, and excludes passing
error-handling case names from failure excerpts. Fresh hosted validation must
confirm these final fixture and diagnostic corrections.
