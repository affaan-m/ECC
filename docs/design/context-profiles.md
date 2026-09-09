# Context profiles: read-only foundation

Status: accepted first development slice, P0/P1, September 8, 2026. This document describes the source implementation and its contributor contract. It does not announce a released runtime capability or a change to installation defaults.

ECC context profiles separate the skill-discovery proposal from installation, runtime authority, and measurement. The first slice inventories canonical skills, validates versioned declarations, and produces deterministic read-only plans. It does not yet scope the complete host system prompt.

## Keep the controls separate

| Control | Meaning | Compatibility rule |
| --- | --- | --- |
| Existing install `--profile` | Selects install modules using [install profiles](../../manifests/install-profiles.json) | `minimal`, `opencode`, `core`, `developer`, `security`, `research`, and `full` keep their existing meanings |
| Context profile `lean@1` or `full@1` | Proposes which canonical skill metadata is selected for discovery | No automatic mapping from an install profile; `full@1` is a skill projection, not the complete ECC installation |
| Selection `manual`, `suggest`, or `auto` | Records selection intent in a proposed context plan | No task classifier, agent-directed switching, or automatic application exists in this slice |
| Existing hook profile | Controls existing hook policy through [hook flags](../../scripts/lib/hook-flags.js) | `minimal`, `standard`, and `strict` remain separate; preview never changes hook consent |
| Runtime and capabilities | Execution isolation, tool permissions, secrets, and side effects | A context selection grants no authority and chooses no sandbox |

There is no new `use`, `apply`, or `mode` mutation command. The existing install interface is preserved rather than repurposed.

## Inspect the proposal

From a source checkout, use the existing [ECC dispatcher](../../scripts/ecc.js):

```sh
node scripts/ecc.js profile show --json
node scripts/ecc.js profile show lean@1 --json
node scripts/ecc.js profile preview lean@1 --target codex --selection auto --json
node scripts/ecc.js profile preview full@1 --target claude --selection manual --json
node scripts/ecc.js profile preview lean@1 --target codex --include skill:security-review --exclude skill:python-patterns --json
node scripts/ecc.js profile explain skill:security-review --target codex --json
```

The packaged CLI uses the same `ecc profile ...` arguments. `show` reads profile definitions; `preview` compiles a proposal; `explain` looks up one exact canonical skill ID and reports its source, resources, ownership, and target declarations. These commands neither invoke skills nor write installed settings. The CLI reads its own package sources, independently of the caller's working directory.

CLI preview defaults are `lean@1`, target `codex`, and selection intent `auto`. These are preview defaults, not detected user preferences. The library compiler defaults selection intent to `manual`; consumers should pass the intended value explicitly. Both `lean` and `full` are accepted aliases for the versioned profile IDs.

JSON responses use `ecc.profile-inspection.v1`, including `status`, `summary`, `activation`, `next_actions`, and `artifacts`. A successful preview deliberately reports `status: "warning"` with exit code 0 because runtime activation remains `unobserved`. Invalid requests return an error and exit code 1. A plan reports `active: false` and `disposition: "proposed"`; these fields must survive downstream presentation.

## Public sources and APIs

The source manifests have numeric `schemaVersion: 1`. Generated registry and plan objects identify their output shapes as `ecc.context-registry.v1` and `ecc.context-plan.v1` respectively.

| Source | Responsibility |
| --- | --- |
| [Profile schema](../../schemas/context-profile.schema.json) | Versioned profile ID, registry binding, eager and required selection, and metadata budget |
| [Registry declaration schema](../../schemas/context-pack-registry.schema.json) | Canonical inventory source and explicit per-skill dependency/resource overrides |
| [Lean manifest](../../manifests/context-profiles/lean@1.json) and [Full manifest](../../manifests/context-profiles/full@1.json) | Reviewable selection and budget policy |
| [Skill registry declaration](../../manifests/context-packs/skill-registry@1.json) | Binds the inventory to existing install-module ownership and the canonical skills directory |
| [Registry library](../../scripts/lib/context-pack-registry.js) | Inventory, metadata validation, source hashing, dependency validation, and exact explanation |
| [Profile library](../../scripts/lib/context-profiles.js) | Profile loading, deterministic selection, target projection, and metadata estimation |
| [Shared support](../../scripts/lib/context-profile-support.js) | Bounded source reads, portable paths, schema validation, canonical serialization, and compiler digest |
| [Profile CLI](../../scripts/profile.js) | Read-only inspection envelope and argument validation |

Contributor entry points are:

```js
loadContextRegistry({ repoRoot });
explainContextEntry({ repoRoot, id: 'skill:security-review', target: 'codex' });
loadContextProfile('lean@1', { repoRoot });
compileContextProfile({
  repoRoot,
  profileId: 'lean@1',
  target: 'codex',
  selectionMode: 'auto',
  include: ['skill:security-review'],
  exclude: ['skill:python-patterns'],
});
```

