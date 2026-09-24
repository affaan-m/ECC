# ECC 2.0 Selective Install Discovery

## Purpose

This document turns the March 11 mega-plan selective-install requirement into a
concrete ECC 2.0 discovery design.

The goal is not just "fewer files copied during install." The actual target is
an install system that can answer, deterministically:

- what was requested
- what was resolved
- what was copied or generated
- what target-specific transforms were applied
- what ECC owns and may safely remove or repair later

That is the missing contract between ECC 1.x installation and an ECC 2.0
control plane.

## Current Implemented Foundation

The first selective-install substrate already exists in-repo:

- `manifests/install-modules.json`
- `manifests/install-profiles.json`
- `schemas/install-modules.schema.json`
- `schemas/install-profiles.schema.json`
- `schemas/install-state.schema.json`
- `scripts/ci/validate-install-manifests.js`
- `scripts/lib/install-manifests.js`
- `scripts/lib/install/request.js`
- `scripts/lib/install/runtime.js`
- `scripts/lib/install/apply.js`
- `scripts/lib/install-targets/`
- `scripts/lib/install-state.js`
- `scripts/lib/install-executor.js`
- `scripts/lib/install-lifecycle.js`
- `scripts/ecc.js`
- `scripts/install-apply.js`
- `scripts/install-plan.js`
- `scripts/list-installed.js`
- `scripts/doctor.js`

Current capabilities:

- machine-readable module and profile catalogs
- CI validation that manifest entries point at real repo paths
- dependency expansion and target filtering
- adapter-aware operation planning
- canonical request normalization for legacy and manifest install modes
- explicit runtime dispatch from normalized requests into plan creation
- legacy and manifest installs both write durable install-state
- read-only inspection of install plans before any mutation
- unified `ecc` CLI routing install, planning, and lifecycle commands
- lifecycle inspection and mutation via `list-installed`, `doctor`, `repair`,
  and `uninstall`

Current limitation:

- target-specific merge/remove semantics are still scaffold-level for some modules
- legacy `ecc-install` compatibility still points at `install.sh`
- publish surface is still broad in `package.json`

## Current Code Review

The current installer stack is already much healthier than the original
language-first shell installer, but it still concentrates too much
responsibility in a few files.

### Current Runtime Path

The runtime flow today is:

1. `install.sh`
   thin shell wrapper that resolves the real package root
2. `scripts/install-apply.js`
   user-facing installer CLI for legacy and manifest modes
3. `scripts/lib/install/request.js`
   CLI parsing plus canonical request normalization
4. `scripts/lib/install/runtime.js`
   runtime dispatch from normalized requests into install plans
5. `scripts/lib/install-executor.js`
   argument translation, legacy compatibility, operation materialization,
   filesystem mutation, and install-state write
6. `scripts/lib/install-manifests.js`
   module/profile catalog loading plus dependency expansion
7. `scripts/lib/install-targets/`
   target root and destination-path scaffolding
8. `scripts/lib/install-state.js`
   schema-backed install-state read/write
9. `scripts/lib/install-lifecycle.js`
   doctor/repair/uninstall behavior derived from stored operations

That is enough to prove the selective-install substrate, but not enough to make
the installer architecture feel settled.

### Current Strengths

- install intent is now explicit through `--profile` and `--modules`
- request parsing and request normalization are now split from the CLI shell
- target root resolution is already adapterized
- lifecycle commands now use durable install-state instead of guessing
- the repo already has a unified Node entrypoint through `ecc` and
  `install-apply.js`

### Current Coupling Still Present

1. `install-executor.js` is smaller than before, but still carrying too many
   planning and materialization layers at once.
   The request boundary is now extracted, but legacy request translation,
   manifest-plan expansion, and operation materialization still live together.
2. target adapters are still too thin.
   Today they mostly resolve roots and scaffold destination paths. The real
   install semantics still live in executor branches and path heuristics.
