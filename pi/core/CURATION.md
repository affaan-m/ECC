# Curation

pi/core includes 123 of 293 skills and 24 of 94 commands from the root of ECC.
Everything excluded is listed here with its reason.

## Rules

Include: language/framework skills; testing/TDD; code review; security review (non-offensive); planning; refactoring; docs; git/PR workflows; prompt commands that are pure prompt workflows.

Exclude anything that:
- makes network calls, needs API keys, or downloads at runtime (npx, pip install, curl|sh)
- wraps third-party SaaS (exa, context7, fal, videodb, x-api, social/marketing/SEO/outreach)
- integrates commercial products (ECC Tools, ecc.tools, AgentShield, billing/ops skills)
- depends on Claude-Code-only mechanics (hooks, agent rosters/orch-*, continuous-learning, loops, hookify, cost tracking, session save/resume, gateguard)
- venture-specific (ito-*, prediction-market-*, hermes-*, nasiko-*, openclaw-*, x402)
- niche domain pack (healthcare/HIPAA, supply chain/logistics, homelab, scientific, visa/legal docs) or offensive security (bug bounty)

## Excluded skills

| Skill | Reason |
|---|---|
| `agent-payment-x402` | venture-specific x402 payments; wallet and network runtime |
| `agent-sort` | ECC install planner over the full ECC catalog; not portable |
| `agentic-os` | Claude-Code-only persistent OS mechanics (slash commands, memory, schedules) |
| `ai-regression-testing` | workflow creates Claude Code custom slash commands (.claude/commands) |
| `article-writing` | content/marketing writing, not engineering |
| `automation-audit-ops` | ECC ops audit of hooks/connectors/MCP surfaces |
| `autonomous-agent-harness` | Claude-Code-only autonomous harness (hooks, scheduling, computer use) |
| `autonomous-loops` | Claude-Code-only autonomous loops |
| `benchmark-methodology` | competitive/marketing benchmarking |
| `blender-motion-state-inspection` | niche 3D/Blender domain pack |
| `brand-discovery` | brand/marketing content |
| `brand-voice` | marketing/outreach voice profiling |
| `browser-qa` | requires a browser automation MCP server at runtime |
| `canary-watch` | makes network calls to deployed URLs |
| `carrier-relationship-management` | supply chain/logistics domain pack |
| `cisco-ios-patterns` | network-device ops niche domain |
| `ck` | Claude-Code-only persistent memory commands |
| `claude-devfleet` | multi-agent orchestration via external DevFleet product |
| `codehealth-mcp` | wraps CodeScene MCP SaaS |
| `competitive-platform-analysis` | competitive/marketing analysis |
| `competitive-report-structure` | competitive/marketing reporting |
| `config-gc` | Claude-Code-only config garbage collection (~/.claude) |
| `configure-ecc` | ECC-specific setup wizard |
| `connections-optimizer` | social/outreach (X and LinkedIn) |
| `content-engine` | social/marketing content system |
| `context-budget` | Claude-Code-only context window audit |
| `continuous-agent-loop` | continuous agent loops |
| `continuous-learning` | Claude-Code-only hooks-based continuous learning (deprecated) |
| `continuous-learning-v2` | Claude-Code-only hooks-based continuous learning |
| `cost-tracking` | Claude Code cost tracking |
| `council-multi-model` | requires external Codex CLI at runtime |
| `counterparty-channel-discipline` | agent messaging ops policy |
| `crosspost` | social/marketing distribution |
| `customer-billing-ops` | billing/ops skill over connected billing tools |
| `customs-trade-compliance` | customs/trade niche domain |
| `data-scraper-agent` | scheduled network scraping agent |
| `deep-research` | requires firecrawl and exa SaaS MCP tools |
| `defi-amm-security` | crypto/DeFi niche domain |
| `delivery-gate` | Claude-Code-only stop hook |
| `dmux-workflows` | multi-agent orchestration via dmux |
| `documentation-lookup` | wraps Context7 SaaS MCP |
| `dynamic-workflow-mode` | Claude dynamic workflow mode mechanics |
| `ecc-guide` | ECC repository self-reference |
| `ecc-recipes` | ECC command catalog self-reference |
| `ecc-tools-cost-audit` | ECC Tools commercial billing/ops |
| `email-ops` | mailbox ops skill |
| `energy-procurement` | energy procurement niche domain |
| `enterprise-agent-ops` | agent runtime ops, not portable engineering |
| `esign-field-placement` | niche e-sign browser automation |
| `eval-harness` | reads and writes .claude/evals (Claude-Code-only) |
| `evm-token-decimals` | crypto/EVM niche domain |
| `exa-search` | wraps Exa SaaS |
| `fal-ai-media` | wraps fal.ai SaaS |
| `finance-billing-ops` | billing/ops skill |
| `flox-environments` | runtime installer flow (curl\|sh) for Flox |
| `frontend-design-direction` | ECC-specific design direction |
| `frontend-slides` | presentation/content production, not engineering |
| `gan-style-harness` | Claude-Code-only generator/evaluator harness |
| `gateguard` | Claude-Code-only PreToolUse gate |
| `generating-python-installer` | niche Windows installer packaging with runtime downloads |
| `github-ops` | makes GitHub API calls via gh at runtime |
| `google-workspace-ops` | wraps Google Workspace SaaS |
| `growth-log` | ECC learning-log workflow |
| `healthcare-cdss-patterns` | healthcare niche domain pack |
| `healthcare-emr-patterns` | healthcare niche domain pack |
| `healthcare-eval-harness` | healthcare niche domain pack |
| `healthcare-phi-compliance` | healthcare/PHI niche domain pack |
| `hermes-imports` | venture-specific hermes-* |
| `hipaa-compliance` | HIPAA niche domain pack |
| `homelab-network-readiness` | homelab niche domain pack |
| `homelab-network-setup` | homelab niche domain pack |
| `homelab-pihole-dns` | homelab niche domain pack |
| `homelab-vlan-segmentation` | homelab niche domain pack |
| `homelab-wireguard-vpn` | homelab niche domain pack |
| `hookify-rules` | hookify (Claude-Code-only hooks) |
| `i18n-sync` | built around a third-party npm CLI (locakit) with external source links; not self-contained |
| `inventory-demand-planning` | supply chain niche domain |
| `investor-materials` | fundraising/marketing content |
| `investor-outreach` | fundraising outreach |
| `ios-icon-gen` | Iconify API network calls at runtime |
| `iterative-retrieval` | multi-agent subagent context mechanics; links to external social post |
| `ito-baskets` | venture-specific ito-* |
| `ito-compute` | venture-specific ito-* |
| `ito-inference` | venture-specific ito-* |
| `ito-training` | venture-specific ito-* |
| `jira-integration` | wraps Jira SaaS API |
| `knowledge-ops` | ops skill over MCP memory and vector stores |
| `laravel-plugin-discovery` | wraps LaraPlugins.io SaaS MCP |
| `lead-intelligence` | sales outreach pipeline |
| `llm-trading-agent-security` | trading-agent niche domain |
| `logistics-exception-management` | logistics niche domain |
| `loop-design-check` | agent loop design mechanics |
| `mailtrap-email-integration` | wraps Mailtrap SaaS API |
| `manim-video` | niche video production; pip installs at runtime |
| `market-research` | web research over network sources |
| `marketing-campaign` | marketing |
| `master-agreement-generator` | legal docs niche |
| `messages-ops` | messaging ops skill |
| `nanoclaw-repl` | ECC product-specific REPL |
| `nasiko-control-plane` | venture-specific nasiko-* |
| `netmiko-ssh-automation` | network-device ops niche; SSH at runtime |
| `network-bgp-diagnostics` | network ops niche domain |
| `network-config-validation` | network ops niche domain |
| `network-interface-health` | network ops niche domain |
| `nodejs-keccak256` | crypto/EVM niche domain |
| `nutrient-document-processing` | wraps Nutrient DWS SaaS API |
| `openclaw-persona-forge` | venture-specific openclaw-* |
| `opensource-pipeline` | multi-agent roster pipeline |
| `operator-approval-loop` | ECC ops approval contract |
| `orch-add-feature` | Claude-Code-only orch-* orchestration |
| `orch-build-mvp` | Claude-Code-only orch-* orchestration |
| `orch-change-feature` | Claude-Code-only orch-* orchestration |
| `orch-fix-defect` | Claude-Code-only orch-* orchestration |
| `orch-pipeline` | Claude-Code-only orch-* orchestration |
| `orch-refine-code` | Claude-Code-only orch-* orchestration |
| `plan-canvas` | Claude-Code-only plan canvas server |
| `plan-orchestrate` | ECC orchestration prompt generator over the full catalog |
| `plankton-code-quality` | Claude-Code-only write-time hooks |
| `prediction-market-oracle-research` | venture-specific prediction-market-* |
| `prediction-market-risk-review` | venture-specific prediction-market-* |
| `production-scheduling` | manufacturing niche domain |
| `project-flow-ops` | ops over GitHub/Linear SaaS |
| `prompt-optimizer` | ECC command/agent catalog self-reference |
| `quality-nonconformance` | regulated manufacturing niche |
| `ralphinho-rfc-pipeline` | multi-agent DAG orchestration |
| `recsys-pipeline-architect` | installs upstream package via npx skills add |
| `recursive-decision-ledger` | recursive prompting loops |
| `remotion-video-creation` | video/media production niche |
| `repo-scan` | downloads an external skill at runtime |
| `research-ops` | ECC ops research workflow with network enrichment |
| `returns-reverse-logistics` | logistics niche domain |
| `rules-distill` | Claude-Code-only rules distillation mechanics |
| `safety-guard` | Claude-Code-only PreToolUse hooks |
| `santa-method` | multi-agent adversarial review roster |
| `scientific-db-pubmed-database` | scientific niche domain pack |
| `scientific-db-uspto-database` | scientific niche domain pack |
| `scientific-pkg-gget` | scientific niche domain pack |
| `scientific-thinking-literature-review` | scientific niche domain pack |
| `scientific-thinking-scholar-evaluation` | scientific niche domain pack |
| `search-first` | network searches (npm/PyPI/GitHub) at runtime |
| `security-bounty-hunter` | offensive security (bug bounty) |
| `security-scan` | wraps AgentShield commercial product |
| `seo` | SEO/marketing |
| `skill-comply` | runs agent rosters for compliance checks |
| `skill-scout` | network searches of skill marketplaces |
| `skill-stocktake` | subagent-based Claude skill audit |
| `social-graph-ranker` | social graph (X and LinkedIn) |
| `social-publisher` | wraps SocialClaw SaaS |
| `strategic-compact` | Claude Code session compaction mechanics |
| `taste` | media/creative-direction niche pack |
| `taste-application` | media generation via fal.ai SaaS |
| `taste-distillation` | media analysis paired with fal.ai SaaS |
| `tasteforge-video` | media generation workflow over fal.ai SaaS |
| `team-agent-orchestration` | agent squad orchestration |
| `team-builder` | Claude agents roster picker |
| `terminal-opener` | ECC harness utility, not engineering content |
| `terminal-ops` | ECC ops workflow |
| `tinystruct-patterns` | niche single-framework pack |
| `token-budget-advisor` | session/token mechanics |
| `ui-demo` | Playwright video recording with runtime installs |
| `ui-to-vue` | runs an npx converter package at runtime |
| `uncloud` | niche cluster ops |
| `unified-memory` | ECC memory vault (session save/resume family) |
| `unified-notifications-ops` | ECC notifications ops |
| `video-editing` | media production niche |
| `videodb` | wraps VideoDB SaaS |
| `visa-doc-translate` | visa/legal docs niche; OCR network calls |
| `windows-desktop-e2e` | niche Windows desktop automation; pip installs at runtime |
| `workspace-surface-audit` | ECC harness surface audit |
| `x-api` | wraps X/Twitter SaaS API |