The first two functions are exported by the registry library; the profile library exports the last two and re-exports `explainContextEntry`. The registry also exports `projectionFor(entry, target)` for already validated entries and targets. Consumers should use the loading and compilation APIs instead of duplicating source parsing or building another profile authority.

## Inventory and selection semantics

Each canonical `skills/<directory>/SKILL.md` becomes `skill:<directory>`. Its skill directory must have exactly one owner in [install modules](../../manifests/install-modules.json). The owning module supplies `ownerModuleId`, the initial `packId`, and `declaredInstallTargets`. This reuses existing ownership without treating installer module dependencies as skill workflow dependencies.

Lean currently selects three required candidate entries: `skill:configure-ecc`, `skill:context-budget`, and `skill:ecc-guide`. Other canonical skills remain labeled `routed` unless explicitly included or excluded. Here, `routed` means available in the catalog for future discovery integration; it does not mean a router has run or a native host can already retrieve the skill.

Full derives `all` from the current canonical inventory. The September 8 baseline contains 286 skills, but 286 is a snapshot, not a hardcoded profile limit. Explicit exclusions can narrow a Full proposal, except for required entries and dependencies needed by retained selections.

Includes add exact IDs and their transitively declared dependencies. Exclusions cannot remove required profile entries or break that declared closure. Unknown IDs, duplicate selectors, overlapping include/exclude requests, unknown targets, and invalid selection modes fail. Profiles must include their declared required entries in the eager selection.

Dependencies come only from `overrides[].dependencies` in the registry declaration. The current manifest has no overrides, and entries report `dependencyCoverage: "declared-only-unreviewed"`. An empty dependency array means no declaration exists; it does not prove that a workflow is self-contained. References in skill prose are not followed, interpreted, or promoted into dependency edges.

`overrides[].requiredResources` can assert that files exist within that skill's own directory. Unknown override IDs, duplicate ownership, missing resources, unknown dependencies, cycles, malformed metadata, unsafe paths, and symbolic links within the source tree are rejected. Reads are bounded at 4 MiB per file, 16 MiB per source reader, 10,000 files, and 32 levels of recursive directory depth. Directory enumeration is incremental, with at most 10,000 accepted names per directory and 20,000 traversal operations per reader. Every directory open and enumerated entry consumes that shared budget, including empty directories and excluded names; detecting overflow may inspect one extra entry. Generated Python caches, `.git`, and `node_modules` are excluded; an explicitly required excluded resource is rejected.

Resolved entries currently list every included resource without a separate required-resource annotation. Before P2 performs selective resource projection, preserve those declarations explicitly in its output contract and add omission tests. Until then, a carrier must not infer that arbitrary subsets are sufficient.

Source reads revalidate ancestor and file identities before consuming bytes and after reading. These consistency checks reject the tested concurrent symlink substitution; they do not provide an atomic repository snapshot. Use immutable source artifacts for downstream execution. Skill and profile metadata reject terminal controls; CLI text also renders controls inert in error paths.

## Provenance without eager instruction loading

The registry reads and hashes skill bodies and bundled resource bytes to bind source identity. It does not evaluate scripts, follow instructions in prose, or emit those bodies as model context. Discovery metadata and resource descriptors are separate from instruction loading. Future native carriers must preserve on-demand loading of selected skill bodies and required resources; this first slice implements no native loader.

| Digest | What it binds |
| --- | --- |
| Resource `digest` | Exact bytes of one source file |
| Entry `contentDigest` | Ordered resource descriptors, including paths, byte counts, and resource digests |
| `registryDigest` | Portable registry output, including inventory-source digests, ownership, metadata, and resource descriptors |
| `profileDigest` | Normalized profile manifest, with selection arrays sorted |
| `compilerDigest` | Source digests for the three compiler library files, two declaration schemas, and the existing install-manifest module supplying target IDs |
| `planDigest` | Complete portable proposed-plan object before adding `planDigest` itself |

These are SHA-256 content bindings, not signatures, runtime attestations, or a complete execution-environment identity. Digests deliberately exclude caller-specific absolute paths and timestamps. Equivalent selector ordering produces identical plans; changing a skill body changes provenance even when its discovery-metadata estimate stays constant.

## The 8K check is a metadata fixture gate

`estimate.surface` is `skill-discovery-metadata`. Method `utf8-bytes-div-4@1` renders each selected entry as canonical JSON containing `harness`, `type`, `name`, and `description`, adds a newline, divides UTF-8 bytes by four, rounds each entry up, and sums the results. The ledger exposes per-entry costs.

Lean rejects estimates above 8,000 using `CONTEXT_PROFILE_BUDGET_EXCEEDED`; a library caller can inspect the rejected proposal on `error.plan`. Exactly 8,000 passes the estimator check; 8,001 fails. Full uses the same reference budget in report-only mode.

This heuristic is an early rejection and regression fixture, not a tokenizer, measured lower bound, or whole-prompt certification. Passing cannot establish the production Lean startup ceiling. `nativeTokens`, `wrapperTokens`, and `wholeScopeTokens` remain `null` until appropriate observation exists.

