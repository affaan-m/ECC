# Lean, Full, and task selection delivery

ECC-029 advances M1: a canonical `lean@1` / `full@1` context contract. This development branch adds managed generations, experimental task selection, an opt-in isolated Codex session, and a preregistered outcome-evaluation pilot. Public release defaults remain governed by the M1 release gate.

## Development sequence and acceptance

| Stage | Deliverable | Acceptance |
| --- | --- | --- |
| Registry and compiler | One source-backed registry, Lean/Full plans, exact exclusions | Deterministic digests, resource closure, invalid-input fixtures |
| Native carriers | Complete skill trees and allowlisted native manifests | Fresh Claude/Codex inventory, exclusion and relocated resource readback |
| Managed state | Explicit private store, immutable generations, receipts, rollback and recovery | Full to Lean to Full, injected interruption, source drift, ownership and concurrency checks |
| Task selection | Manual, suggest and Auto over a stable base | Explicit IDs, bounded agent proposals, exclusions, manual-only rules, source-bound decisions, output budget |
| Interactive session | Receipt-bound bootstrap in an isolated native Codex home | Exact source and executable identity, bounded stdin resolution, refresh after binary or source drift |
| Disposable acceptance | Packed install in tiered clean environments | All ten layout/profile combinations, native Codex discovery, functional store and resolver |
| Release promotion | Certified activation adapters and outcome evidence | Provider invocation, measured whole-context budget, paired task quality, upgrade/uninstall matrix, reviewed PRs |

The first five stages are the local development target. Release promotion requires its own evidence and must retain explicit unsupported or unobserved states.

## User interface

```text
ecc profile preview lean --target codex --json
ecc profile set lean --state-root /absolute/dedicated/profile-store --selection auto --dry-run --json
ecc profile set lean --state-root /absolute/dedicated/profile-store --selection auto --json
ecc profile status --state-root /absolute/dedicated/profile-store --json
ecc profile mode suggest --state-root /absolute/dedicated/profile-store --json
ecc profile rollback --state-root /absolute/dedicated/profile-store --expected-revision 2 --json
ecc profile recover --state-root /absolute/dedicated/profile-store --json
ecc profile resolve lean --task-input task.json|- --json
ecc profile resolve lean --task-input task.json|- --load --json
ecc profile resolve --state-root /absolute/dedicated/profile-store --task-input task.json --load --json
ecc profile run --state-root /absolute/dedicated/profile-store --task-input task.json --dry-run --json
ecc profile prepare-native --state-root /absolute/dedicated/profile-store --native-root /absolute/dedicated/native-store --json
ecc profile native-status --state-root /absolute/dedicated/profile-store --native-root /absolute/dedicated/native-store --json
ecc profile run --state-root /absolute/dedicated/profile-store --native-root /absolute/dedicated/native-store --task-input task.json --dry-run --json
ecc profile start --state-root /absolute/dedicated/profile-store --native-root /absolute/dedicated/native-store
```

`set` materializes a verified generation and records the configured choice. `generationRoot` identifies the provider-shaped payload. A configured generation does not claim a running provider loaded it. Provider-owned skills can remain visible alongside ECC skills.

`resolve --state-root` uses the saved base, mode and exclusions. It rejects overrides and stale source generations. `mode` preserves the configured profile and explicit selections while recording the new mode transactionally.

A task input contains caller-assigned `sessionId`, `taskId`, positive integer `revision`, and `phase`. Optional fields are `query`, `explicitIds`, `proposedIds`, and `noWorkflow`. Increment revision for material task changes; keep it stable for rewording. Task prose is consumed locally and omitted from returned receipts.

```json
{
  "sessionId": "session-1",
  "taskId": "feature-1",
  "revision": 1,
  "phase": "implement",
  "explicitIds": ["skill:python-patterns"]
}
```

Auto uses explicit user IDs first, then a completed pinned decision or admitted agent-proposed IDs. Names and free text only shortlist up to five candidates; even a unique complete skill name cannot load a workflow without an explicit ID or admitted proposal. Manual uses explicit IDs; suggest emits a proposal without bodies. `--load` returns selected UTF-8 instructions and declared required resources, capped at 32,000 bytes across at most eight skills. `--task-input -` accepts one UTF-8 JSON object on standard input, capped at 65,536 bytes. These byte caps are output and transport bounds, not native tokenizer results.

Save the returned `selection.receipt` as a separate JSON document to use `--previous receipt.json`. `--expected-digest` can bind a load to a prior selection digest. Source, routing-policy version, profile, mode, exclusions, session, task revision and phase invalidate stale reuse. A pending proposal cannot be reused as a completed decision. Receipts are integrity checks for local operation, not an authorization signature.

An agent can call the resolver at task boundaries and read the returned context. This integration is prompt-advisory. Returning a body never grants tools, invokes shell interpolation, starts a native skill, changes hooks or installs dependencies. Native manual-only flags and authority-bearing metadata are checked before selection. Base profiles remain stable during task routing.

