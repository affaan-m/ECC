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
| S6 CI matrix | CI owner | S1, S2 | workflow, CI adapter/tests | secure mocked dispatch plus three native reports and a hosted aggregate |
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
| 4 | local contract and mock suite | `npm run test:sandbox` after containment, rootless, cleanup, diff-completeness, and immutable-image fixes | Pass, 77/77 |
| 4 | local Apple Silicon container host | Built and executed digest-pinned Ubuntu, Debian, and Fedora images as uid/gid 1000 | Pass; Node/npm smoke succeeds in all three arm64 images |
| 4 | local real Docker fallback | Two clean-user cowsay installs through the shared Tier 1 adapter | Pass; schema-valid real reports, complete 876-path layer diffs, cowsay/cowthink PATH changes, 85–108 ms starts, and no leaked containers |
| 4 | hosted rootless Podman matrix | [PR #2734 run 31335855339](https://github.com/affaan-m/ECC/actions/runs/31335855339) | Pass; Ubuntu x86_64/arm64, Debian x86_64, and Fedora x86_64 images built and executed |
| 4 | hosted real install evidence | Downloaded and schema-validated the run's two Ubuntu x86_64 report artifacts | Pass; real Podman, complete 876-path diffs, immutable image ID, cowsay/cowthink PATH changes, 88 ms then 81 ms starts, and workflow leak check passed |
| 4 | local integration boundary | Full `npm test` (3,789/3,789), lint, workflow-security validation, publish-surface test, YAML parse, and `git diff --check`; focused gates repeated after hosted fixes | Pass |
| 4 | independent security and functional review | Reviewed timeout containment, incomplete evidence, rootless enforcement, cleanup, portability matrix, and image-reference race | Pass; both reviewers approve with no blocker/high finding |
| 5 | local contract and mock suite | `npm run test:sandbox` after escalation, manual-rerun, hardened-network, snapshot-provenance, and cleanup-fallback fixes | Pass, 93/93 |
| 5 | local Apple Silicon host | Real SRT 1.0.0 denial followed by one automatic Docker-backed Tier 1 rerun of the offline install fixture | Pass; one recorded escalation, three destination steps pass, complete layer diff reports `/home/ecc/.local/bin/ecc-sandbox-demo`, denied host file is absent, and no container leaked |
| 5 | official v0.6.8 CLI contract and mocks | Exact `msb` version/doctor gate, restricted disk-snapshot seed/fork lifecycle, read-only source mount, explicit network policies, and Podman degradation | Pass; no real Microsandbox evidence claimed because this host has no `msb` |
| 5 | local integration boundary | Full `npm test` (3,806/3,806), lint, publish-surface test, registry-signature audit, production vulnerability audit, and `git diff --check` | Pass; 225 package signatures, 32 attestations, and zero vulnerabilities |
| 5 | independent functional and security review | Re-reviewed read-only mount grammar, cleanup-gated fallback, strict domain policy, bounded evidence, max-one escalation, and snapshot manifest-digest identity | Pass; both reviewers approve with no blocker/high finding |
| 6 | local CI contract and orchestration suite | Native-runner gate, shard routing, shell/environment boundary, three-target mock dispatch, URL-less run discovery, remote-ref binding, adversarial artifacts, and aggregate failure propagation | Pass; 14 CI tests and 107/107 focused sandbox tests |
| 6 | local integration boundary | Full `npm test` (3,816/3,816), then post-review focused suite, lint, workflow YAML parse, workflow-security validation, publish-surface test, and `git diff --check` | Pass |
| 6 | independent functional review | Re-reviewed failed-shard aggregation, evidence upload ordering, remote-ref identity, URL-less dispatch discovery, and mock/real artifact separation | Pass; approved with no blocker/high finding |
| 6 | independent security review | Reviewed workflow injection, least privilege, action pinning, native environment boundary, `gh` argv handling, ref identity, artifact integrity, and fail-closed behavior | Pass; approved with no blocker/high/medium finding |
| 6 | hosted native and aggregate matrix | [PR #2734 run 31338814411](https://github.com/affaan-m/ECC/actions/runs/31338814411) on Ubuntu x86_64, macOS arm64, Windows x86_64, then Ubuntu aggregation | Pass; all four downloaded artifacts validate as real/pass, and the aggregate contains exactly the three requested passing children |
| 7 | local VM contract and mock suite | Lume 0.5.1, Lima 2.2.0, optional Tart 2.32.1, Windows detection/CI redirect, seed validation, Apple lifecycle lock, bounded scans, deadlines, and cleanup tests | Pass; 22/22 focused VM adapter tests, including separate-PGID and launcher-crash helpers, process-collision controls, and a 1 ms ownership deadline |
| 7 | local Apple Silicon Lume guest | Real unattended macOS Tahoe seed; `ecc-sandbox run tests/fixtures/sandbox/lume-real-pkg.yaml --local-only` | Pass; schema-valid real Tier 2 report, helper barrier verified, `.pkg` receipt assertion, scan-classified `/Library/LaunchDaemons/org.ecc.sandbox.phase7.plist`, 79.8-second final run, clone deleted, seed stopped, and zero attributable host helpers |
| 7 | short-run process-tree gate | Real `exit-only` Lume run with immediate cleanup after one setup and one assertion | Pass in 25.4 seconds; helper barrier verified, launcher and descendants stopped, clone deleted, seed stopped, and zero attributable Lume/SSH helper processes remained |
| 7 | Lume bootstrap compatibility | Tested the versioned Tahoe OCI pull and official Apple IPSW creation paths with Lume 0.5.1 | OCI reconstruction failed on the current 300-part image; verified unattended IPSW creation is the documented v1 seed path |
| 7 | local integration boundary | Full `npm test`, sandbox suite, lint, publish-surface test, and `git diff --check` | Pass on the stable final tree; 3,845/3,845 repository tests, 132/132 sandbox tests, and 2/2 publish-surface tests |
| 7 | independent functional and security review | Re-reviewed helper ancestry/PGID escape, launcher crash/reparent, PID/IP/executable collisions, deadline bounds, lock serialization, routing, and scan evidence | Pass; both reviewers approve with no blocker/high/medium finding |
| 8 | local agent surface | Skill initializer/validator, strict skill metadata, capability workflow, user guide, optional denial hint, install module/package surface, and schema-valid eval fixtures | Pass; skill validator, 9 skill tests, 9 hook tests, catalog, manifest, and publish-surface gates pass |
| 8 | local real Tier 1 demo | `ecc-sandbox run examples/sandbox/install-ecc-clean-user.yaml` on Apple Silicon through the Docker fallback | Pass in 0.7 seconds; minimal Codex profile installed into a disposable Linux home, sandbox skill and install state asserted, complete 398-path layer diff, networking disabled, and container removed |
| 8 | fresh Claude Code harness | Customization-disabled, no-session structured-output run given only the skill, task, and schema-valid failing report | Pass; generated manifest validates against the production schema and correctly identified fail/Podman/Tier 1/real, version assertion, SRT-to-Podman transition, complete diff, and degraded isolation |
| 8 | fresh Codex harness | Ephemeral, rules-disabled, read-only run in an empty temporary directory given the same skill/task/report | Pass; portable structured output and generated manifest validate, with the same correct bounded interpretation and no repository context or tool use |
| 8 | escalation and CI integrity hardening | Paired Tier 1 native signatures, cleanup gate, run-wide one-hop budget, first-party/open-network CI gate, forced-native execution, canonical manifest digest, exact transcript/assertion validation, and flattened multi-shard aggregates | Pass; 146/146 sandbox tests cover local Tier 2, CI, fail-closed trust/network boundaries, artifact substitution, transcript forgery, and mixed aggregation |
| 8 | independent functional and security review | Re-reviewed agent runtime trust, source confidentiality, escalation authority, CI artifact integrity, global budget, and multi-shard aggregation after fixes | Pass; both reviewers approve with no blocker/high/medium/low finding |
| final | cross-platform portability | Host-bound VM routing, Windows mock SRT without an installed backend, real-mode SRT shim trust, and atomic Windows/POSIX Apple-guest reservation | Pass; focused tests pass on macOS and network-disabled Linux, with the Windows paths delegated to the hosted matrix |
| final | local integration train | Full `npm test`, sandbox suite, lint, skill validator, workflow-security validation, catalog/registry/install-manifest checks, npm package tests, real Tier 1 demo, and `git diff --check` | Pass; 3,859/3,859 repository tests, 146/146 sandbox tests, 9/9 skill tests, 9/9 hook tests, and 2/2 publish-surface tests |

## Current gate

S0 through S8 and the local integration train are complete. The final head is
released to the hosted Ubuntu, macOS, Windows, Tier 1, probe, and native matrix.
