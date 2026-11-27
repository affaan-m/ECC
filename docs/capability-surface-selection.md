# Capability Surface Selection

Use this as the routing guide when deciding whether a capability belongs in a rule, a skill, an MCP server, or a plain CLI/API workflow.

ECC does not treat these surfaces as interchangeable. The goal is to put each capability in the narrowest surface that preserves correctness, keeps token cost under control, and does not create unnecessary runtime or supply-chain drag.

## The Short Version

- `rules/` are for deterministic, always-on constraints that should be injected when a path or event matches.
- `skills/` are for on-demand workflows, richer playbooks, and token-expensive guidance that should load only when relevant.
- `MCP` is for interactive structured capabilities that benefit from a long-lived tool/resource surface across sessions or clients.
- local `CLI` or repo scripts are for simple deterministic actions that do not need a persistent server.
- direct `API` calls inside a skill are for narrow remote actions where a full MCP server would be heavier than the problem.

## Decision Order

Ask these questions in order:

1. Should this happen every time a path or event matches, with no model judgment involved?
   - Use a `rule`.
2. Is this mostly a playbook, workflow, or advisory layer that should load only when the task actually needs it?
   - Use a `skill`.
3. Does the capability need a structured interactive tool/resource interface that multiple harnesses or clients should call repeatedly?
   - Use `MCP`.
4. Is it a simple local action that can run as a script without keeping a server alive?
   - Use a local `CLI` entrypoint or repo script, then wrap it with a skill if needed.
5. Is it just one narrow remote integration step inside a larger workflow?
   - Call the external `API` directly from the skill or script.

## Surface-by-Surface Guidance

### Rules

Use rules for:

- path-scoped coding invariants
- safety floors and permission constraints
- harness/runtime constraints that should always apply
- deterministic reminders that should not depend on model discretion

Do not use rules for:

- large playbooks that would bloat every matching edit
- optional workflows
- expensive domain context that only matters some of the time

### Skills

Use skills for:

- multi-step workflows
- judgment-heavy guidance
- domain playbooks that are expensive enough to load only on demand
- orchestration across scripts, APIs, MCP tools, and adjacent skills

Do not use skills as a dumping ground for static invariants that really want deterministic routing.

### MCP

Use MCP when the capability benefits from:

- structured tool inputs/outputs
- reusable resources or prompts
- repeated cross-client usage
- a stable interface that should work across Claude Code, Codex, Cursor, OpenCode, and related harnesses
- a long-lived server process being worth the operational overhead

Avoid MCP when:

- the job is a one-shot local command
- the only thing the server would do is shell out once
- the server adds more install/runtime burden than product value

### CLI / Repo Scripts

Prefer a local script or CLI when:

- the action is deterministic
- startup is cheap
- the workflow is mostly local
- there is no benefit to exposing a persistent tool/resource surface

This is often the right choice for:

- lint/test/build wrappers
- local transforms
- small installers
- content generation that runs once per invocation

### Direct API Calls

Prefer direct API calls inside an existing skill or script when:

- the integration is narrow
- the remote action is part of a larger workflow
- you do not need a reusable transport surface yet

If the same remote integration becomes central, repeated, and multi-client, that is the signal to graduate it into an MCP surface.

## Cost and Reliability Bias

When two options are both viable:

- prefer the smaller runtime surface
- prefer the lower token overhead
- prefer the path with fewer external moving parts
- prefer ECC-native packaging over introducing another third-party dependency

Do not normalize external plugin or package dependencies as first-class ECC surfaces unless the capability is clearly worth the maintenance, security, and install burden.

## Repo Policy

When bringing in ideas from external repos:

- copy the underlying idea, not the external dependency
- repackage it as an ECC-native rule, skill, script, or MCP surface
- rename it if the functionality has been materially expanded or reshaped for ECC
- avoid shipping instructions that require users to install unrelated third-party packages unless that dependency is intentional, audited, and central to the workflow

## Examples

- A backend auth invariant that should always apply to `api/**` edits:
  - `rule`
- A deeper API design and pagination playbook:
  - `skill`
- A reusable remote search surface used across multiple harnesses:
  - `MCP`
- A one-shot repo analyzer that reads local files and writes a report:
  - local `CLI` or script, optionally wrapped by a `skill`
- A single billing-portal session creation step inside a broader customer-ops workflow:
  - direct `API` call inside the workflow

## Practical Heuristic

If you are unsure, start smaller:

- start with a `rule` for deterministic invariants
- start with a `skill` for guidance/workflow
- start with a script for one-shot execution
- promote to `MCP` only when the structured server boundary is clearly paying for itself
