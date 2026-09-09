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

Independent review reproduced ancestor substitution and terminal-control issues before fixes, then rechecked the fixes and approved the read-only boundary. Source identity checks do not create an atomic filesystem snapshot, and directory listing size is not independently bounded. Dependency coverage remains explicit-declarations-only and unreviewed. Required-resource annotations need a distinct output contract before selective P2 carriers can safely omit resources.

The existing js-yaml security update in contributor [PR #3032](https://github.com/affaan-m/ECC/pull/3032) must be verified and integrated before release. The new JSON-schema parsing path excludes the advisory's merge feature, but that does not clear existing default-schema parsers. See the [contract's dependency gate](context-profiles.md#contributor-integration-lanes).

Native carriers, active discovery, actual skill invocation, transactional activation, hook consent, automatic task routing, recovery, real-host token counters, broader context surfaces, cross-platform conformance, and default migration remain follow-on work. No provider calls, container or VM launches, or runtime profile changes were used to establish these results.
