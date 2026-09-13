# ECC-029 September 13 verification

Branch: `feat/ecc-029-profile-delivery`, incorporating upstream main `8321021c` and the previous carrier branch. This report describes local development and packed evidence, not a public release.

## Reproduced failures and fixes

| Failure | RED evidence | Fix and GREEN evidence |
| --- | --- | --- |
| Windows profile CI identity fixtures | Synthetic inode `2 ** 60` reproduces missing-exception assertions because adding one does not change the Number | Guaranteed distinct test inode; host and large-inode fixtures pass |
| npm resource mismatch | Source inventory contains nested `.gitignore` omitted by npm | Publication-control files excluded from canonical resources; ten packed plans match source |
| Implicit-invocation policy race | Change `agents/openai.yaml` after compile and before policy read | Policy bytes revalidated against registry digests; preview/load reject drift |
| Windows managed-root parsing | Drive/UNC decomposition loses root separator | Platform-aware root preservation; drive/UNC tests pass |
| Interactive setup fixture race | Delayed startup sends blank answers and EOF before prompt | Prompt-driven PTY and final input closure; 30 tests and 36 existing-install combinations pass |
| Overconfident keyword Auto | Realistic JS review, RAG research and npm release queries select unrelated top scores | Generic scores only shortlist; exact complete names select; agent proposals pass separate admission |
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
