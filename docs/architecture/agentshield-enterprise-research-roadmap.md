# AgentShield Enterprise Research Roadmap

Generated: 2026-05-12; refreshed with May 18 AgentShield fleet-ticket and
Mini Shai-Hulud IOC evidence.

This is a planning artifact for the next AgentShield enterprise iteration. It
does not modify AgentShield code. The goal is to turn the current scanner,
policy gate, corpus, and reporting surface into a security control plane for
teams running AI coding agents across multiple harnesses.

## Evidence Reviewed

Current AgentShield repository state:

- AgentShield checkout on clean `main`.
- `README.md`, `API.md`, `package.json`, `.github/workflows/*`, and
  `src/`/`tests/` module layout.
- Current supported user surfaces: `agentshield scan`, `agentshield init`,
  `agentshield miniclaw start`, scanner JSON, MiniClaw API, GitHub Action,
  HTML, SARIF, markdown, terminal, and JSON reports.
- Current enterprise-like surfaces: policy packs, GitHub Action policy
  enforcement, SARIF policy violations, supply-chain provenance, corpus
  benchmark, HTML executive reports, and exception lifecycle audit.

External references checked from official GitHub repos or README sources:

- [stablyai/orca](https://github.com/stablyai/orca): multi-agent IDE,
  worktree isolation, live agent status, GitHub integration, diff review, and
  notifications.
- [superset-sh/superset](https://github.com/superset-sh/superset): AI-agent
  editor with worktree orchestration, built-in diff review, workspace presets,
  and universal CLI-agent compatibility.
- [standardagents/dmux](https://github.com/standardagents/dmux): tmux/worktree
  multiplexer with lifecycle hooks, multi-agent launches, pane visibility, and
  merge/PR workflows.
- [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud): Claude
  Code statusline, context health, tool activity, agent tracking, todo
  progress, transcript parsing, and usage telemetry.
- [stanford-iris-lab/meta-harness](https://github.com/stanford-iris-lab/meta-harness):
  harness optimization through repeatable tasks, logged proposer interactions,
  and evaluated scaffold changes.
- [greyhaven-ai/autocontext](https://github.com/greyhaven-ai/autocontext):
  recursive improvement loop with traces, scored generations, playbooks,
  persisted knowledge, scenario evaluation, and optional production traces.
- [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent):
  self-improving skills, memory, session search, multi-platform gateway,
  scheduled automation, terminal backends, and trajectory generation.
- [anthropics/claude-code](https://github.com/anthropics/claude-code):
  terminal, IDE, GitHub, plugin, permission, MCP, and data-retention surfaces.
- [anomalyco/opencode](https://github.com/anomalyco/opencode): provider-agnostic
  open-source coding agent with build/plan agents, desktop beta,
  client/server architecture, and LSP support.
- [opencode-ai/opencode](https://github.com/opencode-ai/opencode): earlier
  archived Go-based terminal agent with sessions, providers, LSP, file change
  tracking, custom commands, and auto-compact.
- [zed-industries/zed](https://github.com/zed-industries/zed): high-performance
  multiplayer editor with strict license/compliance CI expectations.
- [aidenybai/ghast](https://github.com/aidenybai/ghast): native terminal
  multiplexer built around Ghostty, workspace grouping, split panes, drag/drop,
  notifications, and terminal search.

Local Claude Code source inspection:

- Reviewed only non-secret local file/module shape from a private Claude Code
  source snapshot.
- Relevant surfaces observed: `tools/`, `utils/permissions/`, `utils/mcp/`,
  `utils/hooks/`, `utils/plugins/`, `types/permissions.ts`,
  `types/plugin.ts`, `remote/`, `tasks/`, `assistant/sessionHistory.ts`,
  and session/history utilities.
- No code was copied. The takeaway is that AgentShield should track permissions,
  plugins, MCP, hooks, remote sessions, task/subagent activity, and history as
  first-class audit domains rather than treating a `.claude/` tree as the only
  source of truth.

## Current AgentShield Position

AgentShield is already more than a static lint tool:

- Rule coverage spans secrets, permissions, hooks, MCP servers, agent configs,
  prompt injection, supply chain, taint analysis, sandbox execution, policy
  evaluation, runtime repair/status, corpus validation, MiniClaw, and Opus
  analysis.
- Reports are usable by humans and machines: terminal, JSON, markdown, HTML,
  SARIF, scan logs, and GitHub Action outputs.
- Enterprise hooks exist: policy packs, exception metadata, expiring/expired
  exception reporting, SARIF code scanning, and job-summary output.
- Accuracy work is active: `runtimeConfidence`, template/example weighting,
  docs-example downgrades, installed Claude plugin-cache confidence,
  hook-manifest resolution, false-positive audit guidance, and corpus readiness.
- Evidence-pack consumption is now first-class enough for downstream tools:
  `agentshield evidence-pack inspect` verifies a bundle and emits compact
  JSON/text summaries for report score, finding counts, runtime confidence,
  policy, baseline, supply-chain, CI context, remediation, and malformed
  artifact errors.
- Fleet-level evidence-pack consumption now has a local routing primitive:
  `agentshield evidence-pack fleet <dirs...> [--json]` aggregates multiple
  inspected bundles into ready, security-blocker, policy-review,
  baseline-regression, supply-chain-review, and invalid routes.
- ECC-Tools now consumes that fleet primitive in hosted security review:
  `agentshield-evidence/fleet-summary.json` routes invalid packs, security
  blockers, policy reviews, baseline regressions, and supply-chain reviews into
  hosted findings.

May 16 update: AgentShield PR #87 merged as
`26bb44650663816d07180e0d20c1895e431a326c`. It classifies installed Claude
plugin cache content as `runtimeConfidence: plugin-cache`, keeps non-secret
plugin-cache score impact at `0.5x`, avoids downgrading repository-local
non-Claude `plugins/cache` paths, and makes plugin-cache classification win
before cached hook implementations would otherwise appear as active `hook-code`.
AgentShield PR #88 merged as
`65ed6e2a87545dc99d962b58413f49096a4d70ec`. It adds
`agentshield evidence-pack inspect <dir> [--json]`, validates the bundle before
readback, summarizes every consumer-facing evidence artifact, and keeps
malformed-but-valid JSON artifacts from crashing inspection.
AgentShield PR #89 merged as
`521ada9091bb6d818511ab8589ae675b920c106a`. It adds
`agentshield evidence-pack fleet <dirs...> [--json]`, verifies each pack through
the inspect path, aggregates finding, policy, baseline, supply-chain, and
remediation totals, and assigns each pack to a deterministic fleet route.
AgentShield commit `840952a7a07f820f24081c43df656d7f7295f23b` adds
Linear/operator-ready fleet review ticket payloads with priority, labels,
titles, and Markdown bodies. The same commit expands current Mini
Shai-Hulud/TanStack IOC coverage for the in-cluster Vault endpoint and
temporary lockfile breadcrumb, with local typecheck, lint, full tests,
`git diff --check`, and GitHub CI/Self-Scan/Action-test evidence.

The next iteration after fleet routing should not be "add more regex rules" by
default. ECC-Tools follow-up routing now consumes fleet summaries and surfaces
source evidence paths in hosted findings, and the first cross-harness policy
slice now links AgentShield fleet route target paths to harness-owner review.
AgentShield fleet output now also emits `reviewItems` with source evidence paths
and owner-ready recommendations plus copy-ready ticket payloads for routed
packs. The higher leverage move is durable operator approval/readback and
workflow automation for routed fleet findings.

## Enterprise Gaps

### 1. Organization Baselines And Drift

Enterprise buyers need to know whether a repo, team, or agent fleet is getting
safer or riskier over time. AgentShield has scan logs and baseline comparison
modules, and PR #63 now exposes that drift through GitHub Action inputs,
outputs, annotations, and job-summary evidence. PR #64 adds first-class
baseline snapshot creation through `agentshield baseline write`. The remaining
product surface should make CLI drift summaries, evidence packs, and
owner-ready deltas explicit.

Target capability:

- `agentshield baseline write --path .claude --output agentshield-baseline.json`
- `agentshield scan --baseline agentshield-baseline.json`
- Report sections for new, fixed, unchanged, suppressed, and policy-excepted
  findings.
- GitHub Action output that posts "security posture changed" rather than only a
  point-in-time grade.

### 2. Multi-Harness Security Adapters

The market is moving toward many parallel agent harnesses, not one tool. Orca,
Superset, dmux, OpenCode, Claude Code, Codex, Gemini, Zed, and terminal
multiplexers all create different security surfaces.

Target capability:

- A small adapter registry for `claude-code`, `opencode`, `codex`, `gemini`,
  `zed`, `dmux`, `orca`, `superset`, and `generic-terminal`.
- Each adapter declares config paths, permission concepts, plugin surfaces,
  MCP/tooling conventions, history/session surfaces, and CI evidence.
- Report output groups findings by harness and confidence, so template/docs
  findings do not look like active runtime exposure.

### 3. Session And Worktree Awareness

Worktree-native orchestrators change the risk model. A team can run many agents
in parallel, each with its own branch, shell, MCP config, and local state.

Target capability:

- Optional scan metadata for branch, worktree path, agent name, session id,
  provider, and orchestrator.
- A scan-history table that answers: which worktree introduced a new permission,
  which agent run added a risky MCP, which branch relaxed policy, and whether
  the final merged branch fixed it.
- A compact "security HUD" summary usable by statuslines, GitHub checks, and
  local dashboards.

### 4. Evidence Packs For Buyers And Auditors

HTML reports are the right buyer-facing artifact today; native PDF is deferred.
The deeper need is a portable evidence bundle that can be attached to audits,
security reviews, and customer questionnaires.

Target capability:

- `agentshield scan --evidence-pack out/agentshield-evidence`
- Bundle includes JSON report, HTML report, SARIF, policy evaluation,
  exception audit, baseline diff, dependency/provenance summary, and a short
  README explaining how to interpret the artifacts.
- Optional redaction mode for secrets, local paths, usernames, and project names.

### 5. Regression Corpus And Reference Sets

Meta-Harness and Autocontext point to the same lesson: improvements need scored
scenarios, traces, and playbooks. AgentShield already has a corpus benchmark,
but enterprise trust needs a curated reference set for false positives,
false negatives, and policy regressions.

Target capability:

- Versioned scenario fixtures for critical rules, false-positive suppressions,
  policy exceptions, template/docs examples, plugin manifests, and hook-code
  resolution.
- Per-category precision/coverage reporting, not just aggregate readiness.
- A "no accuracy regression" gate that must pass before releases.
- Playbook notes for why a suppression exists and when it should expire.

### 6. Remediation Workflow

Security tools become enterprise-grade when they turn findings into accountable
work without flooding maintainers.

Target capability:

- One-click or CLI-generated remediation branch for safe transforms.
- Policy comments that group findings by owner and risk rather than by file
  order.
- GitHub App support for check-run annotations, issue caps, Linear sync, and
  deferred backlog export.
- Finding fingerprints that avoid duplicate issues across repeated scans.

### 7. Threat Intelligence And Package Reputation

Agent security depends on MCP packages, plugin repositories, action bundles,
and rapidly changing CLI ecosystems. Static checks need a maintained external
reputation layer.

Target capability:

- A local-first threat-intel cache for known MCP/package risks, CVEs, malware
  package names, suspicious install scripts, mutable git dependencies, and
  known-good packages.
- Offline deterministic mode remains available.
- Online enrichment is opt-in and produces clear provenance for every external
  claim.

### 8. Commercial And Team Controls

AgentShield is already connected conceptually to the ECC Tools GitHub App.
Native GitHub payments make the product path more concrete: free local scans,
paid org policy gates, paid evidence bundles, and paid drift/history.

Target capability:

- Tier-aware GitHub App checks: free static scan, paid org policy enforcement,
  paid evidence packs, paid historical drift, and paid deep analysis.
- Seat/team mapping for policy owners and exception approvers.
- Billing readiness checks shared with ECC-Tools so payment state never changes
  enforcement behavior silently.

## Recommended Build Order

### Slice 1: Baseline Drift MVP

Implement the smallest enterprise control-plane primitive: compare this scan to
the last accepted baseline.

Artifacts:

- Baseline JSON schema.
- Baseline writer and comparator.
- Terminal and JSON report sections for new/fixed/unchanged findings.
- Tests covering stable fingerprints, fixed findings, new findings, and policy
  exception carry-forward.

Why first:

- It reuses existing scan output.
- It improves CLI, GitHub Action, and GitHub App value at once.
- It does not require a hosted service.

### Slice 2: Evidence Pack Bundle

Bundle the existing machine and human reports into a portable audit artifact.

Artifacts:

- `--evidence-pack <dir>` CLI flag.
- Redacted bundle README.
- HTML, JSON, SARIF, policy, exception, and baseline diff files.
- Tests for file layout, redaction, and deterministic output names.

Why second:

- It converts existing reporting work into buyer-ready proof.
- It keeps native PDF deferred while still meeting audit handoff needs.

### Slice 3: Harness Adapter Registry

Make harness support explicit instead of implicit.

Artifacts:

- Adapter metadata for Claude Code, OpenCode, Codex, Gemini, dmux, generic
  terminal, and project-local templates.
- Discovery output that reports which adapters matched and why.
- Report grouping by adapter.
- Tests using fixture directories for each adapter.

Why third:

- It aligns AgentShield with ECC's harness-agnostic positioning.
- It creates a stable surface for future Zed, Orca, Superset, and Hermes
  integration without pretending all harnesses share Claude's config model.

### Slice 4: Corpus Accuracy Gate

Promote the corpus from a benchmark into a release gate.

Artifacts:

- Per-category corpus report.
- Required category thresholds.
- Regression snapshots for known false-positive suppressions.
- Release checklist entry requiring corpus readiness before publish.

Why fourth:

- It prevents enterprise credibility from degrading as rules expand.
- It creates a durable route for Meta-Harness/Autocontext-style improvement
  loops later.

### Slice 5: GitHub App And Linear Sync Wiring

Connect AgentShield findings to ECC-Tools follow-up routing.

Artifacts:

- Finding fingerprints compatible with ECC-Tools issue caps.
- Linear-ready backlog export for baseline drift and policy violations.
- Check-run annotations grouped by owner/risk.
- Tests that ensure repeated scans do not spam duplicate issues.

Why fifth:

- It needs the baseline/fingerprint work from Slice 1.
- It is the bridge from local CLI to paid team workflow.

## Non-Goals For This Iteration

- Native PDF generation, unless buyer/compliance workflows explicitly require
  generated PDF instead of HTML plus print-to-PDF.
- Hosted dashboards before the local baseline/evidence/fingerprint contracts are
  stable.
- Fine-tuning or model training before deterministic corpus gates and reference
  traces exist.
- Broad automated code rewrites for risky findings without explicit,
  reviewable transforms and tests.

## Acceptance Gates

The AgentShield enterprise iteration is not complete until these are true:

- Local `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`
  pass from the AgentShield repository root.
- Built CLI smoke tests cover the new flags or report modes.
- GitHub Action self-test covers the new CI-visible output.
- Documentation names the free/local path and the paid/team path separately.
- Runtime-confidence changes include live scan evidence proving lower-confidence
  plugin/package surfaces stay visible instead of being suppressed.
- Evidence produced by the feature is deterministic enough for CI diffing.
- ECC-Tools can consume the finding fingerprints or backlog export without
  exceeding GitHub/Linear object caps.
- The GA roadmap and Linear project status link to the merged AgentShield PRs.
