# ECC v2.0.0-rc.1 Release Notes

## Positioning

ECC v2.0.0-rc.1 is the first release-candidate surface for ECC as a cross-harness operating system for agentic work.

Claude Code remains a core target. Codex, OpenCode, Cursor, Gemini, and other harnesses are treated as execution surfaces that can share the same skills, rules, MCP conventions, and operator workflows. ECC is the reusable substrate; Hermes is documented as the operator shell that can sit on top of that layer.

## What Changed

- Added the sanitized Hermes setup guide to the public release story.
- Added launch collateral in-repo so the release can ship from one reviewed surface.
- Clarified the split between ECC as the reusable substrate and Hermes as the operator shell.
- Documented the cross-harness portability model for skills, hooks, MCPs, rules, and instructions.
- Added a Hermes import playbook for turning local operator patterns into publishable ECC skills.
- Added Zed as a project-local planning/install target while keeping BYOK and OpenRouter secrets outside ECC-managed project files.
- Added command-registry coverage, platform audit, discussion audit, operator dashboard, Linear progress readiness, and preview-pack smoke gates.
- Added a local [observability readiness gate](../../architecture/observability-readiness.md) for loop status, session traces, harness audit, and ECC2 tool-risk logs.
- Refreshed the release-readiness evidence after the May 2026 Mini
  Shai-Hulud/TanStack campaign follow-up, including full-campaign AgentShield
  IOC coverage, queue-zero/discussion checks, a detailed Linear roadmap gate,
  the May 18 operator dashboard snapshot, and a live/pending release URL
  ledger for announcement gating.

## Since v1.10.0

The rc.1 surface now includes the main 2.0 direction rather than one isolated
feature branch:

- cross-harness substrate work for Claude Code, Codex, OpenCode, Cursor,
  Gemini, Zed, and terminal-only workflows;
- stronger package and plugin publication surfaces for npm, Claude plugin,
  Codex repo-marketplace, OpenCode, and agent metadata;
- operator gates for PRs, issues, discussions, stale legacy work, Linear
  progress, release evidence, and dashboard repeatability;
- supply-chain hardening after the Mini Shai-Hulud/TanStack campaign,
  including IOC scanning, no-lifecycle CI installs, advisory-source refresh,
  npm audit/signature checks, and user-level AI-tool persistence targets;
- AgentShield enterprise-roadmap mirrors for package-manager hardening,
  evidence-pack provenance, policy export, policy promotion, fleet routing,
  and GitHub Action output telemetry;
- ECC Tools roadmap mirrors for hosted analysis, fleet-summary consumption,
  finding evidence paths, harness policy-route linking, hosted promotion judge
  audit traces, billing announcement preflight, and production Marketplace
  readback state;
- documentation expansion, Japanese localization, zh-CN to ja-JP parity
  repair, and dependency readiness through TypeScript 6 and Node type updates;
- launch collateral for GitHub release copy, X, LinkedIn, article outline,
  Telegram/Hermes handoff, demo prompts, partner/sponsor/talk outreach, and
  the approval-gated launch checklist.
- a release URL ledger that separates links which already resolve from links
  that must wait for the GitHub release, npm rc package, plugin tag/directory,
  and ECC Tools billing readback.

## Why This Matters

ECC is no longer only a Claude Code plugin or config bundle.

The system now has a clearer shape:

- reusable skills instead of one-off prompts
- hooks and tests for workflow discipline
- MCP-backed access to docs, code, browser automation, and research
- cross-harness install surfaces for Claude Code, Codex, OpenCode, Cursor, and related tools
- Hermes as an optional operator shell for chat, cron, handoffs, and daily work routing

## Release Candidate Boundaries

This is a release candidate, not the final GA claim.

What ships in this surface:

- public Hermes setup documentation
- release notes and launch collateral
- cross-harness architecture documentation
- Hermes import guidance for sanitized operator workflows
- publication-readiness evidence for queue state, discussion state, Linear roadmap coverage, operator dashboard status, and supply-chain follow-up
- preview-pack smoke evidence proving the public pack is assembled without private Hermes state

What stays local:

- secrets, OAuth tokens, and API keys
- private workspace exports
- personal datasets
- operator-specific automations that have not been sanitized
- deeper CRM, finance, and Google Workspace playbooks

## Upgrade Motion

1. Follow the [rc.1 quickstart](quickstart.md).
2. Read the [Hermes setup guide](../../HERMES-SETUP.md).
3. Review the [cross-harness architecture](../../architecture/cross-harness.md).
4. Run the [observability readiness gate](../../architecture/observability-readiness.md).
5. Check the [release URL ledger](release-url-ledger-2026-05-19.md) before
   using any announcement links.
6. Start with one workflow lane: engineering, research, content, or outreach.
7. Import only sanitized operator patterns into ECC skills.
8. Treat `ecc2/` as an alpha control plane until release packaging and installer
   behavior is finalized.

## Do Not Treat This As Published Yet

The release candidate copy is ready for final review, but the public release is
still blocked on approval-gated actions: the GitHub prerelease, npm `next`
publish, Claude plugin tag/marketplace path, Codex Plugin Directory status,
final live URLs, and any billing or native-payments announcement.