`run` is the explicit task-launch boundary. Ambiguous Auto routing makes one provider proposal call over candidate IDs and descriptions. It accepts zero or one known candidate, then rechecks source bindings, saved state, exclusions and admission policy before loading bodies. Invalid or stale proposals stop before task execution. The proposal has a 30-second timeout and 64 KiB output bound. Codex uses an ephemeral, filesystem-read-only agent session with inherited tools and configuration; the prompt's request to avoid tools is advisory, not enforced tool isolation. Claude disables tools and session persistence for this proposal. Task text is sent to the configured provider, so its normal authentication and data-handling policy apply.

The task call sends the query and selected reference content on standard input to `codex exec -` or `claude --print`, with no added task permissions or hook overrides. Current-provider launches inherit the provider process environment. An isolated native launch passes only the pinned home paths, `PATH`, a fixed locale, a private temporary directory, and required Windows system root; caller credentials, proxy settings, runtime injection and unrelated secrets are excluded. Its timeout is 90 seconds after a proposal or 120 seconds without one, uses an uncatchable termination signal, and captures at most 1 MiB. Dry run reports the pending proposal without a provider call. A zero provider exit code records process completion; task success and native skill invocation remain unverified. Routine interactive turns outside this launcher do not gain automatic routing.

## Isolated native Codex generations

`prepare-native` registers the managed carrier in a fresh ECC-owned home, verifies exact discovery through the allowlisted Codex 0.154.0 or 0.155.1 binary, and only then selects that native generation. It writes a bounded `AGENTS.md` bootstrap bound to the installed CLI source, managed roots, carrier, executable and receipt. It copies no credentials or user configuration and never rewrites the user's provider home. `native-status` checks the recorded generation, executable fingerprint, bootstrap source identity and managed-store binding. A launch pins that verified binary instead of resolving a different executable from PATH. Explicit preparation can refresh a changed executable or installed-source binding while preserving the prior generation and receipts.

`profile start` is an explicit terminal-only boundary. It revalidates the store and native generation, then launches the pinned Codex binary with inherited terminal capabilities and the isolated home. The bootstrap tells the active agent to resolve context at material task boundaries through bounded structured stdin. It remains prompt-advisory, grants no tools or permissions, and persists no task prose or selected skill bodies. Authentication must be completed separately inside the isolated home; the start path does not inherit or copy provider credentials.

Switching the managed profile makes the old native generation stale until `prepare-native` succeeds. To undo a switch, first `rollback` the managed store, then use `native-rollback` with both roots. `native-recover` handles a retained interruption journal without deleting provider data. Existing sessions retain their original context. These commands support isolated Codex generations, not migration of an existing global installation or native activation for other providers.

Discovery evidence comes from the generation's empty project. Task launch inherits the caller's task working directory, whose repository instructions and native configuration may add context or affect policy. Native readiness attests the isolated home's recorded inventory and integrity, not the complete context or permissions of every possible task directory.

## Outcome-evaluation pilot

`docker/context-profiles/ai-eval.js` is a development-only evaluator; it lives outside the published package. It preregisters a fixed corpus of 30 small coding tasks and at least 30 selection probes before any provider call, binding the corpus, profile plans, registry, implementation, Node runtime, dependency versions, model and executable digests. Each run prepares real Lean and Full Codex installs through the isolated native adapter above, then compares native Full discovery, manual Lean and Auto Lean on identical workspaces. A hidden grader enters each workspace only after the agent exits and runs read-only where Node supports its permission model.

Real execution requires an explicit flag and either a dedicated subscription login home (`--auth-home`) or `CODEX_API_KEY`. A subscription login is leased into each isolated call home, refreshed tokens are returned to the login home, and the leased copy is always removed. The evaluator never reads or copies the user's own Codex home. Results contain allowlisted metrics and hidden-check verdicts, not prompts, transcripts, paths or credentials. See `context-profile-ai-evaluation.md` for the setup, measurement contract and statistical limits.

## Community integration

Jeffrey Montoya's [#2788](https://github.com/affaan-m/ECC/pull/2788) informed whole-tree staging, ownership receipts and reversible generations. LovePlayCode's [#2844](https://github.com/affaan-m/ECC/pull/2844) informed deterministic grouping and explicit exclusion. Jeffrey's [#2945](https://github.com/affaan-m/ECC/pull/2945) informed bounded ID/description ranking and deterministic ties. Canonical source digests replace independent routing-cache authority. [#2740](https://github.com/affaan-m/ECC/pull/2740) remains aligned with native context meters and truthful measurement labels.

These are attributed adaptations of concepts; contributor commits have not been silently relabeled as our implementation. Source PR disposition remains separate.

## Remaining release gates

The store recovers actual process exits at five durable boundaries: prepared journal, file publication, generation publication, receipt publication and state publication. An interruption before the initial ownership marker is published, or a corrupted partial kernel write, is preserved for inspection. These cases do not receive an automatic recovery claim.

Authenticated provider execution, whole-context measurements and adequately powered task-quality canaries need additional evidence. The opt-in interactive bootstrap has local source, discovery and terminal-start evidence, but authenticated task behavior and native skill invocation remain unobserved. Isolated Codex registration, switching, refresh and rollback have local native evidence; changing a live user installation still requires its own ownership and recovery contract. Fresh-install default changes, existing-user migration, other-provider activation, hook plans, ECC Tools compatibility, hosted rollout and package publication remain outside this local preview.
