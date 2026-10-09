# ECC-029 carrier slice evidence

Date: September 8, 2026. Milestone: M1 canonical context profiles. The P2a/P2b/P2c stack follows [PR #3037](https://github.com/affaan-m/ECC/pull/3037), based on main `5064474d4d762dc9640234a41617cccb79185cec`. Environment: macOS 26.6.2 arm64, Node 24.9.0, ECC 2.2.1. This source-only report records local development evidence. The packed [carrier contract](context-carriers.md) defines the public boundaries.

## Test-first slices and review regressions

| Slice or regression | RED checkpoint | GREEN checkpoint and evidence |
| --- | --- | --- |
| P2a explicit required-resource output | `3b3a7c72`: 3 resource cases passed, 10 failed for missing declarations | `935861ac`: 13 resource cases pass; resource byte digests retain their meaning, while declaration changes affect provenance |
| P2b pure five-layout file planner | `09ec70d9`: 20 cases fail for the intended missing public module | `bdb317eb`: 22 planner cases pass, including subsequent path-alias regressions |
| Read-only carrier CLI journey | `3b3a7c72`: 1 CLI case passed, 6 failed for missing command behavior | `bdb317eb`: 7 cases pass; deterministic JSON, five layouts, exclusions, unsupported targets, argument rejection, unchanged temporary caller state |
| Packed public surface | `a2963136`: both publish-surface cases fail for the missing carrier contract | `bdb317eb`: 2 cases pass with the library, schema and public contract included |
| Portable path collision rejection | `337c560c`: 20 planner cases passed, 2 failed for case/NFC-equivalent directory prefixes | `bdb317eb`: all 22 pass; aliases with different child names fail before returning an artifact |
| P2c disposable acceptance fixture | `09ec70d9`: the intended helper entry point is absent | `fccadba2`: 19 fixture cases pass, including independent expected-plan and manifest checks, source removal, binary bytes, tampering, symlinks and cleanup |
| Fixture aliases fail before writes | `9454a0d5`: 17 cases passed, 2 failed because staging performed 6 writes before rejection | `fccadba2`: both adversarial cases reject with zero writes |

Preserve the RED/GREEN commits. Independent security/code review checked the file planner and CLI, reproduced the portable ancestor collision, and approved the corrected implementation. The acceptance helper received separate review and remains test-only. Source files and skill bodies are data during these checks; scripts are copied but never executed. Narrow manifests omit hooks and MCP settings, while preserved authority-related skill metadata remains a separate pre-activation policy gate.

## Focused checks and coverage

```sh
./node_modules/.bin/c8 --all \
  --include='scripts/lib/context*.js' \
  --include='scripts/profile.js' \
  --include='scripts/ci/validate-context-profiles.js' \
  --reporter=text --reporter=json-summary \
  --reports-dir=/tmp/ecc-029-carrier-coverage \
  --check-coverage --lines=80 --functions=80 --branches=80 --statements=80 \
  node --test tests/lib/context-pack-registry.test.js \
  tests/lib/context-profiles.test.js tests/lib/context-resources.test.js \
  tests/lib/context-carriers.test.js tests/lib/context-carrier-fixture.test.js \
  tests/scripts/profile.test.js tests/scripts/profile-carrier.test.js \
  tests/ci/context-profiles.test.js
node tests/scripts/npm-publish-surface.test.js
npm run lint
npm test
git diff --check
```

Focused results: 119 logical cases passed, zero failed or skipped. The breakdown is 18 registry, 12 compiler, 13 resource, 22 carrier, 19 fixture, 25 original CLI, 7 carrier CLI and 3 CI cases. Node's outer TAP summary reports 93 because the original CLI and CI files each wrap their own cases.

Runtime coverage: 98.33% statements/lines, 91.16% branches and 100% functions. All thresholds pass. A separate test-helper-inclusive review run reports 100% statements/lines/functions and 90.54% branches for that helper. Runtime coverage excludes test infrastructure.

## Real inventory and package verification

All ten source-tree Lean/Full combinations across Claude, Codex, Pi, OpenCode and Cursor passed disposable structural verification against the actual canonical inventory. Full contains 286 skills and 464 bundled files. Claude, Codex and Pi add one narrow manifest, giving 465 files; OpenCode and Cursor retain 464. Lean contains 3 skills and 3 source files, plus a manifest where applicable.

At implementation head `d52d3430`, the full `npm test` exited 0 and its legacy aggregate reported 4,423 passed and zero failed. That aggregate does not separately count the new node:test cases, which are reported explicitly above. Full ESLint/Markdown lint and whitespace checks passed before this source-only evidence update.

A real `npm pack` ran the normal prepack build. The archive SHA-256 was `dd0577889bfa09071cbd87b430b200f8d0eaf036c6b0fb583dc71ae2f855fd78`. A disposable consumer installed it with `npm install --offline --ignore-scripts --omit=dev --no-audit --no-fund --userconfig=/dev/null`, using a task-local cache explicitly primed online during the preceding PR-readiness check. This proves an offline cached install, not a dependency-free install.

The installed public dispatcher produced all ten Lean/Full carrier objects with deep equality to the checkout, including their complete digests. Each installed artifact then passed structural materialization using the installed package's own canonical skill resources and an independently compiled expected plan. Full's 464 bundled resources were verified in every layout. The isolated subprocess environment was allowlisted and its disposable home remained absent. Packed runtime resolution confirmed js-yaml 4.3.2.

A separate policy simulation denying Windows file symlinks passed all 54 new resource/carrier/fixture cases with zero skips. Directory links use junctions on Windows. This simulation supplies no native Windows filesystem or provider evidence.

Hosted review of the prerequisite PR subsequently identified dry-run argument ordering and directory-enumeration bounds. Fixes and their dependent-stack revalidation follow; the `d52d3430` results remain a pinned earlier checkpoint.

## September 9 review hardening and final verification

The stack inherits the prerequisite PR's global dry-run fix `9b5e3934` and bounded-reader fix `5f9503e6`. Their RED checkpoints are `c373b7fe` (27 CLI passes, 4 failures) and `ea00894d` (7 support-test failures). The reader keeps all file-byte and identity protections and now limits incremental directory enumeration. Public context-profile documentation describes the exact limits. Source-reader extraction received independent security review; its largest function is 20 lines.

Carrier checkpoint `ebd43bef` independently reproduced the global flag failure: 6 CLI cases passed and 1 failed. Merging the prerequisite fixes in `072a3160` makes all 7 carrier CLI cases pass, including a leading global flag and a flag between an option and its value.

The first merged focused run passed 98 outer tests and failed 2 alias regressions because their old `readdirSync` mocks no longer supplied synthetic alias names to the incremental reader. Test-only correction `46924366` models those same source directories through `opendirSync` instead. Both case/NFC spellings and the mandatory zero-staging-write assertions remain unchanged; independent review reran all 19 fixture cases successfully. No runtime change was needed.

Final focused execution uses the coverage command above plus `tests/lib/context-profile-support.test.js`. It passes 132 logical cases, zero failures or skips: 18 registry, 7 support, 12 compiler, 13 resource, 22 carrier, 19 fixture, 31 original CLI, 7 carrier CLI and 3 CI. Outer TAP reports 100 passes. Runtime coverage is 98.37% statements/lines, 91.43% branches and 100% functions, with every threshold passing.

Both prerequisite and carrier full-suite commands exited 0 with legacy aggregates of 4,429 passed and zero failed. The carrier run began at `072a3160`; its test-only mock correction was applied before the runner reached that fixture file, whose final 19/19 result was observed in the complete run. Runtime and packed files remained unchanged throughout. The final focused run independently exercised the corrected tests. Later changes update source-only evidence.

The rebuilt carrier archive at runtime revision `072a3160` has SHA-256 `45ef651dfab1a9da9af7b7b4b4546c84bc6b325a31a95dac47d52def060649e6`. Its offline cached install and all ten installed-provider-layout Lean/Full parity and structural checks passed again. The archive has 2,628 entries; none of these checks launches a provider. A Git diff verifies final runtime, schemas, manifests, package declarations, lockfiles and packed contracts are byte-identical to that revision.

The prerequisite runtime at `e54fd44c` separately passes 71 focused cases, 98.49% statements/lines, 90.46% branches and 100% functions, plus the full 4,429 aggregate. Its rebuilt offline-consumer archive has SHA-256 `e96826df9b336e180408c7765dcd4e09fca2fb7eb7252cbf84f2ff99d036b1a7`. Later prerequisite commit `be393cb0` only reconciles the source-only dependency evidence. Hosted CI is still pending for the latest PR revision.

Lower-priority review suggestions remain explicit follow-ups: failing projection labels, one exported supported-profile list, richer budget-failure inspection and preserving dual CLI/snapshot diagnostics. Process-lifetime compiler caching is deferred until an immutable snapshot and invalidation contract exists. The current schema fixes the budget at 8,000; alternate ceilings are rejected. Private fixtures currently have only synchronous callers, and noncanonical skill-root directories remain rejected under the existing inventory policy.

## Claims deliberately left unobserved

Native discovery, exact native exclusions, invocation, executable-mode needs, workflow outcomes, activation, hook consent, rollback, automatic routing and actual token savings still require their own gates. Schema validation checks shape; it cannot certify supplied artifact semantics. The independently compiled fixture checks exact layout, selection, file set and bytes. It uses a trusted private temporary parent and does not certify an arbitrary-destination transaction writer against hostile concurrent mutation. No native provider, model, container or VM was launched, and no package was published.

## October 8 static runtime-closure gate

Date: October 8, 2026. `scripts/ci/validate-carrier-closure.js` now plans every supported carrier layout for both Lean and Full and checks that each planned JavaScript file's relative `require`/`import` specifiers resolve to a file the same carrier plans. The static require-graph extraction technique is adapted from community PR #2788; that work's staged load smoke, which materializes a carrier and actually loads entry scripts from inside it, is deliberately not ported, and neither is command pruning. Both wait for carrier scope to widen beyond skills.

RED: `tests/scripts/validate-carrier-closure.test.js` added 8 `node:test` cases; all 8 failed, seven because the validator module was absent and the eighth because the npm gate was unregistered. GREEN: all 8 pass. A second RED for absolute specifiers and package imports failed 3 cases (the absolute path was ignored, packages were ignored, warnings had no kind); GREEN passes them. The supported-layout list is derived by planning every registry target and keeping the ones that return a layout, so a new layout is picked up without editing the validator.

Against the real registry the gate reports 5 supported layouts of 16 declared targets — `claude-plugin@1`, `codex-plugin@1`, `pi-package@1`, `opencode-project@1` and `cursor-project@1` — giving 10 projections and 2,941 planned files. 65 of those planned files are JavaScript: 13 per Full projection and none in Lean. They declare 35 relative specifiers, all 35 resolving inside their own carrier; every one is a sibling `./shared.mjs` import within `skills/ck`. The validator finds zero escapes and zero dynamic requires.

Zero escapes is the expected result and not evidence the check is idle. Carriers are skill-only today, so no skill script has a reason to reach past its own directory. The gate exists so that the first command, agent, rule or hook admitted into carrier scope cannot silently ship a script reference that the projection does not contain. Detection is pinned by fixtures rather than by the live inventory: a planted skill script requiring `../../../../../scripts/lib/context-profile-support` fails as `outside-carrier-tree` in all five layouts and names the specifier, a planted sibling-skill reference fails as `unplanned-target`, a planted non-literal `require` warns without failing, and a `require` shape quoted inside a string literal produces neither.

Absolute specifiers fail as `outside-carrier-tree`. A package import warns rather than fails, because carriers ship no `node_modules`; Node builtins, bare or `node:`-prefixed, are exempt. No skill script imports a package today.

Limits. Nothing is executed; the check reads bytes and resolves paths. A package warning names the dependency but cannot tell whether the host environment provides it. Resolution assumes Node's CommonJS candidates for `require` in `.js` and `.cjs` (the path, `.js`, `.json`, then a directory's `index.js` or `index.json`), and the exact specifier for `import()`, static `import`/`from`, and anything in `.mjs`; it does not model conditional exports, a nested `package.json` type field, or import maps. A non-literal `require` is reported, not resolved, so a carrier can still fail at load time through a path computed at runtime. Native discovery, executable mode and actual loading remain unobserved, exactly as before.

