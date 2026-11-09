# Copilot implementation execution record

Updated: 2026-11-07 (Europe/Rome). Source plan:
[COPILOT-IMPLEMENTATION-PLAN.md](COPILOT-IMPLEMENTATION-PLAN.md).
Integration branch: `feat/copilot-plan-implementation`.
Baseline: `a64711b70660e6f53e6f4066762a5bf3a67f4485`.

This increment implements and integrates several plan components. **M1 and M2
are not complete.** `review` below means implemented fixture-tested work with
acceptance gaps; it does not mean that an entire phase is finished. No native
minimum Copilot version, Windows compatibility or integration certification is
inferred from documentation, mocked payloads or Linux subprocess tests.

| Phase | State | Delivered | Remaining acceptance or implementation |
| --- | --- | --- | --- |
| P00 | review | Full machine inventory, source hashes, clean baseline and real Linux Copilot 1.0.105 discovery of 389 installed project skills | Windows native discovery, pre/post/lifecycle payload evidence and restart/recall |
| P01 | review | Versioned envelope including native resultType and failure events; alias/deny/error handling; distributed runtime closure; explicit verification report | Authenticated native event delivery, approved platform latency thresholds and Windows/macOS matrix |
| P02 | review | Bash/PowerShell destructive and sensitive-target guards, bounded preflight; opt-in complete-read/content-bound evidence with lifecycle/expiry | Native Windows corpus/feedback and actual full-view format; unsupported partial/decorated views conservatively produce no proof |
| P03 | review | Check/fix quality, successful-edit revisions/dedup, bounded canonical design input, crash-owner lock recovery and native warning output | Native check/fix delivery and declared-platform toolchain/latency evidence |
| P04 | review | Opt-in hook delivery metrics plus explicit persisted skill.invoked import, qualified identities, health adapter; missing outcomes/cost/context/governance remain unavailable | Authenticated signal emission and ephemeral data availability; no success or usage inferred from citations/file reads |
| P05 | review | Minimized sink, explicit canonical identity binding and backend consumption, quotas/retention/dedup, storage-fault and out-of-order tests | Native Windows filesystem/event fault matrix; no raw transcripts or automatic activation |
| P06 | review | Bounded metadata-sequences backend; review-only candidates/cursor; managed worker; actual installer, replay, retention and crash-boundary tests | Native Windows worker supervision and event delivery; semantic LLM backend remains unsupported |
| P07 | review | Selective stdio/authless HTTP/SSE configuration; bounded initialize-only JSON/SSE HTTP diagnostics; selected ownership rollback; isolated native user HTTP config readback | Authenticated remote services, native project trust/precedence, Windows and descendant process supervision; MCP lifecycle remains explicit |
| P08 | review | External canonical Vault; fixed Copilot MCP bootstrap; explicit setup/selected rollback; reviewed handoff; recipient and incomplete-result handling; canonical MCP and worktree fixtures | Native host loading and interactive cross-harness resumption, full platform/migration matrix; external runtime remains explicit |
| P09 | review | Strict native tool projection; role-bound read-only reviewers; explicit validated operator mappings/models; report CLI and actual 71-agent installer tests | Native direct/delegated enforcement; docs-lookup and gan-evaluator stay tools-empty unless an operator supplies verified mappings |
| P10 | implemented | Reviewed Copilot projections and explicit compatibility notices, corrected skill-local paths, Dart rule adaptation, full-profile npm package gate | Native invocation and external-provider evidence are tracked in P12 via NATIVE-018 and NATIVE-019 |
| P11 | review | Opt-in desktop and compact suggestions; project Canvas binding, non-consuming feedback notice and bounded manual retrieval that preserves the remaining queue; per-capability inventory limits | Native delivery and browser behavior; build and PR signals require structured correlated outcomes |
| P12 | blocked | Reproducible Linux offline discovery checked against planned skill destinations, installer/package fixtures and named native cases for observer, Canvas, plugin and advanced backends | Authenticated platform matrix, external integrations, behavioral comparisons and approved performance budgets; M1 remains open |
| P13 | review | Local artifact build/verify/preview; offline Linux CLI lifecycle, update and overlap/migration fixtures | Native authenticated plugin root expansion, hook delivery, observer shutdown, MCP coexistence, Windows/macOS and marketplace; depends on M1 |
| P14 | blocked | On-demand credential-free OS matrix, real npm tarball smoke and baseline checkpoint/instinct upgrade and rollback fixture | Matrix execution, approved native evidence and M2 release certification |

The difficult rows remain in scope. No exclusion or reduction of the user's
requested completion criteria has been assumed. Downstream source work can be
reviewed while upstream native evidence is pending, but it cannot certify the
dependent milestone.

## Run evidence

The implementation host has Node 24.22.1, Python 3.12.14 and Git 2.51.1 on
Linux. A separately installed Copilot CLI 1.0.105 was used with an isolated
configuration home for offline discovery: 389 project skills and 2 built-ins.
There is no Windows/macOS host or authenticated model session here. Offline
discovery does not certify hook delivery or tool execution.

