# Tiered Sandbox Progress

Last updated: 2026-09-08.
The execution evidence below retains its recorded scope. New rows identify the
fresh Podman repair and execution-fabric v2 verification separately.

## September 8 Approved Direction

The approved follow-on work is recorded in the existing
[execution-fabric design](EXECUTION-FABRIC.md#approved-direction-isolated-software-work).
Begin with an isolated build and verification showcase, then earn whole-agent
coverage through tool containment, independent evidence, resource monitoring,
credential revocation, and safe artifact export. Process/container/VM execution
classes and local/hosted placement are now separate, controller-derived v2
execution-fabric claims. Current v1 numeric tiers, capability meanings,
escalation bounds, and operational examples remain unchanged.

The v2 plan and fabric envelopes now record execution boundaries, shell-only
coverage, excluded agent surfaces, control limits, and bounded resource
observations. Stale telemetry and measured limit breaches abort execution and
trigger workspace cleanup. Whole-agent containment and its acceptance remain
pending. M2 supplies the runtime handle and cleanup evidence; M3 owns
durable task, attempt, and ExecutionCapsule authority, consumed by Feature Fleet.
The existing acceptance work below remains required. M1 profile development can
proceed using independently verified fixtures without waiting for these future
sandbox additions.

## User-visible acceptance path

1. An agent writes a strict `sandbox.yaml` containing needs and commands, not a
   backend name.
2. When hands-on Tier 1 testing would help, the agent calls `ecc-sandbox launch`
   with the manifest, specific purpose, and user's WezTerm or Terminal.app
   preference. The command returns an exact `y/n` question, a manifest-bound
   proposal ID, and creates no state or sandbox.
3. The agent repeats that question verbatim. `n` remains a no-op. After `y`, the
   agent passes the returned proposal ID and receives a truthful `launching`
   response rather than claiming the visible process has already checked in.
4. The user runs commands, CLIs, or available agents in the disposable Linux
   shell while the outside agent follows the same redacted event journal. The
   `exploration.started` event proves the interactive process opened.
5. The outside agent uses those observations to adjust the feature and offers
   another clean, consented run when useful. Exiting removes the exact owned
   Podman container; manual exploration never becomes verification evidence.
6. `scripts/sandbox/ecc-sandbox probe --refresh` returns the host capability
   map as JSON.
7. `ecc-sandbox run sandbox.yaml --dry-run` validates the manifest, expands
   target shards, and explains the first satisfying route for each shard.
8. `ecc-sandbox run sandbox.yaml` executes each local shard in the selected
   adapter, captures bounded output and install evidence, and destroys the
   disposable environment.
9. One recognized runtime denial may escalate one rung; the final JSON report
   records the original attempt, reason, destination, degradation notes, and
   cleanup outcome.
10. Unavailable local OS shards dispatch through the least-privilege GitHub
   Actions matrix only when authenticated CI capability is present. The CLI
   downloads and validates each artifact before emitting an aggregate report.
11. A caller can validate and interpret pass, fail, and error reports without
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

Rows naming Docker below are retained as historical development records. They
were produced after `d2c4ebad` added an opportunistic installed-Docker fallback.
That fallback contradicted the final Tier 1 contract and is superseded. Current
acceptance requires rootless Podman and does not probe or route Docker.

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
| 8 | escalation and CI integrity hardening | Paired Tier 1 native signatures, cleanup gate, run-wide one-hop budget, first-party/open-network CI gate, forced-native execution, canonical manifest digest, exact transcript/assertion validation, and flattened multi-shard aggregates | Pass; 148/148 sandbox tests cover local Tier 2, CI, fail-closed trust/network boundaries, artifact substitution, transcript forgery, and mixed aggregation |
| 8 | independent functional and security review | Re-reviewed agent runtime trust, source confidentiality, escalation authority, CI artifact integrity, global budget, and multi-shard aggregation after fixes | Pass; both reviewers approve with no blocker/high/medium/low finding |
| final | executable automated review | Greptile reproduced a managed Lume launcher exit that left its guest running before deletion and a nonzero guest stop that still reported pass | Fixed; cleanup now stops launcher, guest, then clone; stop failure makes the report an error; both paths have focused regressions |
| final | cross-platform portability | Host-bound VM routing, Windows mock SRT without an installed backend, real-mode SRT shim trust, and atomic Windows/POSIX Apple-guest reservation | Pass; focused tests pass on macOS and network-disabled Linux, with the Windows paths delegated to the hosted matrix |
| final | local integration train | Full `npm test`, sandbox suite, lint, skill validator, workflow-security validation, catalog/registry/install-manifest checks, npm package tests, real Tier 1 demo, and `git diff --check` | Pass; 3,861/3,861 repository tests, 148/148 sandbox tests, 9/9 skill tests, 9/9 hook tests, and 2/2 publish-surface tests |
| Gate 1 hardening | local Apple Silicon rootless Podman 6.1.0 | Visible WezTerm Tier 1 review `run_424dcac85aa8a9ca5e59d912c4e98561`, shared listener, fixed inspection, clean-home assertion, evidence pause, evaluation, and label-bound absence check | Pass; real Podman, cleanup pass, no remaining labeled container, 12,997 ms active plus 23,773 ms review wait |
| Gate 1 hardening | focused local suite | Fail-closed immutable resource receipts, multi-resource registry, state locks, manifest/capability/mock snapshots, structured redaction, active stop forwarding, process-group cleanup, guarded exploration runs, bounded atomic terminal video, and observable cleanup result | Pass; 182/182 sandbox tests plus 10/10 sandbox skill and 36/36 terminal-opener tests |
| Gate 1 hardening | fresh real visible acceptance | Tier 0 `run_6561a6055eda9f3853dae6ffe14af5f3`, Tier 1 `run_a014221bf32a12c0f1a5d88592ac7fa4`, and Tier 2 `run_9344e02ab1516f872035b51c021aaf8f` | Pass; real execution and deterministic verdict, cleanup pass, zero retained resources; active times 2,426 ms, 2,996 ms, and 28,268 ms respectively |
| Gate 1 hardening | real Tier 1 exploration and agent observation | Exploration `run_50625dd987895cc65ef9db4a75a8897c`, WezTerm PTY commands `pwd`, `id`, and a marker, plus journal listener and cleanup checks | Pass; user saw `/workspace` and uid 1000, agent received the same output through `exploration.output`, run remained non-evidence, and no Podman resource remained |
| Gate 1 hardening | optional video and local harness install | Atomic MP4 export for Tier 1 plus local Codex and Claude cache refresh | Pass; 68,757-byte redacted-journal MP4 with SHA-256 `767c7e49a1a224ae173fc24d75540ab1b4d8775171dc823fe8f699f36f455fc7`; both plugin caches byte-identical to the worktree |
| Gate 1 hardening | local full Claude installer Tier 1 acceptance | Initial `run_4a49d178ecb00753703a98817ff9b02d` followed by `run_bc2e1cc7abd254e79b9a2a4bb9a94e9d` after raising the bounded Podman diff list from 1,000 to 5,000 paths | Pass after a truthful initial inconclusive result; full `claude-project` install and immediate `doctor` produced zero warnings and errors, complete 1,474-added-path layer evidence, clean removal, recording, and 4,978 ms active time |
| Gate 1 hardening | complete local repository suite after Tier 1 installer demo | `npm test`, focused sandbox and skill lanes, ESLint, Markdown lint, publish-surface, dashboard, and diff checks | Pass; 3,929/3,929 repository tests, 183/183 focused sandbox tests, 11/11 sandbox skill tests, 2/2 publish-surface tests, and clean focused lint and dashboard checks |
| User-facing Tier 1 acceptance | Product contract and local implementation | Agent offers a purpose-specific `y/n` launch, user chooses WezTerm or macOS Terminal.app, user interacts with the tailored environment, agent follows output and iterates, and owned resources are cleaned | Implemented with a manifest-first `launch` command, no-state decline, manifest-bound proposal IDs, immutable consent records, truthful launching state, direct non-evidence exploration, shared listener, a bounded atomic terminal check-in watchdog, both terminal adapters, 46/46 terminal tests, 33/33 session tests, 15/15 exploration tests, 47/47 contract and router tests, 4,094/4,094 repository tests, and real detection of both terminal clients; a fresh user-approved visible Podman launch remains required for end-to-end acceptance evidence |
| Execution fabric | local contracts and adversarial suite | Strict plans and public envelopes, isolated copies, hardened worktrees, scheduler/reducer, environment receipts, snapshot quarantine, credential leases, route ranking, patch evaluation/promotion, trajectories, visual evidence, and event-log race tests | Pass; 105/105 focused fabric checks and 11/11 sandbox skill checks |
| Execution fabric | local meta-harness controller | Parallel three-target mock run, exact approved-route binding, unified run IDs, per-job deadlines and workspace cleanup, stable aggregate order, and candidate-only promotion | Pass; route drift is rejected before artifact creation; hung workers terminate, expire their leases, clean owned workspaces, and cancel dependents |
| Execution fabric | real host sanity | Tier 0 SRT worktree and candidate ref, conditional Tier 1 Podman, and Tier 2 Lume through the fabric controller | Tier 0 and Tier 2 pass with verified cleanup; the earlier Tier 1 block is superseded by the fresh Podman 6.1.1 run below |
| Execution fabric v2 | local contract and fault suite | Versioned class, placement, operator, shell-only coverage, excluded surfaces, control disclosures, bounded sampling, missing/stale telemetry, resource-limit abort, and cleanup trigger | Pass; v1 evidence remains valid, v2 claims are required on new plans/jobs, stale or over-limit samples stop, and owned workspaces are removed |
| Podman repair | local Apple Silicon rootless Podman 6.1.1 | Fresh libkrun machine, Ubuntu image build, real `install-ecc-clean-user.yaml` run, schema validation, layer diff, empty container inventory, and safe machine stop | Pass; rootless Linux arm64 execution completed in 12.86 seconds with a complete diff, then the VM and helpers stopped |
| Execution fabric | combined repository train | `npm test`, `npm run test:sandbox:fast`, focused ESLint, workflow YAML parse, Markdown lint, and `git diff --check` | Pass; 4,797/4,797 repository tests on the final Tier 2 tree, with focused sandbox, lint, workflow-security, YAML, publish-surface, and diff gates passing across the separated Tier 0, Tier 1, and Tier 2 branches |

## Current gate

S0 through S8 are historical. Gate 1 hardening and the opt-in execution fabric
have real Tier 0, Tier 1, and Tier 2 evidence plus mock Linux, macOS, and Windows
coverage. Podman is stopped safely after the fresh Tier 1 run. The three stacked
PR lanes and fresh hosted Linux and Windows checks remain the current release
gate. Whole-agent coverage remains outside this M2 slice.
