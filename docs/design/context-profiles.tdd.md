# ECC-029 read-only context profile evidence

Date: September 8, 2026. Scope: the first P0/P1 implementation slice for M1, canonical context profiles. Baseline: main `5064474d4d762dc9640234a41617cccb79185cec`, ECC 2.2.1. Environment: macOS 26.6.2, Apple M4 Pro, Node 24.9.0. This is local development evidence, not a release or native-host certification.

Source intent: the accepted ECC-029 production and economics planning canvases in the maintainer workspace. Their approved first-slice journeys and boundaries are carried into the portable [implementation contract](context-profiles.md). Planning text was treated as design input; validation used reviewed local test, lint, package, and inspection commands. No activation, remote installer, publication, or credential-handling instruction was adopted. The project detector selected unavailable Bun; the actual test scripts run standalone Node, so Node and npm ran them without changing package-manager preferences.

## Journeys and test specification

| Approved journey and guarantee | Test target | Type | RED evidence | GREEN evidence |
| --- | --- | --- | --- | --- |
| Inspect versioned profiles and exact skill IDs without invoking skills or changing caller state | [CLI tests](../../tests/scripts/profile.test.js) | CLI journey/integration | `cd3950d3`: 24 failures for the missing command, entrypoint, and package inclusion | 25 passed, including later terminal-control regression; temporary home and workspace snapshots remain unchanged |
| Build one portable canonical skill inventory with validated ownership, explicit declarations, and resource digests | [Registry tests](../../tests/lib/context-pack-registry.test.js) | Unit/integration | `4c1b938b`: intended registry module absent | 15 passed, including source safety and repository inventory |
| Compile deterministic Lean/Full proposals with exact selectors, declared dependency closure, and honest metadata estimates | [Profile tests](../../tests/lib/context-profiles.test.js) | Unit/integration | `4c1b938b`: intended compiler module absent | 12 passed; 8,000 passes and 8,001 blocks the Lean metadata estimator, while native totals remain unknown |
| Gate every recognized target and register validation in the normal test workflow | [CI tests](../../tests/ci/context-profiles.test.js) | Integration | `5fcd9e08`: 3 failures for missing validation and registration | 3 passed; 2 profiles across 16 target IDs |
| Reject redirected source reads, unsafe metadata controls, and unstable cache-derived provenance | Registry and profile tests above | Security/regression | `f01d3366`: 23 passed and 3 expected failures during review | Same regressions pass; redirected descriptor receives zero byte reads in the substitution fixture |
| Keep user-supplied terminal controls inert in CLI error output | CLI tests above | Security/CLI | `254a6cc1`: 24 passed, 1 failed for raw OSC output | 25 passed |
| Ship the entrypoint, libraries, schemas, manifests, and contract together | [Publish-surface tests](../../tests/scripts/npm-publish-surface.test.js) | Packaging/integration | Existing explicit publish allowlist initially reported 1 pass and 1 failure | Updated expected public surface passes, plus real offline package smoke below |

The module-absence RED runs exercised the intended new public entry points; they were not failures of an unrelated dependency installation. The initial library checkpoint contained 20 cases; boundary and security review grew the focused library suite to 27. All listed checkpoints are local commits on `plan/ecc-029-harness-scoping`, reachable from the GREEN implementation commit. Preserve this record if later integration squashes those checkpoints. No separate refactor stage was performed after final GREEN validation.

## Executed checks

```sh
node --test tests/lib/context-pack-registry.test.js tests/lib/context-profiles.test.js
node tests/scripts/profile.test.js
node tests/ci/context-profiles.test.js
node tests/scripts/npm-publish-surface.test.js
npm run context-profiles:check
npm test
npm run lint
git diff --check
```

Final focused coverage execution also runs the first four feature test targets together:

```sh
./node_modules/.bin/c8 --all \
  --include='scripts/lib/context*.js' \
  --include='scripts/profile.js' \
  --include='scripts/ci/validate-context-profiles.js' \
  --reporter=text --reporter=json-summary \
  --reports-dir=/tmp/ecc-029-context-coverage \
  --check-coverage --lines=80 --functions=80 --branches=80 --statements=80 \
  node --test tests/lib/context-pack-registry.test.js \
  tests/lib/context-profiles.test.js tests/scripts/profile.test.js \
  tests/ci/context-profiles.test.js
```

Results: 27 library cases, 25 CLI cases, and 3 CI cases passed. Node's outer TAP summary reports 29 because the CLI and CI files each wrap their own cases. New-code coverage is 98.43% statements and lines, 90% branches, and 100% functions. Coverage thresholds all pass; no focused cases were skipped. Uncovered lines include a defensive source-error path and the single-profile text rendering branch.

The complete `npm test` command exited 0 and its legacy aggregate reported `Total Tests: 4423`, `Passed: 4423`, `Failed: 0`. Its aggregate does not separately count the new node:test library cases, which have their explicit result above. Existing platform-dependent tests can skip on macOS; this run supplies no Windows or Linux execution evidence. Full ESLint/Markdown lint, catalog/command validators, and whitespace checks passed.

## Packed offline user journey