The registry explicitly excludes agents, commands, rules, hooks, MCP schemas, harness wrappers, and learned skills. Skill bodies and bundled resources are hashed but excluded from the discovery estimate. Other plugin context, host overhead, repeated prompts, and task execution costs are also unmeasured. Report observed native counters separately and avoid deriving savings claims from this ledger alone.

## Target declarations are not runtime certification

The registry recognizes the current 15 install target IDs plus Pi. For a requested target, `projection.installSupport` reports `declared` or `not-declared` according to the owning module. `projection.nativeSupport` remains `unobserved` in both cases.

Target selection does not silently drop skills lacking an installer declaration. The same explicit skill selection is projected for every recognized target, so consumers can inspect gaps rather than mistake them for successful installation. Native discovery, invocation, resource access, reload behavior, exclusion enforcement, and whole-context cost require adapter-specific evidence in later slices.

## Rationale and alternatives

The read-only boundary makes the selection contract reviewable before it can alter user state. Versioned manifests and source digests provide shared inputs for adapters, grouping work, routing, and measurement. Keeping existing install ownership avoids a second independently maintained inventory.

Alternatives considered:

- Reuse install profile names for runtime scope. Rejected because installed files, visible context, hooks, and permissions are separate controls with existing compatibility obligations.
- Start by rewriting plugin caches or installed discovery files. Deferred until carrier ownership, fresh-session behavior, receipts, rollback, and user-edit preservation have evidence.
- Treat a task classifier or system prompt as the enforcement boundary. Rejected. Future agent proposals must be validated against deterministic contracts and retained consent.
- Infer complete workflow closure from Markdown prose. Rejected as an unreviewed authority source. Explicit declarations are auditable; the current dependency coverage remains incomplete.
- Declare 8K compliance from a character or byte estimate. Rejected. Metadata fixtures help catch regressions while native host measurements remain a separate gate.

## Contributor integration lanes

These related PRs are integration inputs, not claims that their proposed behavior has shipped. Preserve contributor attribution and verify each change against the shared contract before adoption.

| Contribution | Intended integration | Boundary |
| --- | --- | --- |
| [#2788](https://github.com/affaan-m/ECC/pull/2788) | Native discovery carriers and associated ownership/receipt work | Consume this registry and plan; carrier generation and activation belong to later slices |
| [#2844](https://github.com/affaan-m/ECC/pull/2844) | Catalog grouping, deterministic selection fixtures, and listing projection | Reuse canonical IDs and pack ownership instead of introducing competing profile authority |
| [#2945](https://github.com/affaan-m/ECC/pull/2945) | Task routing and automatic-selection proposals | Future structured task resolver; `selectionMode: "auto"` alone implements none of this |
| [#2740](https://github.com/affaan-m/ECC/pull/2740) | Native context counters and bounded diagnostics | Keep observed measurements separate from fixture estimates and scan assumptions |
| [#3030](https://github.com/affaan-m/ECC/pull/3030) | Contributor skill-quality validation | Content-quality checks complement inventory validation; they do not prove runtime activation or workflow outcomes |
| [#3032](https://github.com/affaan-m/ECC/pull/3032) | Existing js-yaml dependency security update | Verify contributor integration before release; retain both lockfiles and rerun dependency and regression checks |

The original September 8 dependency baseline pinned js-yaml 4.3.1, affected by [GHSA-2883-xcg3-v3hh](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh). PR preparation exposed that existing finding in hosted CI. This branch now includes Myles Agnew's exact 4.3.2 upgrade from #3032 as an attributed prerequisite commit, updating the runtime pin, overrides, resolutions, and both lockfiles. Runtime audit reports zero vulnerabilities after installation. The original contributor PR remains independently reviewable. This registry's `JSON_SCHEMA` excludes the advisory's merge behavior, but upgrading also protects existing default-schema parsers.

## Follow-on gates and verification

P2 adds provider carriers and conformance evidence. P3 adds transactional activation, receipts, ownership, migration, recovery, and rollback. P4 adds structured task selection, agent proposals, and bounded automatic routing. P5 integrates hook plans with explicit, separately retained consent. P6 earns release-default changes through package, operating-system, harness, compatibility, and recovery tests. None of those stages is implied by a successful preview.

The first-slice checks live in [registry tests](../../tests/lib/context-pack-registry.test.js), [profile tests](../../tests/lib/context-profiles.test.js), [CLI tests](../../tests/scripts/profile.test.js), and the [context-profile validator](../../scripts/ci/validate-context-profiles.js). They cover source and selection validation, deterministic provenance, metadata boundaries, and read-only behavior. Those fixtures do not replace native fresh-session, activation, workflow, or whole-system measurement evidence.

In a source checkout, see the [TDD evidence record](context-profiles.tdd.md) and test files linked above for executed checks, checkpoints, coverage, and known gaps. Test sources and the evidence record are intentionally outside the reduced npm runtime surface.