The scanner is pinned by twelve edge cases (regex versus division, regex classes and quotes, template interpolations with object braces, block comments, multi-line and re-exported `from`, and `path.join(__dirname, …)`). Across all 655 JavaScript files in the repository it found every relative specifier a plain pattern match finds outside comments and strings, with no scanner errors. The suite validates the real registry once, through the CLI, and shares that receipt between its real-registry cases: 4.8 s per run instead of 9.1 s, which matters because the test job runs in about 33 matrix cells.

Review follow-up. A third RED added 10 cases from review: spaced calls (`require ('./x')`, `require\n(...)`, `import (...)`, and `path.join (__dirname, ...)`), escaped specifiers (`\u002e`, `\x2e`, `\u{2e}`, escaped quotes and backslashes), Windows drive, UNC and `file:` URL specifiers, and a directory resolving through `index.json`. All 10 failed. GREEN cooks string and template escapes as the parser does, allows whitespace before call parentheses, treats drive, UNC and `file:` specifiers as absolute, normalizes backslash separators in relative specifiers and adds the `index.json` candidate. A fourth RED/GREEN stops `from` and `import` patterns matching across a closed `${...}` interpolation. Rescanning all 802 repository JavaScript files against the previous scanner changed only three results, each a false package warning removed (`${from}` and similar identifiers before a template chunk). The real registry still reports 35/35 resolved, zero escapes, warnings or package imports, in 3.5 s.