Ran `npm pack` with the real prepack build into a disposable directory, followed by `npm install --offline --ignore-scripts --omit=dev --no-audit --no-fund --userconfig=/dev/null` into a disposable consumer. The install succeeded using cached dependencies. No package was published or globally installed.

The packaged dispatcher produced Lean and Full Codex previews, and the packaged direct entrypoint explained an exact skill ID. Both full proposed-plan objects were deeply equal to their checkout counterparts, including registry, profile, compiler, and plan digests. The subprocess environment used an explicit allowlist and a disposable user-home path, which remained absent after all three calls. This checks the real archive and runtime dependencies independently of the checkout's module resolution.

At this baseline, Codex Lean selects 3 entries and leaves 283 routed; Full selects all 286. The descriptor estimator reports 221 tokens from 879 bytes for Lean and 26,145 tokens from 104,168 bytes for Full. These are reproducible fixture estimates, not observed native startup tokens or demonstrated task savings.

## Review findings and remaining gates

Independent review reproduced ancestor substitution and terminal-control issues before fixes, then rechecked the fixes and approved the read-only boundary. Source identity checks do not create an atomic filesystem snapshot. The initial checkpoint lacked an independent directory listing bound; the hosted-review follow-up below closes that gap. Dependency coverage remains explicit-declarations-only and unreviewed. Required-resource annotations need a distinct output contract before selective P2 carriers can safely omit resources.

The existing js-yaml security update in contributor [PR #3032](https://github.com/affaan-m/ECC/pull/3032) must be verified and integrated before release. The new JSON-schema parsing path excludes the advisory's merge feature, but that does not clear existing default-schema parsers. See the [contract's dependency gate](context-profiles.md#contributor-integration-lanes).

Native carriers, active discovery, actual skill invocation, transactional activation, hook consent, automatic task routing, recovery, real-host token counters, broader context surfaces, cross-platform conformance, and default migration remain follow-on work. No provider calls, container or VM launches, or runtime profile changes were used to establish these results.

## PR-readiness follow-up

Independent exact-head review approved the read-only implementation and identified privilege-sensitive symlink fixtures. Review's original permission-denial injection produced 12 passes and 3 failures. Checkpoint `88f5a996` added a failing portable directory-link contract: 15 passes and 1 expected failure. The fix uses Windows junctions for directory cases, separates unconditional ownership and mocked leaf-link rejection from the real file-link integration case, and explicitly skips only that extra file-link case on Windows EPERM/EACCES. No runtime code changed.

Final local focused checks now pass 30 library, 25 CLI, and 3 CI cases. A bounded simulation of Windows file-link denial, keeping the local temporary directory fixed and emulating directory junctions, passes 17 registry cases and explicitly skips 1 real file-link case. It is a test-policy simulation, not native Windows evidence. The source-read substitution and zero-byte-read assertions remain mandatory.

An isolated Git archive passed `YARN_ENABLE_HARDENED_MODE=1 YARN_ENABLE_SCRIPTS=false yarn install --immutable --mode=skip-build`; both package manifest and Yarn lockfile remained byte-identical. The initially attempted immutable/update-lockfile combination was rejected by Yarn as incompatible before installation; the immutable skip-build run is the applicable successful CI check. Dependency declarations remain unchanged. Source-only evidence/test links in the shipped contract are now labeled explicitly.

### Contributor security prerequisite

Hosted CI for PR #3037 at `78cbd01c` reproduced the existing js-yaml high-severity advisory in its runtime audit. The branch incorporated contributor Myles Agnew's exact commit `5674661fc30ab1d3f3fcae22d72bfb4ab3059822` from #3032 using an attributed cherry-pick (`77872972`). No contributor PR was merged or closed. A fresh dependency install resolved js-yaml 4.3.2, and `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities.

The local npm 11 install unexpectedly rewrote the Yarn lock into its legacy format. Only that task-induced rewrite was restored to the committed contributor bytes before subsequent validation. This is installation-tool behavior, not an intended lockfile change. The full test run started on the preceding revision overlapped the dependency update and is excluded from exact-final-head evidence; final PR checks must bind to the updated head.

### Hosted review regressions

The global dry-run parser regression was reproduced before implementation in `c373b7fe`: 27 CLI cases passed and 4 failed. Fix `9b5e3934` removes exact global `--dry-run` flags before command/value parsing, without mutating caller arguments or weakening other validation. All 31 CLI cases and seven independent parser probes pass. Both public entrypoints retain unobserved activation.

Checkpoint `ea00894d` adds seven source-reader regressions for incremental enumeration, the exact per-directory boundary, empty-directory breadth, excluded cache names, handle cleanup and directory identity changes. The corrected reader accepts at most 10,000 names per directory and charges every directory open and enumerated entry against a 20,000-operation reader budget, allowing one lookahead to detect overflow. It retains the file, cumulative-byte and depth bounds. Focused support/registry/compiler checks pass 37/37, including the mandatory ancestor-substitution test with zero redirected file-byte reads.

The source reader was split into focused helpers below 50 lines. Directory handles close in `finally`, and identities are revalidated before and after enumeration. Independent review checked that descriptor no-follow flags, identity checks before the first file byte, post-read checks and exact byte digests survive the extraction. This remains a bounded consistency check, not an atomic filesystem snapshot.
