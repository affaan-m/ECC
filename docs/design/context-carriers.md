# Skill-only context carriers

Status: P2a/P2b/P2c implemented and focused checks passed, following the read-only foundation in [PR #3037](https://github.com/affaan-m/ECC/pull/3037). This is a source implementation contract, not an installation, activation, or native discovery certificate.

M1 context profiles determine proposed discovery. Carrier layouts map that proposal into a portable file inventory. Sandbox authority, hooks, tool permissions, task routing, and user settings remain separate. See the [profile contract](context-profiles.md) for Lean/Full and selection semantics.

## Three bounded slices

| Slice | Contract | Boundary |
| --- | --- | --- |
| P2a resource declarations | Registry and plan entries preserve sorted explicit `requiredResources` | `sourcePath` is the mandatory entrypoint; empty declarations do not prove resource or workflow closure |
| P2b carrier planning | `planContextCarrier(options)` emits `ecc.context-carrier.v1` | Pure read-only file projection; no output destination, installed-state probe, or native activation |
| P2c acceptance fixtures | An independently checked disposable tree demonstrates structural materialization | Test-only writer owns its temporary parent; observed file equality does not prove native discovery or invocation |

The generated registry/plan v1 shapes gain an additive `requiredResources` field. Existing profile IDs and declaration schemas retain their meanings. Inspection consumers should tolerate additional output fields. A new carrier consumer must reject an older object missing declaration metadata instead of interpreting it as an empty declaration.

`sourcePath` remains required even when absent from the explicit declaration list. An explicit declaration of `SKILL.md` remains visible. The effective required set is their union, while `resources` inventories all included bundled files. Resource-content digests retain their exact byte semantics; registry and plan provenance also bind declaration changes.

## User-facing preview

```sh
node scripts/ecc.js profile carrier lean@1 --target codex --json
node scripts/ecc.js profile carrier lean@1 --target claude --include skill:security-review --json
node scripts/ecc.js profile carrier full@1 --target pi --exclude skill:python-patterns --selection manual --json
```

The packaged command uses `ecc profile carrier` with the same arguments. Defaults match profile preview: Lean, Codex, and Auto selection intent. Auto remains recorded intent only. The JSON inspection envelope reports a warning and unobserved activation; its `carrier` object lists exact proposed files and source bindings. No files are written. Destination and hook flags are rejected.

The [carrier library](../../scripts/lib/context-carriers.js) accepts the same source/profile/target/selection options as compilation. It compiles from canonical sources, verifies the loaded registry matches the compiled plan, and rejects externally supplied replacement plans or unknown options. Its output is checked against the [carrier schema](../../schemas/context-carrier.schema.json).

The schema validates output shape and rejects unknown fields. Semantic relationships such as exact target/layout agreement and resource completeness are enforced by the generator and independent fixture verifier. Schema validation alone cannot certify a supplied artifact.

## Layouts preserve the exact selection

| Target | Skill root within a future isolated carrier | Generated discovery manifest |
| --- | --- | --- |
| Claude | `skills/` | `.claude-plugin/plugin.json` |
| Codex | `skills/` | `.codex-plugin/plugin.json` |
| Pi | `skills/` | `package.json` with the narrow Pi skills declaration |
| OpenCode | `.opencode/skills/` | None; use the native project skills convention |
| Cursor | `.cursor/skills/` | None; use the native project skills convention |

These are implemented layout proposals, not five certified runtime integrations. Other recognized target IDs return `status: unsupported` with an empty file list and retained proposal inventory; unknown target IDs fail. A legacy install-module declaration gap remains visible independently of layout availability.

Every selected skill contributes its complete bundled tree. Canonical IDs remain stable; destination directories use validated native metadata names, which can differ from canonical directory IDs. Full honors explicit exclusions. Routed and excluded skills contribute no carrier files; routed retrieval remains future work rather than an extra undisclosed bootstrap skill. Generated manifests use a narrow field allowlist and never inherit ECC's monolithic hooks, MCP configuration, agents, commands, or broad instruction lists.

Copy operations retain binary byte digests and sizes rather than embedding decoded bodies. Generated manifests bind exact UTF-8 bytes. Required resources must exist in the selected inventory. Duplicate native names, case-colliding paths, unsafe paths, nested case-insensitive skill entrypoints, or source-plan drift fail before a carrier can be returned.

Preserved skill files can contain their own authority-related metadata, including `allowed-tools`. Planning treats those bytes as data and grants no authority. Before native activation, resolve skill-level metadata against retained user consent and trusted policy; omitting hook and MCP manifest fields is insufficient for that gate.

The artifact binds the source registry, profile, compiler, plan, and adapter implementation/schema digests. `carrierDigest` binds the full proposed artifact before adding its own digest. Hashes are content bindings, not signatures or attestations. No runtime execution or executable-mode preservation is certified.

## Acceptance evidence has a narrow meaning

The source-only fixture helper creates its own temporary parent, stages pinned source bytes, and compares an independently expected tree with observed files. It does not accept a user destination. Tests cover resource omission, extra or changed bytes, binary preservation, source drift, symlink substitution, failed-write cleanup, and unrelated sentinel preservation. Generated content must match its independently compiled expectation; a carrier's self-reported digest cannot redefine acceptance.

Structural evidence and native evidence are distinct:

| Claim | Required evidence |
| --- | --- |
| Materialized file set and byte integrity | Fixture comparison against independent expected source and generated content |
| Bundled resource completeness and relocation | All selected resources present; verification still works after source removal |
| Native visible IDs and exclusions | Future fresh-session probe for a named provider version and install path |
| Skill loading and useful workflow execution | Future native invocation and task-outcome checks |
| Activation, reload, rollback, hooks, whole-context cost | Later dedicated lifecycle, consent, and measurement gates |

No structural result may set native discovery, invocation, activation, or token usage to verified. Whole bundled trees also do not prove complete cross-skill or external runtime dependency closure.

## Contributor and provider provenance

The architecture reuses Jeffrey Montoya's [#2788](https://github.com/affaan-m/ECC/pull/2788) ideas of whole-skill copying and one preview/build inventory. Ownership receipts and staging/rollback mechanics remain queued for P3. Its extra catalog bootstrap and copying of all unselected skills are not carried forward because they would change the approved selection or leak exclusions.

LovePlayCode's [#2844](https://github.com/affaan-m/ECC/pull/2844) grouping and deterministic selection ideas inform the shared inventory. Its broad Full directory projection cannot preserve explicit exclusions, so the carrier uses the canonical selected IDs instead. These source contributions remain independently reviewable with attribution; this work does not merge or close their PRs.

Codex and Pi layout fields are grounded in ECC's existing native manifests; provider mirrors are not used as canonical resources. Claude's [documented path rules](https://code.claude.com/docs/en/plugins-reference#path-behavior-rules) require install-path-specific exclusion tests because default discovery can be additive. OpenCode's [skill-name rules](https://opencode.ai/docs/skills/#validate-names) require the native directory name to match metadata. These constraints inform projection fixtures and do not substitute for fresh-session observations.

## Next gate

Earn native discovery and exclusion evidence using isolated homes and exact provider versions. Then implement transactional activation and recovery using the accepted ownership/receipt contract. Task routing, automatic switching, hook consent integration, and release-default changes remain behind their later gates.