3. the planner/executor boundary is not clean enough yet.
   `install-manifests.js` resolves modules, but the final install operation set
   is still partly constructed in executor-specific logic.
4. lifecycle behavior depends on low-level recorded operations more than on
   stable module semantics.
   That works for plain file copy, but becomes brittle for merge/generate/remove
   behaviors.
5. compatibility mode is mixed directly into the main installer runtime.
   Legacy language installs should behave like a request adapter, not as a
   parallel installer architecture.

## Proposed Modular Architecture Changes

The next architectural step is to separate the installer into explicit layers,
with each layer returning stable data instead of immediately mutating files.

### Target State

The desired install pipeline is:

1. CLI surface
2. request normalization
3. module resolution
4. target planning
5. operation planning
6. execution
7. install-state persistence
8. lifecycle services built on the same operation contract

The main idea is simple:

- manifests describe content
- adapters describe target-specific landing semantics
- planners describe what should happen
- executors apply those plans
- lifecycle commands reuse the same plan/state model instead of reinventing it

### Proposed Runtime Layers

#### 1. CLI Surface

Responsibility:

- parse user intent only
- route to install, plan, doctor, repair, uninstall
- render human or JSON output

Should not own:

- legacy language translation
- target-specific install rules
- operation construction

Suggested files:

```text
scripts/ecc.js
scripts/install-apply.js
scripts/install-plan.js
scripts/doctor.js
scripts/repair.js
scripts/uninstall.js
```

These stay as entrypoints, but become thin wrappers around library modules.

#### 2. Request Normalizer

Responsibility:

- translate raw CLI flags into a canonical install request
- convert legacy language installs into a compatibility request shape
- reject mixed or ambiguous inputs early

Suggested canonical request:

```json
{
  "mode": "manifest",
  "target": "cursor",
  "profile": "developer",
  "modules": [],
  "legacyLanguages": [],
  "dryRun": false
}
```

or, in compatibility mode:

```json
{
  "mode": "legacy-compat",
  "target": "claude",
  "profile": null,
  "modules": [],
  "legacyLanguages": ["typescript", "python"],
  "dryRun": false
}
```

This lets the rest of the pipeline ignore whether the request came from old or
new CLI syntax.

#### 3. Module Resolver

Responsibility:

- load manifest catalogs
- expand dependencies
- reject conflicts
- filter unsupported modules per target
- return a canonical resolution object

This layer should stay pure and read-only.

It should not know:

- destination filesystem paths
- merge semantics
- copy strategies

Current nearest file:

- `scripts/lib/install-manifests.js`

Suggested split:

```text
scripts/lib/install/catalog.js
scripts/lib/install/resolve-request.js
scripts/lib/install/resolve-modules.js
```

#### 4. Target Planner

Responsibility:

- select the install target adapter
- resolve target root
- resolve install-state path
- expand module-to-target mapping rules
- emit target-aware operation intents

This is where target-specific meaning should live.

Examples:

- Claude may preserve native hierarchy under `~/.claude`
- Cursor may sync bundled `.cursor` root children differently from rules
- generated configs may require merge or replace semantics depending on target

Current nearest files:

- `scripts/lib/install-targets/helpers.js`
- `scripts/lib/install-targets/registry.js`

Suggested evolution:

```text
scripts/lib/install/targets/registry.js
scripts/lib/install/targets/claude-home.js
scripts/lib/install/targets/cursor-project.js
scripts/lib/install/targets/antigravity-project.js
```

Each adapter should eventually expose more than `resolveRoot`.
It should own path and strategy mapping for its target family.

#### 5. Operation Planner

Responsibility:

- turn module resolution plus adapter rules into a typed operation graph
- emit first-class operations such as:
  - `copy-file`
  - `copy-tree`
  - `merge-json`
  - `render-template`
  - `remove`
- attach ownership and validation metadata

This is the missing architectural seam in the current installer.

Today, operations are partly scaffold-level and partly executor-specific.
ECC 2.0 should make operation planning a standalone phase so that:

