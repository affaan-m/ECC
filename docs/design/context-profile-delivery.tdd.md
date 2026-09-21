# ECC-029 verification ledger

September 13 baseline branch: `feat/ecc-029-profile-delivery`, incorporating upstream main `8321021c` and the previous carrier branch. The September 21 continuation is recorded below. This report describes local development and packed evidence, not a public release.

## Reproduced failures and fixes

| Failure | RED evidence | Fix and GREEN evidence |
| --- | --- | --- |
| Windows profile CI identity fixtures | Synthetic inode `2 ** 60` reproduces missing-exception assertions because adding one does not change the Number | Guaranteed distinct test inode; host and large-inode fixtures pass |
| npm resource mismatch | Source inventory contains nested `.gitignore` omitted by npm | Publication-control files excluded from canonical resources; ten packed plans match source |
| Implicit-invocation policy race | Change `agents/openai.yaml` after compile and before policy read | Policy bytes revalidated against registry digests; preview/load reject drift |
| Windows managed-root parsing | Drive/UNC decomposition loses root separator | Platform-aware root preservation; drive/UNC tests pass |
| Interactive setup fixture race | Delayed startup sends blank answers and EOF before prompt | Prompt-driven PTY and final input closure; 30 tests and 36 existing-install combinations pass |
| Overconfident keyword Auto | Realistic JS review, RAG research and npm release queries select unrelated top scores | Names and generic scores only shortlist; loading requires explicit IDs or a separately admitted agent proposal |
| Native state and executable drift | Reviewed receipt resealing, stale revision, symlink/FIFO and binary replacement cases | Immutable transition binding, bounded regular-file reads, prepublication checks and pinned binary checks |
| Packaged native binary layout | Linux npm wrapper differs from assumed vendor path | Resolve and fingerprint the actual pinned platform binary; regression and real Podman pass |

New feature tests were introduced before their implementations. Independent review covered ownership, source races, exclusion/dependency policy, Windows paths, command validation, inherited authority, native provenance and failure propagation.

## Final focused verification

```sh
node --experimental-test-coverage --test \
  --test-coverage-include='scripts/lib/context-profile-*.js' \
  --test-coverage-include='scripts/lib/context-selection.js' \
  tests/lib/context-profile-*.test.js tests/lib/context-selection.test.js \
  tests/scripts/profile-selection.test.js
```

140 tests pass, zero failures. Aggregate coverage for the listed runtime files: 92.73% lines, 81.74% branches, 96.00% functions. This includes the lightly unit-instrumented native discovery subprocess adapter, which also has real-provider conformance below. These percentages are aggregate, not per-file or repository-wide guarantees. Native unit tests account for 25 cases; launcher/proposal/CLI review accounts for 35.

Final `npm test`, `npm run lint` and `git diff --check` all exit zero. The full runner reports 4,726 legacy-format passes and zero failures, and also executes the new native `node:test` files successfully. Its summary parser counts only `Passed:` output, so the separately measured 140-case focused result above is the precise native-runner count, not a claim that the full-suite summary includes every test format.

## Final fresh packed consumer

Command: `node docker/context-profiles/run-podman.js`. Final frozen run exits zero.

Tested npm archive SHA-256:

```text
34346621a1062358f96b1a3ce2f07ac6fe72067cd735771e30d06e1dc202335e
```

Linux arm64, Node 22.23.1, Codex 0.154.0. Normal packed installation completed during image build. The runtime container used the unprivileged node user, networking disabled, all capabilities dropped, no privilege escalation, no host mounts and no copied credentials. Task containers, image and temporary build directory were removed. The exact archive and acceptance log were retained separately; ordinary dependency build caches may remain.

- All ten Lean/Full target combinations match source plans and independent resource expectations. Lean has three skills. Full has 292 skills and 583 source resource files, plus one generated manifest for Claude, Codex and Pi.
- The packed managed CLI verifies Full to Lean to rollback Full, revision checks, idempotency, exclusions, Auto loading, suggest/manual/dry-run boundaries, receipt reuse and no-workflow reset.
- Packed `prepare-native`, `native-status` and `native-recover` pass. Isolated launch dry-run uses the pinned executable even with no provider on PATH.
- Native Codex discovery matches Lean, Lean plus Angular and Full excluding Python patterns. Resource digests survive marketplace carrier source removal. Six provider-owned system skills are reported separately.
- Actual managed/native product APIs switch 291 ECC skills to three and roll back to 291, preserving the Full exclusion and unrelated prior-home bytes. Every native preparation and rollback uses a fresh app-server and verifies discovery before pointer publication.
- Earlier isolated Claude Code 2.1.247 conformance validates and lists exact Lean/Full-with-exclusion inventory with zero hooks, agents, MCP and LSP components. Its projected token counter is not provider usage.

## Evidence boundaries

No authenticated model calls were made. Auto proposal and task transport, admission failures, executable pinning and state drift are tested with injected executable fixtures. Dry-run and native discovery are tested through actual packed provider executables. Model-driven task success, native skill invocation and token savings remain unobserved; there is no certified routing-quality percentage.

Native readiness attests the isolated generation and discovery in its empty project. Task launch inherits the actual working directory and its repository controls, so complete task-context equivalence is unverified. Codex proposal execution is filesystem-read-only but inherits provider tools; tool avoidance in its prompt is advisory. Claude proposal tools are disabled. Task execution inherits provider policy and requires normal authentication.

The store recovers actual process exits at five durable boundaries. Initial creation interrupted before its ownership marker, corrupted partial writes and numeric filesystem identity precision retain explicit limitations. Live installer migration, other-provider activation, interactive Auto bootstrap, whole-context outcome evaluation and default/release changes remain delivery gates. Native status never claims that an existing session changed context.