## Excluded commands

| Command | Reason |
|---|---|
| `auto-update` | ECC self-update/reinstall |
| `checkpoint` | writes .claude/checkpoints.log (Claude-Code-only) |
| `cost-report` | Claude Code cost tracking |
| `cpp-build` | invokes ECC agent roster (cpp-build-resolver) |
| `cpp-review` | invokes ECC agent roster (cpp-reviewer) |
| `ecc-guide` | ECC repository self-reference |
| `epic-claim` | GitHub epic ops over ECC coordination state; network |
| `epic-decompose` | GitHub epic ops over ECC coordination state; network |
| `epic-publish` | GitHub epic ops over ECC coordination state; network |
| `epic-review` | GitHub epic ops over ECC coordination state; network |
| `epic-sync` | GitHub epic ops over ECC coordination state; network |
| `epic-unblock` | GitHub epic ops over ECC coordination state; network |
| `epic-validate` | GitHub epic ops over ECC coordination state; network |
| `evolve` | instincts/continuous-learning mechanics |
| `flutter-build` | invokes ECC agent roster (dart-build-resolver) |
| `flutter-review` | invokes ECC agent roster (flutter-reviewer) |
| `gan-build` | GAN generator/evaluator loop harness |
| `gan-design` | GAN generator/evaluator loop harness |
| `go-build` | invokes ECC agent roster (go-build-resolver) |
| `go-review` | invokes ECC agent roster (go-reviewer) |
| `harness-audit` | ECC harness audit |
| `hookify-configure` | hookify (Claude-Code-only hooks) |
| `hookify-help` | hookify (Claude-Code-only hooks) |
| `hookify-list` | hookify (Claude-Code-only hooks) |
| `hookify` | hookify (Claude-Code-only hooks) |
| `instinct-export` | instincts (continuous-learning) |
| `instinct-import` | instincts (continuous-learning) |
| `instinct-status` | instincts (continuous-learning) |
| `jira` | wraps Jira SaaS API |
| `kotlin-build` | invokes ECC agent roster (kotlin-build-resolver) |
| `kotlin-review` | invokes ECC agent roster (kotlin-reviewer) |
| `learn-eval` | continuous-learning session extraction |
| `learn` | continuous-learning session extraction |
| `loop-start` | autonomous loops |
| `loop-status` | autonomous loops |
| `marketing-campaign` | marketing |
| `model-route` | ECC model routing/cost mechanics |
| `multi-backend` | multi-model orchestration |
| `multi-execute` | multi-model orchestration |
| `multi-frontend` | multi-model orchestration |
| `multi-plan` | multi-model orchestration |
| `multi-workflow` | multi-model orchestration |
| `orch-add-feature` | Claude-Code-only orch-* orchestration |
| `orch-build-mvp` | Claude-Code-only orch-* orchestration |
| `orch-change-feature` | Claude-Code-only orch-* orchestration |
| `orch-fix-defect` | Claude-Code-only orch-* orchestration |
| `orch-refine-code` | Claude-Code-only orch-* orchestration |
| `orch-review` | Claude-Code-only orch-* orchestration |
| `plan-canvas` | Claude-Code-only plan canvas server |
| `pm2` | PM2 runtime process manager ops |
| `project-init` | ECC install-manifest onboarding plan |
| `projects` | instincts (continuous-learning) |
| `promote` | instincts (continuous-learning) |
| `prune` | instincts (continuous-learning) |
| `python-review` | invokes ECC agent roster (python-reviewer) |
| `quality-gate` | drives the ECC PostToolUse formatter hook script |
| `react-build` | invokes ECC agent roster (react-build-resolver) |
| `react-review` | invokes ECC agent roster (react-reviewer) |
| `resume-session` | Claude Code session save/resume (~/.claude/session-data) |
| `review-pr` | invokes ECC agent roster (specialized review agents) |
| `rust-build` | invokes ECC agent roster (rust-build-resolver) |
| `rust-review` | invokes ECC agent roster (rust-reviewer) |
| `santa-loop` | multi-agent adversarial review loop |
| `save-session` | Claude Code session save/resume (~/.claude/session-data) |
| `security-scan` | wraps AgentShield commercial product |
| `sessions` | Claude Code session management |
| `setup-pm` | runs an ECC repo script (scripts/setup-package-manager.js) |
| `skill-create` | Claude Code skill authoring plus instincts |
| `skill-health` | ECC skill analytics dashboard |
| `vue-review` | invokes ECC agent roster (vue-reviewer) |

## Renames

- `council` is shipped as `ecc-council` inside pi/core (the root skill keeps its original name).