- `plan` becomes a true preview of execution
- `doctor` can validate intended behavior, not just current files
- `repair` can rebuild exact missing work safely
- `uninstall` can reverse only managed operations

#### 6. Execution Engine

Responsibility:

- apply a typed operation graph
- enforce overwrite and ownership rules
- stage writes safely
- collect final applied-operation results

This layer should not decide *what* to do.
It should only decide *how* to apply a provided operation kind safely.

Current nearest file:

- `scripts/lib/install-executor.js`

Recommended refactor:

```text
scripts/lib/install/executor/apply-plan.js
scripts/lib/install/executor/apply-copy.js
scripts/lib/install/executor/apply-merge-json.js
scripts/lib/install/executor/apply-remove.js
```

That turns executor logic from one large branching runtime into a set of small
operation handlers.

#### 7. Install-State Store

Responsibility:

- validate and persist install-state
- record canonical request, resolution, and applied operations
- support lifecycle commands without forcing them to reverse-engineer installs

Current nearest file:

- `scripts/lib/install-state.js`

This layer is already close to the right shape. The main remaining change is to
store richer operation metadata once merge/generate semantics are real.

#### 8. Lifecycle Services

Responsibility:

- `list-installed`: inspect state only
- `doctor`: compare desired/install-state view against current filesystem
- `repair`: regenerate a plan from state and reapply safe operations
- `uninstall`: remove only ECC-owned outputs

Current nearest file:

- `scripts/lib/install-lifecycle.js`

This layer should eventually operate on operation kinds and ownership policies,
not just on raw `copy-file` records.

## Proposed File Layout

The clean modular end state should look roughly like this:

```text
scripts/lib/install/
  catalog.js
  request.js
  resolve-modules.js
  plan-operations.js
  state-store.js
  targets/
    registry.js
    claude-home.js
    cursor-project.js
    antigravity-project.js
    codex-home.js
    opencode-home.js
  executor/
    apply-plan.js
    apply-copy.js
    apply-merge-json.js
    apply-render-template.js
    apply-remove.js
  lifecycle/
    discover.js
    doctor.js
    repair.js
    uninstall.js
```

This is not a packaging split.
It is a code-ownership split inside the current repo so each layer has one job.

## Migration Map From Current Files

The lowest-risk migration path is evolutionary, not a rewrite.

### Keep

- `install.sh` as the public compatibility shim
- `scripts/ecc.js` as the unified CLI
- `scripts/lib/install-state.js` as the starting point for the state store
- current target adapter IDs and state locations

### Extract

- request parsing and compatibility translation out of
  `scripts/lib/install-executor.js`
- target-aware operation planning out of executor branches and into target
  adapters plus planner modules
- lifecycle-specific analysis out of the shared lifecycle monolith into smaller
  services

### Replace Gradually

- broad path-copy heuristics with typed operations
- scaffold-only adapter planning with adapter-owned semantics
- legacy language install branches with legacy request translation into the same
  planner/executor pipeline

## Immediate Architecture Changes To Make Next

If the goal is ECC 2.0 and not just “working enough,” the next modularization
steps should be:

1. split `install-executor.js` into request normalization, operation planning,
   and execution modules
2. move target-specific strategy decisions into adapter-owned planning methods
3. make `repair` and `uninstall` operate on typed operation handlers rather than
   only plain `copy-file` records
4. teach manifests about install strategy and ownership so the planner no
   longer depends on path heuristics
5. narrow the npm publish surface only after the internal module boundaries are
   stable

## Why The Current Model Is Not Enough

Today ECC still behaves like a broad payload copier:

- `install.sh` is language-first and target-branch-heavy
- targets are partly implicit in directory layout
- uninstall, repair, and doctor now exist but are still early lifecycle commands
- the repo cannot prove what a prior install actually wrote
- publish surface is still broad in `package.json`

That creates the problems already called out in the mega plan:

- users pull more content than their harness or workflow needs
- support and upgrades are harder because installs are not recorded
- target behavior drifts because install logic is duplicated in shell branches
- future targets like Codex or OpenCode require more special-case logic instead
  of reusing a stable install contract

## ECC 2.0 Design Thesis

Selective install should be modeled as:

1. resolve requested intent into a canonical module graph
2. translate that graph through a target adapter
3. execute a deterministic install operation set
4. write install-state as the durable source of truth

That means ECC 2.0 needs two contracts, not one:

- a content contract
  what modules exist and how they depend on each other
- a target contract
  how those modules land inside Claude, Cursor, Antigravity, Codex, or OpenCode

The current repo only had the first half in early form.
The current repo now has the first full vertical slice, but not the full
target-specific semantics.

## Design Constraints

1. Keep `everything-claude-code` as the canonical source repo.
2. Preserve existing `install.sh` flows during migration.
3. Support home-scoped and project-scoped targets from the same planner.
4. Make uninstall/repair/doctor possible without guessing.
5. Avoid per-target copy logic leaking back into module definitions.
6. Keep future Codex and OpenCode support additive, not a rewrite.

## Canonical Artifacts

### 1. Module Catalog

The module catalog is the canonical content graph.

Current fields already implemented:

- `id`
- `kind`
- `description`
- `paths`
- `targets`
- `dependencies`
- `defaultInstall`
- `cost`
- `stability`

Fields still needed for ECC 2.0:

- `installStrategy`
  for example `copy`, `flatten-rules`, `generate`, `merge-config`
- `ownership`
  whether ECC fully owns the target path or only generated files under it
- `pathMode`
  for example `preserve`, `flatten`, `target-template`
- `conflicts`
  modules or path families that cannot coexist on one target
- `publish`
  whether the module is packaged by default, optional, or generated post-install

Suggested future shape:

```json
{
  "id": "hooks-runtime",
  "kind": "hooks",
  "paths": ["hooks", "scripts/hooks"],
  "targets": ["claude", "cursor", "opencode"],
  "dependencies": [],
  "installStrategy": "copy",
  "pathMode": "preserve",
  "ownership": "managed",
  "defaultInstall": true,
  "cost": "medium",
  "stability": "stable"
}
```

### 2. Profile Catalog

Profiles stay thin.

They should express user intent, not duplicate target logic.

Current examples already implemented:

- `core`
- `developer`
- `security`
- `research`
- `full`

Fields still needed:

- `defaultTargets`
- `recommendedFor`
- `excludes`
- `requiresConfirmation`

That lets ECC 2.0 say things like:

- `developer` is the recommended default for Claude and Cursor
- `research` may be heavy for narrow local installs
- `full` is allowed but not default

### 3. Target Adapters

This is the main missing layer.

The module graph should not know:

- where Claude home lives
- how Cursor flattens or remaps content
- which config files need merge semantics instead of blind copy

That belongs to a target adapter.

Suggested interface:

```ts
type InstallTargetAdapter = {
  id: string;
  kind: "home" | "project";
  supports(target: string): boolean;
  resolveRoot(input?: string): Promise<string>;
  planOperations(input: InstallOperationInput): Promise<InstallOperation[]>;
  validate?(input: InstallOperationInput): Promise<ValidationIssue[]>;
};
```

Suggested first adapters:

1. `claude-home`
   writes into `~/.claude/...`
2. `cursor-project`
   writes into `./.cursor/...`
3. `antigravity-project`
   writes into `./.agent/...`
4. `codex-home`
   later
5. `opencode-home`
   later

This matches the same pattern already proposed in the session-adapter discovery
doc: canonical contract first, harness-specific adapter second.

## Install Planning Model

The current `scripts/install-plan.js` CLI proves the repo can resolve requested
modules into a filtered module set.

ECC 2.0 needs the next layer: operation planning.

Suggested phases:

1. input normalization
   - parse `--target`
   - parse `--profile`
   - parse `--modules`
   - optionally translate legacy language args
2. module resolution
   - expand dependencies
   - reject conflicts
   - filter by supported targets
