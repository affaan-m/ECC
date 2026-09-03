# Hermes / OpenClaw -> ECC Migration

This document is the public migration guide for moving a Hermes or OpenClaw-style operator setup into the current ECC model.

The goal is not to reproduce a private operator workspace byte-for-byte.

The goal is to preserve the useful workflow surface:

- reusable skills
- stable automation entrypoints
- cross-harness portability
- schedulers / reminders / dispatch
- durable context and operator memory

while removing the parts that should stay private:

- secrets
- personal datasets
- account tokens
- local-only business artifacts

## Migration Thesis

Treat Hermes and OpenClaw as source systems, not as the final runtime.

ECC is the durable public system:

- skills
- agents
- commands
- hooks
- install surfaces
- session adapters
- ECC 2.0 control-plane work

Hermes and OpenClaw are useful inputs because they contain repeated operator workflows that can be distilled into ECC-native surfaces.

That means the shortest safe path is:

1. extract the reusable behavior
2. translate it into ECC-native skills, hooks, docs, or adapter work
3. keep secrets and personal data outside the repo

## Current Workspace Model

Use the current workspace split consistently:

- live code work happens in cloned repos under `~/GitHub`
- repo-specific direction lives in `docs/ROADMAP.md`, shipped change history in `CHANGELOG.md`
- broader non-code context can live in KB/archive layers
- durable cross-machine truth should prefer GitHub, Linear, and the knowledge base

Do not rebuild a shadow private workspace inside the public repo.

## Translation Map

### 1. Scheduler / cron layer

Source examples:

- `cron/scheduler.py`
- `jobs.py`
- recurring readiness or accountability loops

Translate into:

- Claude-native scheduling where available
- ECC hook / command automation for local repeatability
- ECC 2.0 scheduler work under issue `#1050`

Today, the repo already has the right public framing:

- hooks for low-latency repo-local automation
- commands for explicit operator actions
- ECC 2.0 as the future long-lived scheduling/control plane

### 2. Gateway / dispatch layer

Source examples:

- Hermes gateway
- mobile dispatch / remote nudges
- operator routing between active sessions

Translate into:

- ECC session adapter and control-plane work
- orchestration/session inspection commands
- ECC 2.0 control-plane backlog under:
  - `#1045`
  - `#1046`
  - `#1047`
  - `#1048`

The public repo should describe the adapter boundary and control-plane model, not pretend the remote operator shell is already fully GA.

### 3. Memory layer

Source examples:

- `memory_tool.py`
- local operator memory
- business / ops context stores

Translate into:

- `knowledge-ops`
- repo `docs/ROADMAP.md` and `CHANGELOG.md`
- GitHub / Linear / KB-backed durable context
- future deep memory work under `#1049`

The important distinction is:

- repo execution context belongs near the repo
- broader non-code memory belongs in KB/archive systems
- the public repo should document the boundary, not store private memory dumps

### 4. Skill layer

Source examples:

- Hermes skills
- OpenClaw skills
- generated operator playbooks

Translate into:

- ECC-native top-level skills when the workflow is reusable
- docs/examples when the content is only a template
- hooks or commands when the behavior is procedural rather than knowledge-shaped

Recent examples already salvaged this way:

- `knowledge-ops`
- `github-ops`
- `hookify-rules`
- `automation-audit-ops`
- `email-ops`
- `finance-billing-ops`
- `messages-ops`
- `research-ops`
- `terminal-ops`
- `ecc-tools-cost-audit`

### 5. Tool / service layer

Source examples:

- custom service wrappers
- API-key-backed local tools
- browser automation glue

Translate into:

- MCP-backed surfaces when a connector exists
- ECC-native operator skills when the workflow logic is the real asset
- adapter/control-plane work when the missing piece is session/runtime coordination

Do not import opaque third-party runtimes into ECC just because a private workflow depended on them.

If a workflow is valuable:

1. understand the behavior
2. rebuild the minimum ECC-native version
3. document the auth/connectors required locally

## What Already Exists Publicly

The current repo already covers meaningful parts of the migration:

- ECC 2.0 adapter/control-plane discovery docs
- orchestration/session inspection substrate
- operator workflow skills
- cost / billing / workflow audit skills
- cross-harness install surfaces
- AgentShield for config and agent-surface scanning

This means the migration problem is no longer "start from zero."

It is mostly:

- distilling missing private workflows
- clarifying public docs
- continuing the ECC 2.0 operator/control-plane buildout

ECC 2.0 now ships a bounded migration audit entrypoint:

- `ecc migrate audit --source ~/.hermes`
- `ecc migrate plan --source ~/.hermes --output migration-plan.md`
- `ecc migrate scaffold --source ~/.hermes --output-dir migration-artifacts`
- `ecc migrate import-skills --source ~/.hermes --output-dir migration-artifacts/skills`
- `ecc migrate import-tools --source ~/.hermes --output-dir migration-artifacts/tools`
- `ecc migrate import-plugins --source ~/.hermes --output-dir migration-artifacts/plugins`
- `ecc migrate import-schedules --source ~/.hermes --dry-run`
- `ecc migrate import-remote --source ~/.hermes --dry-run`
- `ecc migrate import-env --source ~/.hermes --dry-run`
- `ecc migrate import-memory --source ~/.hermes`

Use that first to inventory the legacy workspace and map detected surfaces onto the current ECC2 scheduler, remote dispatch, memory graph, templates, and manual-translation lanes.

## What Still Belongs In Backlog

The remaining large migration themes are already tracked:

- `#1051` Hermes/OpenClaw migration
- `#1049` deep memory layer
- `#1050` autonomous scheduling
- `#1048` universal harness compatibility layer
- `#1046` agent orchestrator
- `#1045` multi-session TUI manager
- `#1047` visual worktree manager

That is the right place for the unresolved control-plane work.

Do not pretend the migration is "done" just because the public docs exist.

## Recommended Bring-Up Order

1. Keep the public ECC repo as the canonical reusable layer.
2. Port reusable Hermes/OpenClaw workflows into ECC-native skills one lane at a time.
3. Keep private auth and personal context outside the repo.
4. Use GitHub / Linear / KB systems as durable truth.
5. Treat ECC 2.0 as the path to a native operator shell, not as a finished product.

## Decision Rule

When reviewing a Hermes or OpenClaw artifact, ask:

1. Is this reusable across operators or only personal?
2. Is the asset mainly knowledge, procedure, or runtime behavior?
3. Should it become:
   - a skill
   - a command
   - a hook
   - a doc/example
   - a control-plane issue
4. Does shipping it publicly leak secrets, private datasets, or personal operating state?

Only ship the reusable surface.
