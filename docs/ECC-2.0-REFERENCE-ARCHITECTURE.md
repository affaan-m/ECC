# ECC 2.0 Reference Architecture

Current execution mirror:
[`ECC-2.0-GA-ROADMAP.md`](ECC-2.0-GA-ROADMAP.md).

This document turns the May 2026 reference sweep into concrete ECC backlog
shape. It is not a second strategy memo: every reference pressure below should
land as an adapter, check, observable signal, security policy, PR review
surface, or release-readiness gate.

## Reference Baseline

Snapshot date: 2026-05-12.

| Reference | Primary pressure on ECC 2.0 | Concrete ECC delta |
| --- | --- | --- |
| [`stablyai/orca`](https://github.com/stablyai/orca) | Worktree-native multi-agent IDE with terminals, source control, GitHub integration, SSH, notifications, design/browser mode, account switching, and per-worktree context. | Treat worktree lifecycle, review state, notification state, and account/provider identity as first-class adapter signals. |
| [`superset-sh/superset`](https://github.com/superset-sh/superset) | Desktop AI-agent workspace with parallel execution, worktree isolation, diff review, workspace presets, and broad CLI-agent compatibility. | Add workspace preset taxonomy and make ECC2 session/worktree state exportable enough for external editors to consume. |
| [`standardagents/dmux`](https://github.com/standardagents/dmux) | Tmux/worktree orchestration, lifecycle hooks, multi-select agent control, smart merging, file browser, notifications, and cleanup. | Add lifecycle-hook coverage to the harness matrix and define merge/conflict queue events. |
| [`aidenybai/ghast`](https://github.com/aidenybai/ghast) | Native macOS terminal multiplexer with cwd-grouped workspaces, panes, tabs, drag/drop, search, and notifications. | Preserve terminal-native ergonomics while adding cwd/session grouping and searchable handoff/session records. |
| [`jarrodwatts/claude-hud`](https://github.com/jarrodwatts/claude-hud) | Always-visible Claude Code statusline for context, tools, agents, todos, and transcript-backed activity. | Formalize the ECC HUD/status payload for context, cost, tool calls, active agents, todos, queue state, checks, and risk. |
| [`stanford-iris-lab/meta-harness`](https://github.com/stanford-iris-lab/meta-harness) | Automated search over task-specific harness design: what to store, retrieve, and show. | Split ECC improvement loops into scenario spec, proposer trace, verifier result, and promoted playbook. |
| [`greyhaven-ai/autocontext`](https://github.com/greyhaven-ai/autocontext) | Recursive harness improvement using traces, reports, artifacts, datasets, playbooks, and role-separated evaluators. | Store reusable traces and playbooks before mutating installed harness assets. |
| [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) | Self-improving operator shell with memories, skills, scheduler, gateways, subagents, terminal backends, and migration tooling. | Keep ECC portable across local, SSH, container, and hosted terminal backends without hiding the underlying commands. |
| [`anthropics/claude-code`](https://github.com/anthropics/claude-code), [`sst/opencode`](https://github.com/sst/opencode), Zed, Codex, Cursor, Gemini | Different agent harnesses expose different hooks, plugin surfaces, session stores, config files, and review loops. | Maintain a public adapter compliance matrix instead of treating one harness as the canonical UX. |
| Local Claude Code source review | Session, tool, permission, hook, remote, analytics, task, and context-suggestion surfaces are more structured than the public CLI UX suggests. | Model status and risk events around session messages, permission requests, tool progress, context pressure, and summary state. |

## Architecture Shape

ECC 2.0 should be a harness operating system, not only a catalog of commands,
agents, and skills.

```text
┌──────────────────────────────────────────────────────────────┐
│ Operator Surface                                             │
│ CLI, plugin, TUI, HUD/statusline, release gates, PR checks   │
├──────────────────────────────────────────────────────────────┤
│ Harness Adapter Layer                                        │
│ Claude Code, Codex, OpenCode, Cursor, Gemini, Zed, dmux,     │
│ Orca, Superset, Ghast, terminal-only                         │
├──────────────────────────────────────────────────────────────┤
│ Worktree, Session, And Queue Runtime                         │
│ worktrees, panes, sessions, todos, checks, merge/conflict    │
│ queues, notification state, ownership, handoff exports       │
├──────────────────────────────────────────────────────────────┤
│ Observability And Evaluation Loop                            │
│ JSONL traces, status snapshots, risk ledger, harness audit,  │
│ scenario specs, verifiers, promoted playbooks, RAG sets      │
├──────────────────────────────────────────────────────────────┤
│ Security And Commercial Platform                             │
│ AgentShield policies/SARIF, ECC Tools checks, billing,       │
│ Linear/GitHub sync, enterprise reports                       │
└──────────────────────────────────────────────────────────────┘
```

## Reference-To-Backlog Map

### Worktree And Session Orchestration

Adopt from Orca, Superset, dmux, and Ghast:

- Worktree lifecycle events: create, resume, pause, stop, diff, review, PR,
  merge-ready, conflict, stale, close, salvage.
- Session grouping by repo, branch, cwd, task, owner, and harness.
- Workspace presets for release lane, PR triage lane, docs lane, security lane,
  and test-writer lane.
- Notifications for blocked CI, dirty worktrees, merge conflicts, stale review,
  and finished autonomous runs.
- Review loops that can annotate diffs and PRs without taking ownership away
  from maintainers.

Repo work:

- `everything-claude-code`: extend the adapter compliance matrix and public
  scorecard onramp.
- `ecc2`: surface session/worktree state through a stable local payload before
  adding hosted telemetry.
- `ECC-Tools`: consume the same lifecycle events for PR checks, issue routing,
  and Linear sync.

Verification:

- `npm run harness:audit -- --format json`
- `npm run observability:ready`
- targeted adapter matrix tests once the matrix moves from docs to data

### HUD, Status, And Observability

Adopt from Claude HUD and the Claude Code source review:

- Context pressure: usage, compaction risk, large-result warnings, and summary
  state.
- Tool activity: active tool, recent tools, duration, risky operations, and
  permission requests.
- Agent activity: active subagents, delegated task, branch/worktree, and wait
  state.
- Queue activity: open PRs/issues, CI state, stale/conflict batches, review
  state, and closed-stale salvage backlog.
- Cost/risk: token cost estimate, destructive-operation risk, hook/MCP risk,
  and security scan state.

Repo work:

- Keep `docs/architecture/observability-readiness.md` as the operator-facing
  readiness gate.
- Define a versioned HUD/status JSON contract that both ECC2 and ECC Tools can
  consume.
- Add sample exports from `loop-status`, `session-inspect`, harness audit, and
  risk ledger into a fixture directory before building visual UI.

Verification:

- `npm run observability:ready`
- fixture validation for every status payload
- cross-platform smoke test for commands that read session history

### Self-Improving Harness Loop

Adopt from Meta-Harness, Autocontext, and Hermes Agent:

- Separate the loop into observation, proposal, verification, promotion, and
  rollback.
- Store every proposed improvement as trace plus artifact, not only as a final
  changed file.
- Promote playbooks only after a verifier proves that they improve a scenario
  without widening blast radius.
- Use RAG/reference sets for vetted ECC patterns, team history, CI failures,
  review outcomes, harness config quality, and security decisions.

Repo work:

- `everything-claude-code`: document scenario specs, verifier contracts, and
  playbook promotion rules.
- `ECC-Tools`: map analyzer findings to PR comments, check runs, and Linear
  tasks without flooding the workspace.
- `agentshield`: feed prompt-injection and config-risk findings into regression
  suites.

Current prototype:

- `docs/architecture/evaluator-rag-prototype.md` defines the read-only
  evaluator/RAG artifact contract.
- `examples/evaluator-rag-prototype/` records the first scenario spec, trace,
  report, candidate playbook, and verifier result for stale-PR salvage.

Verification:

- read-only prototype that emits a trace, report, candidate playbook, and
  verifier result
- regression fixture proving a bad proposal is rejected

### AgentShield Enterprise Security Platform

AgentShield should move from useful scanner to enterprise security platform.

Backlog shape:

- Policy schema for org baseline, rule severity, owner, exception, expiration,
  evidence, and audit trail.
- SARIF output for GitHub code scanning.
- Policy packs for OSS, team, enterprise, regulated, high-risk hooks/MCP, and
  CI enforcement.
- Supply-chain intelligence for MCP packages, npm/pip provenance, CVEs,
  typosquats, and dependency reputation.
- Prompt-injection corpus and regression benchmark.
- JSON plus executive HTML/PDF report output.

Verification:

- schema unit tests
- SARIF fixture tests
- policy-pack golden tests
- false-positive regression tests from the public issue history

### ECC Tools Commercial And Review Platform

ECC Tools should become the GitHub-native layer for billing, deep analysis,
PR checks, and Linear progress tracking.

Backlog shape:

- Native GitHub Marketplace billing audit before any payments announcement:
  plans, seats, org/account mapping, subscription state, overage behavior,
  downgrade/cancel behavior, and failure modes.
- Deep analyzer comparable in scope to the useful parts of GitGuardian,
  Dependabot, CodeRabbit, and Greptile: security evidence, dependency risk,
  CI/CD recommendations, PR review behavior, config quality, token/cost risk,
  and harness drift.
- RAG/reference set over vetted ECC patterns, historical PR outcomes,
  dependency advisories, CI failures, review decisions, and team-specific
  conventions.
- Linear sync that maps findings to project status, milestone evidence, and
  owner-ready issues without exhausting issue limits.

Verification:

- check-run fixture tests
- billing webhook replay tests
- analyzer golden PR fixtures
- Linear sync dry-run fixture

### Closed-Stale Salvage Lane

Closing stale PRs keeps the public queue usable, but useful work should not be
lost because a contributor no longer has time to rebase.

Execution rule:

1. Close stale, conflicted, or obsolete PRs with a clear courtesy comment.
2. Record them in a salvage ledger with source PR, author, reason closed,
   useful files/concepts, risk, and recommended maintainer action.
3. After the cleanup batch, inspect each closed PR diff manually.
4. Cherry-pick only when the patch still applies cleanly and preserves current
   architecture. Otherwise reimplement the useful idea in a fresh maintainer
   branch.
5. Preserve attribution in the commit body or PR body.
6. Comment back on the source PR when useful work lands, linking the maintainer
   PR or merged commit.
7. Mark the ledger item as landed, superseded, Linear-tracked, or no-action.

Required safeguards:

- Never blind cherry-pick generated churn, bulk localization, or dependency
  major-version changes.
- Prefer small maintainer PRs over one salvage megabranch.
- Run the same validation gates as normal code, docs, or catalog changes.
- Keep contributor credit even when the final implementation is rewritten.

## Near-Term Implementation Order

1. Extend the harness adapter matrix and public scorecard onramp.
2. Keep the release/name/plugin publication checklist current with fresh
   final-commit evidence before rc.1 publication.
3. Define the HUD/status JSON contract and fixture directory.
4. Start AgentShield policy schema plus SARIF fixtures.
5. Audit ECC Tools billing and check-run surfaces.
6. Inventory legacy folders and closed-stale PRs into the salvage ledger.
7. Port useful stale work in small attributed maintainer PRs.

## Non-Goals

- Hosted telemetry before the local event model is useful and testable.
- Automatic mutation of user harness configs without verifier evidence.
- Treating any one agent harness as the canonical interface.
- Release or payments announcements before command, package, marketplace, and
  billing evidence is fresh.