3. adapter planning
   - resolve target root
   - derive exact copy or generation operations
   - identify config merges and target remaps
4. dry-run output
   - show selected modules
   - show skipped modules
   - show exact file operations
5. mutation
   - execute the operation plan
6. state write
   - persist install-state only after successful completion

Suggested operation shape:

```json
{
  "kind": "copy",
  "moduleId": "rules-core",
  "source": "rules/common/coding-style.md",
  "destination": "/Users/example/.claude/rules/ecc/common/coding-style.md",
  "ownership": "managed",
  "overwritePolicy": "replace"
}
```

Other operation kinds:

- `copy`
- `copy-tree`
- `flatten-copy`
- `render-template`
- `merge-json`
- `merge-jsonc`
- `mkdir`
- `remove`

## Install-State Contract

Install-state is the durable contract that ECC 1.x is missing.

Suggested path conventions:

- Claude target:
  `~/.claude/ecc/install-state.json`
- Cursor target:
  `./.cursor/ecc-install-state.json`
- Antigravity target:
  `./.agent/ecc-install-state.json`
- future Codex target:
  `~/.codex/ecc-install-state.json`

Suggested payload:

```json
{
  "schemaVersion": "ecc.install.v1",
  "installedAt": "2026-03-13T00:00:00Z",
  "lastValidatedAt": "2026-03-13T00:00:00Z",
  "target": {
    "id": "claude-home",
    "root": "/Users/example/.claude"
  },
  "request": {
    "profile": "developer",
    "modules": ["orchestration"],
    "legacyLanguages": ["typescript", "python"]
  },
  "resolution": {
    "selectedModules": [
      "rules-core",
      "agents-core",
      "commands-core",
      "hooks-runtime",
      "platform-configs",
      "workflow-quality",
      "framework-language",
      "database",
      "orchestration"
    ],
    "skippedModules": []
  },
  "source": {
    "repoVersion": "2.0.0",
    "repoCommit": "git-sha",
    "manifestVersion": 1
  },
  "operations": [
    {
      "kind": "copy",
      "moduleId": "rules-core",
      "destination": "/Users/example/.claude/rules/ecc/common/coding-style.md",
      "digest": "sha256:..."
    }
  ]
}
```

State requirements:

- enough detail for uninstall to remove only ECC-managed outputs
- enough detail for repair to compare desired versus actual installed files
- enough detail for doctor to explain drift instead of guessing

## Lifecycle Commands

The following commands are the lifecycle surface for install-state:

1. `ecc list-installed`
2. `ecc uninstall`
3. `ecc doctor`
4. `ecc repair`

Current implementation status:

- `ecc list-installed` routes to `node scripts/list-installed.js`
- `ecc uninstall` routes to `node scripts/uninstall.js`
- `ecc doctor` routes to `node scripts/doctor.js`
- `ecc repair` routes to `node scripts/repair.js`
- legacy script entrypoints remain available during migration

### `list-installed`

Responsibilities:

- show target id and root
- show requested profile/modules
- show resolved modules
- show source version and install time

### `uninstall`

Responsibilities:

- load install-state
- remove only ECC-managed destinations recorded in state
- leave user-authored unrelated files untouched
- delete install-state only after successful cleanup

### `doctor`

Responsibilities:

- detect missing managed files
- detect unexpected config drift
- detect target roots that no longer exist
- detect manifest/version mismatch

### `repair`

Responsibilities:

- rebuild the desired operation plan from install-state
- re-copy missing or drifted managed files
- refuse repair if requested modules no longer exist in the current manifest
  unless a compatibility map exists

## Legacy Compatibility Layer

Current `install.sh` accepts:

- `--target <claude|cursor|antigravity>`
- a list of language names

That behavior cannot disappear in one cut because users already depend on it.

ECC 2.0 should translate legacy language arguments into a compatibility request.

Suggested approach:

1. keep existing CLI shape for legacy mode
2. map language names to module requests such as:
   - `rules-core`
   - target-compatible rule subsets
