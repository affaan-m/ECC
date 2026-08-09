# Tiered Sandbox Progress

Last updated: 2026-08-08

## User-visible acceptance path

1. An agent writes a strict `sandbox.yaml` containing needs and commands, not a
   backend name.
2. `scripts/sandbox/ecc-sandbox probe --refresh` returns the host capability
   map as JSON.
3. `ecc-sandbox run sandbox.yaml --dry-run` validates the manifest, expands
   target shards, and explains the first satisfying route for each shard.
4. `ecc-sandbox run sandbox.yaml` executes each local shard in the selected
   adapter, captures bounded output and install evidence, and destroys the
   disposable environment.
5. One recognized runtime denial may escalate one rung; the final JSON report
   records the original attempt, reason, destination, degradation notes, and
   cleanup outcome.
6. Unavailable local OS shards dispatch through the least-privilege GitHub
   Actions matrix only when authenticated CI capability is present. The CLI
   downloads and validates each artifact before emitting an aggregate report.
7. A caller can validate and interpret pass, fail, and error reports without
   harness-specific SDKs or prose parsing.

The representative success path is a clean Linux ECC package/install smoke in
an ephemeral rootless environment with an accurate diff. Representative
failure paths are a denied undeclared system write with one-hop escalation and
an unavailable native OS with an actionable CI-auth error.

## Mission DAG

| Mission | Owner | Depends on | Owned surface | Gate |
| --- | --- | --- | --- | --- |
| S0 recon | integrator | — | conventions, decisions, progress | Phase 0 note and predecessor salvage review |
| S1 contracts/router | integrator | S0 | schemas, manifest loader, router, fixtures | malformed schemas fail; routing fixtures pass |
| S2 probe | probe owner | S1 | probe modules/tests | mock matrix plus truthful dev-host output |
| S3 report/Tier 0 | process owner | S1, S2 | reporter and srt adapter/tests | schema-valid benign and denial reports |
| S4 Tier 1 | container owner | S1, S2 | images, Podman/microsandbox adapters/tests | real Podman lifecycle plus mock hardened path |
| S5 escalation | integrator | S3, S4 | orchestration integration tests | exactly one recorded reroute |
| S6 CI matrix | CI owner | S1, S2 | workflow, CI adapter/tests | secure mocked dispatch plus hosted probe evidence |
| S7 Tier 2 | VM owner | S1, S2 | Lume/Lima/Windows/Tart adapters/tests | mock coverage; real available-host gate or explicit v1 redirect |
| S8 agent surface | docs owner | S3–S7 | skill, hook, docs, demo | two-harness manifest/report interpretation evidence |
| SF final train | integrator | S5–S8 | combined tree | focused tests, full suite, lint, real local pipeline |

The root agent is the integrator. Adapter missions are not released until S1's
schemas, routing result, adapter interface, and mock contract pass on the
combined tree.

## Evidence log

| Phase | Environment | Command/evidence | Result |
| --- | --- | --- | --- |
| 0 | local macOS worktree | Read root/project/dashboard instructions and central install handoff | Pass |
| 0 | predecessor branch | Reviewed PR #2625 five-commit diff and hardened Docker harness | Pass |
| 0 | predecessor branch | `docker compose config`, 11 harness tests, 7 skill tests, and 94 native install tests reported by recon | Pass; no real container run claimed |
| 0 | dashboard | `npm run check` after adding ECC-017 | Pass |
| 0 | official upstream sources | Verified SRT Apache-2.0 research preview, Podman Apache-2.0, microsandbox Apache-2.0 repo move, Lume MIT, Lima Apache-2.0, and dockur/windows MIT | Pass |
| 0 | official upstream sources | Verified Tart's Fair Source status, Microsandbox disk-only snapshot semantics, Windows Sandbox CLI, Podman diff lifecycle, and CI dispatch constraints | Pass |
| 1 | local contract fixtures | `npm run test:sandbox` | Pass, 36/36 across strict schemas, 20 routing cases, report semantics, and CLI JSON |
| 1 | local package boundary | `node tests/scripts/npm-publish-surface.test.js` | Pass, 2/2; sandbox CLI is present in the packed runtime surface |
| 1 | local dependency/tooling | Focused ESLint, Markdown lint, `yarn install --immutable`, and `git diff --check` | Pass |
| 1 | independent review | Code and security review after adversarial capability/report fixes | Pass; no blocker/high finding remains |
| 2 | local mock matrix | `npm run test:sandbox` | Pass, 47/47 across contracts/router and macOS/Linux/Windows probe fixtures |
| 2 | local Apple Silicon host | `ecc-sandbox probe --refresh` plus capability-schema validation | Pass; macOS/arm64 and HVF detected, Docker/CI ready, unavailable backends carry setup guidance |
| 2 | local package/workflow boundary | Clean npm install, publish-surface test, focused ESLint, workflow-security validator, and `git diff --check` | Pass |
| 2 | current-main integration | Rebased the three phase commits after PR #2625 merged; sandbox lock diff remains limited to exact `yaml@2.9.0` | Pass; current main's mutable `node-gyp@latest` prevents a repeatable immutable Yarn resolution without unrelated lock upgrades |
| 2 | hosted runner matrix | [PR #2734 run 31326806345](https://github.com/affaan-m/ECC/actions/runs/31326806345) on Ubuntu, macOS, and Windows | Pass; downloaded Linux x64, Windows x64, and macOS arm64 artifacts all validate against the capability schema |
| 3 | local contract and mock suite | `npm run test:sandbox` | Pass, 61/61 across contracts, routing, probe, reporter, SRT policy, Windows launch boundary, denial classification, and mock execution |
| 3 | current SRT on Apple Silicon macOS | Temporary lifecycle-script-disabled install of `@anthropic-ai/sandbox-runtime@0.0.71`; benign and outside-workspace fixtures | Pass; benign report is schema-valid `real` evidence, denied write created no file, and the CLI returned 77 |
| 3 | local integration boundary | Full `npm test`, focused ESLint/Markdown lint, workflow-security validation, publish-surface test, and `git diff --check` | Pass |
| 3 | independent security review | Three adversarial review rounds over environment inheritance, mock evidence, Windows launch, and mutable control files | Pass; no blocker/high finding remains |

## Current gate

S0 through S3 are complete. Phase 4 is released for pinned Linux images, the
rootless Podman lifecycle, and normalized install-diff evidence. Escalation,
hardened Tier 1, CI execution, VM adapters, and agent-facing surfaces remain
blocked by their preceding phase gates.