## September 21 production-acceptance continuation

Branch: `feat/ecc-029-production-acceptance`, with the working integration snapshot updated to upstream main `43b3a01e`. The writer session stopped at its provider usage limit after integrating the interactive and evaluation slices. A replacement session recovered the exact tmux transcript, process state, task log and worktree before continuing. No test process was still running and no conflicting writer remained active.

Additional RED/GREEN cases cover gaps found during review:

- Complete skill names in questions, quoted data or negated requests previously triggered implicit loading. Names now create candidates only; a user explicit ID or admitted agent proposal is required.
- A pending receipt could previously be reused and skip the provider decision. Receipts now bind routing-policy version and `selected`, `none` or `pending` decision state; only completed decisions can be reused.
- A changed or removed pinned Codex executable could leave native preparation unable to refresh. Explicit preparation may create a newly verified generation while preserving the old receipt and pointer until publication. Ordinary status and start remain fail-closed.
- Isolated native task launch previously inherited every caller environment variable. It now passes only pinned home paths, `PATH`, a fixed locale, a private temporary directory and the required Windows system root. Regression coverage proves unrelated cloud credentials, API keys, proxy settings and `NODE_OPTIONS` are absent.
- The Auto authority check previously missed the shipped `tools` frontmatter field. Scalar and array forms now require manual selection. Malformed task JSON now returns a fixed error without echoing task bytes.
- Provider and sandbox timeouts previously used a catchable termination signal. Launch, proposal, native discovery and sandbox supervision now use `SIGKILL`; a real subprocess that ignores `SIGTERM` verifies the sandbox bound.
- The acceptance driver previously trusted only the sandbox exit code. It now binds the executable and its complete implementation tree, rechecks both identities across preview and execution, and validates backend, tier, real execution, assertion commands, final smoke payload, architecture, layout matrix and evidence boundaries.

The opt-in interactive slice adds bounded UTF-8 task JSON on stdin, receipt-bound bootstrap instructions, installed-source and executable identity checks, exact Codex 0.154.0/0.155.1 version admission, safe refresh, and `profile start`. A real macOS arm64 Codex 0.155.1 run verified Lean, an explicit include, Full with an exclusion, relocated resource digests, stdin resolution, bootstrap visibility, sign-in-screen startup and removed-binary refresh. No credential was copied and no authenticated task turn was made.

The source-only AI pilot fixes 13 selection probes and eight paired artifact tasks before execution. Registration binds corpus, registry, plans, implementation, Node runtime, pinned parser and validator dependency versions, model and binary. The provider adapter uses disposable homes, explicit opt-in, `CODEX_API_KEY`, bounded JSONL, deadlines and call counts. Independent artifact assertions and sanitized metrics are implemented. Synthetic tests validate the measurement path; they do not establish model quality. The 13/8 pilot remains below the 30/30 gate and therefore reports `insufficient-sample` even if every case passes.

Current combined verification after recovery:

- Focused registry, carrier, store, native, interactive, resolver, admission, evaluation, sandbox and CLI suites pass, including the review regressions above.
- The final focused `node:test` run passes 182/182. Claude migration and setup compatibility suites pass 16/16 and 30/30. The complete repository runner passes 4,940/4,940; lint, diff checks and the production dependency audit all pass with zero vulnerabilities.
- The integration snapshot is current with upstream main `43b3a01e`. The latest-main Claude setup change removed obsolete install flags; migration dry-run and setup expectations now match the shipped command while retaining separate settings preservation.
- Clean commit `cda9c4bf` produced package SHA-256 `2ebc804ffc4f4c89fcf4b5ea0a9f644613618c1508292ef9199928157aa228d1`; both final driver receipts record that exact revision with `sourceDirty: false`.
- Real Tier 1 run `ecc-profile-tier1-89ead327-f193-4959-aff4-67cf8d381df3` passes on rootless Podman with a validated final smoke payload, a complete 10,758-added/4-changed layer diff, no credentials and exact cleanup.
- Real Tier 2 run `ecc-profile-tier2-fd4654a2-18b2-45f4-ba87-b8d0cd8bc488` passes on a disposable native macOS arm64 Lume clone with the same package digest. It validates all ten layouts, isolated Codex discovery, no credential transfer, stopped-guest cleanup and artifact-server cleanup. Lume v1 reports a bounded path scan with 49 added and nine changed files; it explicitly does not claim a complete disk diff.
- The initial Tier 2 attempt exposed `/tmp` as the standard macOS symlink to `/private/tmp`. The acceptance verifier now canonicalizes its newly created private directory while the production managed-store guard continues to reject symlinked roots. A second guest run proved the corrected path.
- The default sandbox checkout's 5,000-path capture limit truncated a real Tier 1 install diff and failed closed. The reviewed ECC-029 sandbox implementation raises the bounded cap to 50,000, passes its 26-case boundary suite, and produced both final reports. The driver receipt binds its 51-file implementation digest `a84e09ab848b8cd05f33792c13734f7aabe16bfe16d50d8f8292eb5261a93c3a`.
- No real AI outcome call ran because `CODEX_API_KEY` was absent. Host ChatGPT authentication was neither copied nor exposed to the disposable evaluator.

These boundaries keep the shipped behavior distinct from the M1 release gate. Authenticated outcome observations, a complete Tier 2 disk diff, live-install migration, other-provider activation, whole-context token truth and release defaults remain unverified until their explicit prerequisites are available.