3. write install-state even for legacy installs
4. label the request as `legacyMode: true`

Example:

```json
{
  "request": {
    "legacyMode": true,
    "legacyLanguages": ["typescript", "python"]
  }
}
```

This keeps old behavior available while moving all installs onto the same state
contract.

## Publish Boundary

The current npm package still publishes a broad payload through `package.json`.

ECC 2.0 should improve this carefully.

Recommended sequence:

1. keep one canonical npm package first
2. use manifests to drive install-time selection before changing publish shape
3. only later consider reducing packaged surface where safe

Why:

- selective install can ship before aggressive package surgery
- uninstall and repair depend on install-state more than publish changes
- Codex/OpenCode support is easier if the package source remains unified

Possible later directions:

- generated slim bundles per profile
- generated target-specific tarballs
- optional remote fetch of heavy modules

Those are Phase 3 or later, not prerequisites for profile-aware installs.

## File Layout Recommendation

Suggested next files:

```text
scripts/lib/install-targets/
  claude-home.js
  cursor-project.js
  antigravity-project.js
  registry.js
scripts/lib/install-state.js
scripts/ecc.js
scripts/install-apply.js
scripts/list-installed.js
scripts/uninstall.js
scripts/doctor.js
scripts/repair.js
tests/lib/install-targets.test.js
tests/lib/install-state.test.js
tests/lib/install-lifecycle.test.js
```

`install.sh` can remain the user-facing entry point during migration, but it
should become a thin shell around a Node-based planner and executor rather than
keep growing per-target shell branches.

## Implementation Sequence

### Phase 1: Planner To Contract

1. keep current manifest schema and resolver
2. add operation planning on top of resolved modules
3. define `ecc.install.v1` state schema
4. write install-state on successful install

### Phase 2: Target Adapters

1. extract Claude install behavior into `claude-home` adapter
2. extract Cursor install behavior into `cursor-project` adapter
3. extract Antigravity install behavior into `antigravity-project` adapter
4. reduce `install.sh` to argument parsing plus adapter invocation

### Phase 3: Lifecycle

1. add stronger target-specific merge/remove semantics
2. extend repair/uninstall coverage for non-copy operations
3. reduce package shipping surface to the module graph instead of broad folders
4. decide when `ecc-install` should become a thin alias for `ecc install`

### Phase 4: Publish And Future Targets

1. evaluate safe reduction of `package.json` publish surface
2. add `codex-home`
3. add `opencode-home`
4. consider generated profile bundles if packaging pressure remains high

## Immediate Repo-Local Next Steps

The highest-signal next implementation moves in this repo are:

1. add target-specific merge/remove semantics for config-like modules
2. extend repair and uninstall beyond simple copy-file operations
3. reduce package shipping surface to the module graph instead of broad folders
4. decide whether `ecc-install` remains separate or becomes `ecc install`
5. add tests that lock down:
   - target-specific merge/remove behavior
   - repair and uninstall safety for non-copy operations
   - unified `ecc` CLI routing and compatibility guarantees

## Open Questions

1. Should rules stay language-addressable in legacy mode forever, or only during
   the migration window?
2. Should `platform-configs` always install with `core`, or be split into
   smaller target-specific modules?
3. Do we want config merge semantics recorded at the operation level or only in
   adapter logic?
4. Should heavy skill families eventually move to fetch-on-demand rather than
   package-time inclusion?
5. Should Codex and OpenCode target adapters ship only after the Claude/Cursor
   lifecycle commands are stable?

## Recommendation

Treat the current manifest resolver as adapter `0` for installs:

1. preserve the current install surface
2. move real copy behavior behind target adapters
3. write install-state for every successful install
4. make uninstall, doctor, and repair depend only on install-state
5. only then shrink packaging or add more targets

That is the shortest path from ECC 1.x installer sprawl to an ECC 2.0
install/control contract that is deterministic, supportable, and extensible.