Second review follow-up. Review of that head found four ways the gate still passed a carrier that fails at run time, each reproduced before any change: an extensionless `import('./helper')` and a directory `import('./data')` resolved through the CommonJS candidates, although Node's ESM resolver does neither even from a CommonJS file; `require('./lib\\helper.js')` resolved to `lib/helper.js`, although Linux and macOS read the backslash as part of the filename; and in `if (ok) /['"]/.test(text); require('./missing')` the regex after the condition was read as division, so its quote opened a fake string that swallowed the `require`. A fifth RED added 12 cases, 9 failing: the four findings, the two regex conditions, and the `imports` shape. The three controls already passed: an exact `import()`, an extensionless `require`, and division after `a.if(x)` or a call inside a condition. GREEN records which specifiers arrive through `import` and resolves those by exact path. It reverses the earlier backslash normalization: a relative specifier containing a backslash now fails as `non-portable-separator`. It also tracks whether each closing paren ends an `if`, `while`, `for` or `with` condition. Rescanning all 802 repository JavaScript files against the previous scanner changed no result; 18 of them declare `import` specifiers. The real registry still reports 35/35 resolved and zero escapes, warnings or package imports, unchanged on every receipt count.

Third review follow-up. Review of that head found four more problems, each reproduced first. Two were older: an extensionless `require` still offered `.cjs` and `.mjs` candidates, which Node's CommonJS search never tries; and a regex directly after a block (`if (ok) {} /"/`) was read as division, so its quote swallowed a later `require`. Two had been introduced by the previous fix. The condition check looked only at the character before `if`, so `obj.` + newline + `if(x) / 2` read as a condition and its division as a regex. Exact import resolution also turned a tagged template named `from` into a failing import. A sixth RED added 9 cases, 7 failing. Its two controls passed: `require` resolving to `.json`, and a template passed to `import()` still counting as a dependency. GREEN limits CommonJS candidates to the path, `.js`, `.json` and a directory's `index.js`/`index.json`. It treats `}` as a statement boundary before a regex, and decides a condition from the token before the keyword, ignoring whitespace. Static `from` and side-effect `import` now accept only quoted strings, never template slots. Rescanning all 802 repository JavaScript files against the previous head changed no result. The real registry is unchanged on every receipt count: 35/35 resolved, zero failures or warnings.

Focused verification: 22 carrier cases, 12 compiler cases, 54 closure cases, 3 CI cases and 2 publish-surface cases pass with zero failures or skips. ESLint passes on the validator and the new test. The validator is CI-only and stays out of the packed surface, matching `scripts/ci/validate-context-profiles.js`.