A separate clean detached baseline checkout, sharing only installed dependencies,
ran `node tests/run-all.js copilot`: **167 passed, 0 failed, 13 files**.
The earlier dependency-free probe failed because `js-yaml` was unavailable;
that probe is not classified as a project regression. Yarn's immutable install
could not finish in this environment; `npm ci --ignore-scripts` succeeded using
the existing npm lockfile. No dependency versions or lockfile changes are part
of this increment.

P00–P05 final verification is recorded in
[`manifests/copilot-core-verification.json`](../manifests/copilot-core-verification.json).
Its `fixturesPassed` and per-phase checks are separate from `complete: false`
and the named native acceptance blockers.
The earlier expanded Copilot run passed 273 tests in 27 files; the current run
also includes the closure additions and is recorded separately. Native results
cannot be entered here without the CLI version, OS, revision, mode, named case,
redacted payload and observed decision/feedback. Unit, subprocess, installer and
package tests are separate from host evidence.

The P06–P09 integration and remaining acceptance boundaries are recorded in
[COPILOT-FOUR-PHASE-CLOSURE.md](COPILOT-FOUR-PHASE-CLOSURE.md).

The 2026-11-07 Linux run matched all 389 installed project skills by exact
path in isolated Copilot CLI 1.0.105. A separate offline plugin run exercised
local update and both overlap orders. The npm package smoke exercised the
actual generated tarball in an ESM project. A fixture created a checkpoint and
instinct using `a64711b7`, read them through the current installed helpers,
then read retained data using the baseline after repair and uninstall. It also
checks that uninstall preserves the new observer cursor byte for byte.

## Independent reviews

Independent implementation/review passes covered P01/P05, P03/P09 and P07/P08.
They found and corrected future-schema bypasses, contradictory success markers,
foreign/extra observation fields, duplicate quality deliveries, ambiguous session
aliases, credential-bearing MCP arguments and handoff proposals detached from
their manual checkpoint provenance. Regression tests preserve these fixes.

Review does not certify native enforcement of `strict-tools-list`, hook output
visibility or MCP configuration precedence. The guard denies repeated destructive
requests; repetition is never treated as operator evidence. Optional sink and
telemetry errors cannot replace a denial or manufacture a tool success.

## Reproduce and continue

```text
npm ci --ignore-scripts
npm run copilot:inventory
npm run copilot:check
npm run copilot:verify-core
npm run test:copilot
npm run copilot:verify-package
node tests/fixtures/copilot-upgrade.js
npm run test:validators
npm run harness:adapters
npm test
npm pack
```

Use the declared Yarn immutable install when available; `npm ci` is the fallback
verified for this execution. Run tests with the actual Python executable on
Windows rather than assuming `python3`. Inventory regeneration updates source
hashes, not evidence or capability acceptance states.

For automatic hooks, run from an isolated destination project:

```text
node /absolute/path/ECC/scripts/install-apply.js --target copilot --profile full --enable-hooks
```

Manual helper paths after commands installation:

```text
node .github/ecc/scripts/copilot-mcp.js doctor --config /absolute/project/.mcp.json
node .github/ecc/scripts/copilot-memory.js doctor
node .github/ecc/scripts/copilot-telemetry.js
```

MCP configuration is still an explicit operation, separate from project
installation. Memory doctor reports the external Vault runtime unavailable until
the operator supplies its package root. No observation worker is launched.

The next required host evidence is the P00/P01 native Windows run. P06 uses the
bounded metadata-sequences backend. Semantic model analysis remains unavailable.
P10 implementation is complete for the declared full project profile at this
snapshot. The source inventory retains other-host reference material. The
packed-install gate checks planned files, rendered instructions, literal managed
helpers and explicitly bundled skill assets. The gate records exact project
examples and non-runtime identifiers separately from unresolved dependencies.
One Python build-output ignore file is omitted by npm. External providers,
toolchains and notice-only workflows remain subject to their stated limits.
Native invocation evidence is recorded in P12 using the
[native Windows acceptance prompt](COPILOT-NATIVE-ACCEPTANCE.md) maps stable
case IDs to P00–P14 and defines disposable-project setup and evidence reporting. Only the named
Linux offline checks above have native CLI evidence for this increment.

## Rollback

Disable individual hook IDs with existing ECC controls, set
`ECC_COPILOT_QUALITY_MODE=off`, `ECC_COPILOT_OBSERVE=0` and
`ECC_COPILOT_TELEMETRY=0`, or use the existing managed uninstall. MCP has a
separate rollback that removes only still-owned entries. Checkpoints,
observations, telemetry, instincts and Vault records are preserved. Existing
session schema/hash meanings are unchanged; new stores have separate schemas.
Never remove stale locks until their writers have been confirmed stopped.
