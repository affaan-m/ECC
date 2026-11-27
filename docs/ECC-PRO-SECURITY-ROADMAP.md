# ECC Pro + AgentShield Security Roadmap

> Status: draft for review. Generated 2026-06-21 from a multi-agent survey + research pass
> (capability map of AgentShield and ECC Pro, triage of every open PR/issue on both repos,
> and web research on competitors, unbuilt ideas, and dev-tool demand). MRR-biased: every
> item is scored for how it converts the free funnel into paid ECC Pro / Enterprise.

## Why now

AgentShield (npm `ecc-agentshield`) is doing roughly **30K downloads/month with no decay**
(~7.2K/week, ~78K year-to-date) and **903 GitHub stars** — a large, growing top-of-funnel.
Today there is almost no bridge from that free funnel to paid ECC Pro, and the single most
ownable paid surface — the agent-proximity "airspace" moat — is fully computed but never
rendered. This roadmap is built to close both gaps: remove the trust blockers that suppress
conversion, make the moat visible, then productize the local CLI primitives into hosted,
recurring-revenue surfaces.

## Themes

### Trust & conversion gate (now)

AgentShield's ~30K/month free funnel only converts if the product is trustworthy and the upgrade path is visible. False positives that punish correct hardening, broken model IDs that hard-fail the LLM layer, Windows crashes, and security bugs in our own learning layer all erode trust before a user ever sees a Pro prompt. Fixing the FP cluster, shipping verified correctness/security fixes, and surfacing a Pro CTA at the point of value are the highest-leverage immediate moves.

### Make the moat visible & demo-able (now)

The agent-proximity 'airspace' metric is the single differentiated capability nothing else has, but it is math + JSON with zero UI rendering. Shipping the 3D observability dashboard (PR #2320) turns the strongest narrative asset into a demo that sells Team/Enterprise seats on sight.

### Productize local primitives into hosted Pro SaaS (next)

Every continuous/fleet capability — watch/drift, baseline gates, evidence-pack fleet operatorReadback, runtime NDJSON, org policy packs — already exists as local CLI building blocks. The fastest path to MRR is hosting these as authenticated multi-repo surfaces: continuous-scanning dashboard, inline PR review + autofix-PR, rule-pack loader + intel feed, compliance packs, and centrally-managed org policy.

### Close competitive gaps & expand reach (next/later)

Snyk Agent Scan, NVIDIA SkillSpector, and GoPlus AgentGuard validate the category and add runtime enforcement, LLM-judge semantic detection, and live MCP fetch that AgentShield lacks. LLM-judge Deep Scan, a free runtime guard with Pro telemetry, cross-machine A2A airspace, and a community MCP reputation registry neutralize those differentiators while keeping the free, zero-account, local-first posture as the moat. Harness-neutral expansion widens the whole funnel.

## Top 5 — do now

1. Merge PR #103 and ship the issue #100 follow-up to kill the false-positive cluster that punishes correct hardening (trust is the conversion gate)
2. Merge PR #2320 to render the 3D agent-airspace observability dashboard (the moat made visible and demo-able)
3. Add a Pro upgrade CTA to free CLI output + GitHub App PR comments to monetize the ~30K/month free download funnel, leading with the privacy + low-noise wedge
4. Merge the verified correctness/Windows batch (PR #2133 model-ID fix, #2307/#2063 Windows, #2273/#2246/#2312 docs, #2293 deps) and fix issue #2316 plan-orchestrate install detection
5. Harden continuous-learning storage: fix path traversal #2297 and registry-corruption race #2294 (security credibility for the brand Pro trades on)

## Roadmap at a glance

| Horizon | Item | Area | Effort | Impact |
| --- | --- | --- | --- | --- |
| now | Fix the false-positive cluster that punishes correct hardening | agentshield | S | high |
| now | Add autofix verification loop (re-scan + no-regression proof) | agentshield | M | medium |
| now | Render the 3D agent-airspace observability dashboard (the moat made visible) | ecc-pro | M | flagship |
| now | Add a Pro conversion CTA to free CLI output and GitHub App PR comments | both | S | high |
| now | Ship merge-ready correctness and Windows fixes that protect release velocity and core UX | ecc-core | S | medium |
| now | Harden continuous-learning storage (path traversal + registry race) | ecc-core | S | medium |
| next | Hosted continuous-scanning dashboard with fleet trend lines ('Sentry for agent security') | agentshield | L | flagship |
| next | Inline PR-comment review + autofix-PR via the ecc-tools GitHub App | agentshield | M | high |
| next | External rule-pack loader (--rule-pack) + curated commercial intel feed | agentshield | M | high |
| next | Pro Deep Scan: LLM-judge semantic detection + live MCP tool fetch + rug-pull pinning | agentshield | L | high |
| next | Compliance/evidence packs mapped to SOC2/PCI/ISO controls | agentshield | M | high |
| next | Centrally-managed org policy + RBAC distribution | agentshield | L | high |
| next | Harness-neutral expansion: Kimi, Codex alias, OpenClaude/Codex compat | ecc-core | L | medium |
| next | Batch-review and dedup the community skill/agent PR backlog | ecc-core | M | low |
| later | Free runtime guard hook with Pro centralized telemetry + trust registry | agentshield | XL | flagship |
| later | Cross-machine team airspace + A2A topology security in the control pane | ecc-pro | XL | high |
| later | Community MCP/skill reputation registry as growth flywheel + Pro risk-score API | agentshield | L | medium |

## NOW

### Fix the false-positive cluster that punishes correct hardening

- **Area:** agentshield | **Effort:** S | **Impact:** high
- **Linked:** PR #103, issue #102, issue #100
- **MRR angle:** FPs that penalize the scanner's own remediation destroy trust with security-conscious buyers and break the demo-and-CI value prop Pro is sold on. Trust is the conversion gate: a hardened config must score well or no one upgrades.

Merge PR #103 (treats --no-verify inside permissions.deny/ask as a prohibition, not a usage — fail-closed on invalid JSON, 6 tests, all review bots green) after confirming the Verify/test matrix passes locally. Then ship a follow-up PR for the two remaining FPs in issue #100: (1) --no-verify in string literals / help text flagged CRITICAL (needs executed-command vs literal context), and (2) the reversed-text rule at src/rules/agents.ts:1561 matching plain English 'backward/backwards' — re-scope it to require reverse-and-execute evidence so it stops noise-flooding ML/PyTorch agent repos (a high-value adopter segment).

### Add autofix verification loop (re-scan + no-regression proof)

- **Area:** agentshield | **Effort:** M | **Impact:** medium
- **Linked:** issue #102
- **MRR angle:** Verified, trustworthy autofix is the activation moment that makes the free CLI feel magical and seeds confidence in the paid managed-remediation workflow (autofix-as-PR in ECC Tools).

src/fixer/index.ts applies string transforms but never re-scans to prove the finding is gone and no new finding was introduced — and issue #102 proved a naive permission tighten can be re-flagged by the scanner. Close the loop: after applying --fix, re-run the scanner, diff the findings set, auto-revert if the score regresses, and emit a verified-fix attestation. OSS gets verify-after-fix locally; Pro gets autofix-as-PR via the ecc-tools GitHub App (open remediation PR, run verified re-scan in CI, attach before/after evidence pack, auto-merge on green).

### Render the 3D agent-airspace observability dashboard (the moat made visible)

- **Area:** ecc-pro | **Effort:** M | **Impact:** flagship
- **Linked:** PR #2320
- **MRR angle:** This is the single most ownable, demo-able paid-looking surface ECC has and nothing else offers it. 'Watch N agents crawl toward each other in code-space and one steer away' converts on the demo alone — it justifies a Team/Enterprise seat that competitors (CodeRabbit/Greptile) cannot match.

The agent-proximity math (noisy-OR collision risk, TCAS transmit/steer advisories, 3D space-filling embedding) is fully implemented in scripts/lib/agent-proximity/ and computed every tick, but the control-pane UI (ui.js) renders ZERO proximity output. Merge maintainer PR #2320 (self-contained, dependency-free 3D canvas viz + /api/proximity feed, XSS-safe textContent, +254/-0 with tests, MERGEABLE) to ship the renderer. This closes the biggest gap between the moat narrative and a shippable surface.

### Add a Pro conversion CTA to free CLI output and GitHub App PR comments

- **Area:** both | **Effort:** S | **Impact:** high
- **Linked:** PR #97
- **MRR angle:** Directly monetizes the ~30K downloads/month (78,108 YTD, ~7,228/week, no decay) free funnel. There is currently no surfaced upgrade path from the free scanner to ECC Pro — adding a contextual CTA at the point of value is the lowest-effort, highest-leverage conversion lever available.

Surface a Pro CTA where free users already feel value: a footer in terminal/JSON/markdown reports ('hosted fleet posture + continuous monitoring at ecc-tools Pro'), in the GitHub Action job summary, and in PR check-run comments. Lead with the privacy wedge ('scans never leave your machine' vs Snyk Agent Scan transmitting tool metadata to cloud) and the low-noise/runtimeConfidence accuracy story as the differentiators. Keep AgentShield free + zero-account as the moat against token-gated Snyk Agent Scan.

### Ship merge-ready correctness and Windows fixes that protect release velocity and core UX

- **Area:** ecc-core | **Effort:** S | **Impact:** medium
- **Linked:** PR #2133, PR #2307, PR #2063, PR #2273, PR #2246, PR #2312, PR #2293, issue #2316
- **MRR angle:** Broken model IDs hard-fail the multi-model LLM layer Pro features depend on; broken plan-orchestrate install detection and Windows crashes degrade the paid UX and erode trust before users ever reach the upgrade prompt.

Merge the clean, verified batch: PR #2133 (Claude provider model-ID + adaptive-thinking fix — replaces invalid IDs with claude-sonnet-4-6/haiku-4-5/opus-4-8, routes SYSTEM to top-level, omits temperature, adaptive thinking for Opus 4.7/4.8; previous default would 404/400 at the API), PR #2307 + #2063 (Windows test/UTF-8 fixes), PR #2273/#2246/#2312 (docs/workflow), PR #2293 (dependabot minor/patch). Schedule a fix for issue #2316 (plan-orchestrate still probes old paths after the ecc@ecc marketplace rename — broken install detection on a core workflow command).

### Harden continuous-learning storage (path traversal + registry race)

- **Area:** ecc-core | **Effort:** S | **Impact:** medium
- **Linked:** issue #2297, issue #2294, issue #2300, issue #2296
- **MRR angle:** ECC sells security tooling; a path-traversal or registry-corruption bug in our own learning layer is a credibility liability that undercuts the entire security brand the Pro tier trades on.

Fix two security-priority bugs in skills/continuous-learning-v2/scripts/instinct-cli.py as one hardening pass: issue #2297 (shutil.rmtree on PROJECTS_DIR/project_id with no path-containment check — arbitrary directory deletion risk) and issue #2294 (_write_registry writes projects.json without the advisory lock _update_registry uses — concurrent sessions can corrupt the registry). Pair with reliability issues #2300 (SIGALRM drops observations) and #2296 (signal-counter race) for observer integrity.

## NEXT

### Hosted continuous-scanning dashboard with fleet trend lines ('Sentry for agent security')

- **Area:** agentshield | **Effort:** L | **Impact:** flagship
- **MRR angle:** THE core ECC Tools Pro product and the clearest recurring-revenue moat: nobody unifies config-scan + runtime telemetry. Billed per seat/repo. Reuses operatorReadback/reviewItems as the API contract — lowest-effort-to-highest-leverage Pro upgrade because the data model already exists.

Productize the existing local primitives into a hosted, authenticated, multi-repo backend: ingest webhook/CI scan results, runtime.ndjson, and watch/drift events over time; persist baselines; chart score trend, drift history, blocked-command rate, injection-attempt rate, secret-exposure events, and cross-repo org rollup; fire Slack/email regression alerts. The continuous/fleet primitives (src/watch, src/baseline, src/evidence-pack fleet operatorReadback) exist only as local CLI today. Positions AgentShield as the unified config+runtime view that neither Snyk (scan-only) nor Sentry (no security semantics) offers.

### Inline PR-comment review + autofix-PR via the ecc-tools GitHub App

- **Area:** agentshield | **Effort:** M | **Impact:** high
- **Linked:** PR #2320
- **MRR angle:** Sticky inline PR comments + one-click fix PRs are now table stakes (Aikido, DryRun, Pixee) and are the GitHub-native paid surface that converts. The GitHub App already exists as the delivery vehicle; monetize PR-time review + autofix-PR as the paid tier.

Today the GitHub Action fails CI and emits SARIF (lands in the Security tab) but does not post sticky inline PR comments keyed to changed lines, and autofix is local-CLI only. Add per-line PR comments with one-click 'apply fix' that commits the existing remediation to the PR branch, plus auto-fix-PR generation. Differentiate from CodeRabbit/Greptile by bundling the agent-proximity / merge-conflict-prevention angle competitors lack.

### External rule-pack loader (--rule-pack) + curated commercial intel feed

- **Area:** agentshield | **Effort:** M | **Impact:** high
- **Linked:** issue #101
- **MRR angle:** Turns AgentShield into a platform: OSS gets the loader, Pro gets a signed, continuously-updated commercial rule-pack/threat-intel subscription. The ATR pack (464 rules, in production at Cisco AI Defense + Microsoft) brings credibility and reach; its corpus feeds the accuracy gate.

Build the loader requested in agentshield issue #101: a signed, versioned external rule-pack format with zod validation mirroring the --policy loader, no new deps, provenance/safety checks on the packs themselves. Maps cleanly onto the existing declarative rule tables and runRules loop. Resolve the one open design question (ScoreBreakdown's five fixed buckets — external findings count toward total without an own bucket is acceptable for v1). Couples with a hosted, curated AI-tooling malicious-package/skill + CVE intel feed as the paid subscription layer (the static 21-entry CVE DB goes stale; sync to NVD/GHSA/OSV).

### Pro Deep Scan: LLM-judge semantic detection + live MCP tool fetch + rug-pull pinning

- **Area:** agentshield | **Effort:** L | **Impact:** high
- **MRR angle:** Directly neutralizes the most dangerous competitor (Snyk Agent Scan) and AgentGuard. Metered/Pro feature where the platform fronts the model cost and runs deeper scheduled adversarial sweeps. Keeps free AgentShield as the no-account default vs Snyk's token-gated CLI.

Reuse the existing --opus (Red/Blue/Auditor) and --injection (live LLM adversarial, ~70 payloads) plumbing to ship an opt-in LLM-judge layer for semantic prompt-injection and toxic-flow chaining. Add a live MCP connector that fetches tool descriptions and pins tool hashes to flag rug-pulls between scans (capabilities Snyk has and AgentShield lacks). Close the acknowledged skill-md / freeform-prompt coverage gap as a free differentiator (now table stakes vs NVIDIA SkillSpector), reserving AST taint + curated YARA/IOC feed for Pro.

### Compliance/evidence packs mapped to SOC2/PCI/ISO controls

- **Area:** agentshield | **Effort:** M | **Impact:** high
- **MRR angle:** High-margin enterprise add-on: auditor-ready packs are the artifact GRC teams hand to auditors to justify agent deployments. Buyers want framework-mapped evidence, not raw findings — this is a clear Enterprise seat upsell.

AgentShield already generates deterministic hash-verified evidence packs and SARIF, plus baseline/drift and org-policy pass/fail. Add explicit framework mapping (findings -> SOC2 CC / PCI DSS / ISO control IDs), coverage and remediation-over-time charts fed by baseline history and runtime.ndjson, and hosted storage/retention/signing. Sell as the compliance deliverable for regulated buyers.

### Centrally-managed org policy + RBAC distribution

- **Area:** agentshield | **Effort:** L | **Impact:** high
- **MRR angle:** Per-seat Enterprise value: hosted policy distribution, enforcement across the fleet, and waiver/exception workflows with expiry and owner approval are exactly what org buyers pay seats for. Today policy packs are local JSON copied around with no central management.

Policy packs (6 presets), export/promote with SHA-256-verified promotion, and exception lifecycle already exist as local JSON. Add hosted policy distribution, fleet-wide enforcement, centrally-managed exceptions/waivers (expiry + owner approval), org identity/RBAC, audit-log retention, and central branch-protection evidence. Add a DryRun-style natural-language-to-policy authoring layer ('no MCP server may bind 0.0.0.0', 'skills must not read keychain') that compiles to AgentShield rules — a differentiated UX developers are gravitating to.

### Harness-neutral expansion: Kimi, Codex alias, OpenClaude/Codex compat

- **Area:** ecc-core | **Effort:** L | **Impact:** medium
- **Linked:** PR #2154, PR #2254, issue #2076, issue #2073, issue #2074
- **MRR angle:** Broadens the addressable user base for the whole funnel and aligns with the ECC 2.0 harness-neutral control-pane vision — more harnesses scanned = more top-of-funnel feeding Pro.

Land the harness-neutral work after the required catalog/registry sync, install-profile review, and surface tests: PR #2154 (Kimi Code CLI, 12th harness, +1397/16 files), PR #2254 (Codex plugin alias — currently DRAFT + CONFLICTING, resolve first), and answer the needs-info compat issues #2076 (OpenClaude), #2073 (Codex subagent TOML format), #2074 (OpenCode bun-on-PATH Windows bug). AgentShield's harness adapters already detect Claude Code/OpenCode/Codex/Gemini/Zed/VS Code/dmux.

### Batch-review and dedup the community skill/agent PR backlog

- **Area:** ecc-core | **Effort:** M | **Impact:** low
- **Linked:** issue #2308, PR #2309, PR #2310, PR #2311, PR #2285, PR #2275, PR #2274, PR #2270, PR #2318, PR #2315, PR #2313, PR #2137, issue #2069
- **MRR angle:** Indirect: keeps the catalog credible and discoverable (catalog quality is a free-tier retention factor) without bloating it with redundant skills that dilute the value prop.

Triage as batches with overlap/dedup review against the existing 200+ skill catalog plus manifest/catalog/command-registry sync and surface tests: the three BMAD-inspired skills (#2309/#2310/#2311 under tracking issue #2308), framework-reviewer family extensions (#2285 nuxt, #2275 React Native, #2280 AL/BC), and assorted new-skill PRs (#2319 ecc-recipes, #2314 quant-trading, #2281 council-multi-model, #2277 living-docs, #2288 mailtrap — needs cred-handling security review). Resolve needs-work conflicting/large PRs (#2274 gateguard rebase, #2270 OMP split, #2318/#2315 large drops). Close low-signal drive-bys: PR #2313 (empty template), PR #2137 (vague AI-slop SOP), agentshield #99 (spam). Route marketing reshare #2069 to content (ECC was 'featured', not a winner).

## LATER

### Free runtime guard hook with Pro centralized telemetry + trust registry

- **Area:** agentshield | **Effort:** XL | **Impact:** flagship
- **MRR angle:** Closes the biggest competitive gap (GoPlus AgentGuard runtime blocking, Snyk-Evo fleet monitoring) and is a pure hosted play billed per active agent/seat. Free static deny-list neutralizes AgentGuard's differentiator; Pro baselining + telemetry + managed trust registry is the recurring upsell.

Today the runtime monitor (src/runtime) is a thin deny-list + rate-limit PreToolUse evaluator logging to local NDJSON. Build a streaming evaluator with per-agent/per-repo behavioral baselining and intent-drift scoring (OTel GenAI spans), soft-warn/hard-block inline, and extend taint tracking from single-file static to cross-tool-call / cross-session data-flow lineage (the indirect-injection -> exfiltration chain that dominates 2026 incidents). Add credential-flow tracing (which hook/MCP reads each secret, does it egress). Pro centralizes runtime telemetry ingestion, fleet-wide deny-policy distribution, tamper-evident logging, a managed trust registry, and real-time alerting. This is 'AgentShield Runtime' — agent EDR, not a config linter.

### Cross-machine team airspace + A2A topology security in the control pane

- **Area:** ecc-pro | **Effort:** XL | **Impact:** high
- **MRR angle:** The clearest Team/Enterprise seat wedge: 'N agents, M humans, zero merge conflicts over Tailscale' is exactly what justifies per-seat team pricing. A2A privilege-escalation visualization is the security-native sibling of the Layer 4 moat, sold alongside the control pane.

Proximity only sees local sessions in one repo today (roadmap v2 cross-machine is unbuilt). Build hosted, authenticated multi-repo/multi-machine airspace (sessions, kanban, proximity, risk ledger) gated behind Team/Enterprise, with the TCAS transmit/steer protocol + agent+human JIT deconfliction as the per-seat value. Add agent-to-agent (A2A) topology security: model the org's multi-agent delegation graph (which agent invokes/delegates to which, with what inherited tools) and highlight confused-deputy / delegation-of-overprivilege paths. Promote the local memory-recall Knowledge panel into a synced team knowledge/RAG store as a Pro add-on.

### Community MCP/skill reputation registry as growth flywheel + Pro risk-score API

- **Area:** agentshield | **Effort:** L | **Impact:** medium
- **MRR angle:** Doubles as marketing and as the data backbone for a paid risk-score API. Counters Prompt Security's 13,000-server scored registry moat; the crowd + ECC-ecosystem scan-result data flywheel is hard for competitors to replicate.

Build a free community MCP/skill reputation registry aggregating crowd input + AgentShield scan results across the ECC ecosystem, with MCP provenance attestation (SLSA/in-toto/Sigstore-style signed agentshield.lock pinning the full MCP+skill+plugin dependency closure). Sell continuous monitoring, org allow/block policy, Shadow-MCP discovery, and a hosted multi-ecosystem (npm+PyPI+cargo) provenance/SBOM service as Pro. Optional niche add-on: pickle/safetensors/GGUF model-artifact deserialization scanner for local-OSS-model teams.

## Capability baseline (what we have, where the gaps are)

### AgentShield today

AgentShield today is a mature STATIC security scanner for AI-agent configurations (Claude Code and adjacent harnesses), shipping 102 pattern-based rules across secrets, permissions, hooks, MCP, and agents, hardened by a source-confidence/false-positive engine (runtimeConfidence tiers + score weighting). Beyond static rules it layers: MCP tool-poisoning + CVE detection backed by a 21-entry curated threat-intel DB, supply-chain provenance verification (offline + optional npm-online + package-manager hardening), opt-in static taint analysis, opt-in LLM-driven active prompt-injection testing (~70 payloads / 12 categories), opt-in hook sandbox execution with canary secrets, and an Opus 4.6 three-agent adversarial pipeline. Operational surfaces include org policy packs with verified export/promote + exception lifecycle, an installable runtime PreToolUse deny-list monitor, deterministic hash-verified evidence packs with fleet operatorReadback, baseline drift gating, a local watch/alert mode, harness adapters, and full CI integration (GitHub Action, SARIF, corpus self-test). The honest gaps are that detection is overwhelmingly static/signature-based (narrow non-shell hook-code coverage, weak skill-md prompt coverage, no live CVE feed, no real AST taint), and that all the continuous/fleet/hosted primitives (watch, evidence-pack fleet, policy distribution, runtime telemetry, deep LLM analysis) exist only as LOCAL CLI building blocks. That gap is precisely the Pro/Enterprise opportunity: the data models for continuous monitoring, fleet dashboards, hosted scanning, centrally-managed org policy, live threat-intel, and compliance evidence retention are already designed locally and would convert directly into a hosted ECC Tools Pro offering (README already references a $19/seat/mo tier and the ecc-tools GitHub App). Key files: src/rules/*, src/{taint,injection,sandbox,supply-chain,threat-intel,runtime,policy,evidence-pack,watch,baseline,harness-adapters,opus}/, README.md, false-positive-audit.md.

Key gaps the roadmap targets:

- STATIC-ONLY for most detection: rules are regex/pattern-based over config text. Polymorphic/obfuscated payloads, novel encodings, and logic-level malice that doesn't match a signature are missed. Deep behavioral detection requires opt-in --opus/--injection/--sandbox (LLM cost or local execution).
- NON-SHELL HOOK CODE coverage is narrow: hook-code findings only catch explicit signals (output() context injection, transcript access, child-process curl|bash). Broad language-aware analysis of JS/Python/etc hook implementations is not done — README explicitly flags this as a known high-signal caveat.
- skill-md / freeform prompt text bypasses most agent + injection rules (explicitly acknowledged). Skill prompt bodies have much weaker coverage than CLAUDE.md/agent-md.
- CVE database is a hand-curated static list of 21 entries with no live feed — goes stale; no automated sync to NVD/GHSA/OSV. No CVSS scoring, no version-range resolution beyond string matching.
- Supply-chain online check only hits npm registry; no PyPI/cargo/RubyGems online verification, no SBOM generation/consumption, no transitive-dependency graph or lockfile-tree integrity verification (only top-level provenance counts).
- Watch mode is local single-process fs.watch only (no daemon/service, no persistence across restarts, single targetPath baseline). Webhook alerting exists but there is no hosted ingestion, dashboard, or multi-repo fleet view that actually runs continuously.
- No hosted/SaaS scanning backend. Everything runs locally or in the user's CI. GitHub App (ecc-tools) is referenced but the scanner core is fully local/offline.
- No semantic/data-flow analysis across files for MCP tool chaining or multi-agent privilege escalation beyond single-config heuristics; taint analysis is regex source/sink, not real AST/CFG.
- No detection of malicious model behavior at inference time (only config-time + optional sandbox/injection test). No live transcript/telemetry monitoring of a running agent fleet.
- Runtime monitor is a thin deny-list evaluator (glob+regex) installed as one hook; no kernel/syscall-level sandboxing, no egress filtering enforcement, no tamper protection on the hook itself.

### ECC Pro surface today

ECC's paid story today is two separate hosted GitHub Apps (ECC Pro at $19/seat/mo for private repos, and ECC Tools with free/pro/enterprise Marketplace tiers + real billing infra), while the entire local plugin including the control pane stays MIT-free with no license gating. The control pane (loopback-only Node server) surfaces Sessions, an interactive kanban with agent+human JIT assignment, local Knowledge recall, MCP connectors, and executable actions. The genuinely differentiated 'moat' — the agent-airspace proximity metric (noisy-OR collision risk, TCAS transmit/steer advisories, 3D embedding) — is fully implemented in code and wired into the snapshot, BUT the 3D 'where-are-the-agents' visualization is never rendered (zero proximity output in the UI), and none of these capabilities are positioned or gated as Pro/Enterprise. The paid value story is thin: Pro currently reads as 'OSS for private repos + PR audits' (commodity vs CodeRabbit/Greptile), while the truly ownable surfaces — 3D agent observability, multi-agent/human JIT deconfliction, cross-machine team airspace, shared team knowledge — are either unrendered, unbuilt, or unmonetized. Also verify live GitHub Marketplace Pro billing-state provenance before claiming native payments are GA. Key files: scripts/lib/control-pane/{server,state,ui,proximity,message-sink,work-item-mutations}.js, scripts/lib/agent-proximity/{distance,graph,index}.js, docs/design/agent-proximity.md, docs/ECC-2.0-REFERENCE-ARCHITECTURE.md, docs/ECC-2.0-GA-ROADMAP.md, README.md:53-83 and :216.

Pro leverage points identified:

- 3D agent-airspace observability dashboard — render the already-computed scanAirspace positions/links/advisories (WebGL/Three.js in the control-pane UI). 'Watch N agents crawl toward each other in code-space and watch one steer away' is a unique, demo-able Pro/Team feature nothing else has. The math is done; only the renderer is missing.
- Multi-agent / multi-human JIT deconfliction as a TEAM seat product — the TCAS transmit/steer protocol + agent+human kanban JIT assignment is the natural per-seat value. Gate the cross-machine airspace (Tailscale, roadmap v2) behind Team/Enterprise.
- Hosted control pane / observability backend — today it is loopback-only local. A hosted, authenticated, multi-repo version (sessions, kanban, proximity, risk ledger, HUD/status JSON contract from the reference arch) is the obvious Pro SaaS surface.
- Shared team knowledge layer — promote the local memory-recall Knowledge panel into a synced team knowledge/RAG store (the reference arch already wants RAG over vetted patterns / PR outcomes / CI failures) as a Pro/Enterprise add-on.
- AgentShield Enterprise security platform — policy packs (OSS/team/enterprise/regulated), SARIF, supply-chain intel, exec HTML/PDF reports, CI enforcement (reference arch lines 152-173). This is already framed as the enterprise security tier and pairs with the proximity/observability story.
- ECC Tools deep analyzer + Linear sync as the GitHub-native paid PR layer (already the current paid surface); differentiate it from CodeRabbit/Greptile by bundling the agent-proximity/merge-conflict-prevention angle that competitors lack.

## Research inputs

### competitor-gap-analysis

AgentShield (npm "ecc-agentshield") occupies a defensible niche: a free, OSS, zero-account static auditor for AI-agent configuration surfaces (Claude Code .claude/ dirs, hooks, MCP configs, permissions, agent/skill markdown, secrets) shipped as CLI + GitHub Action + GitHub App, with 102 rules across 5 categories, runtimeConfidence source-weighting, supply-chain provenance, evidence packs/SARIF, and an Opus red/blue/auditor pipeline. npm growth is real: 78,108 downloads YTD 2026 (Jan 1-Jun 21), ~29,759 last 30 days, ~7,228 last week, daily 700-2,300. The field splits into two tiers. (1) Direct OSS config/skill scanners: Snyk agent-scan (ex-Invariant mcp-scan, the single most dangerous competitor), NVIDIA SkillSpector (AST taint + YARA), GoPlus AgentGuard (runtime action eval + trust registry, local-only), Mondoo Skill Check, Semgrep Guardian. (2) Enterprise runtime/firewall + model-supply-chain: Lakera Guard (Check Point), Prompt Security (SentinelOne), HiddenLayer, Protect AI Guardian (Palo Alto/Prisma AIRS), Noma, plus Cloudflare/Microsoft Defender MCP gateways; GitGuardian ships native Claude Code/Cursor/Copilot secret hooks. AgentShield's biggest gaps: no runtime/inline enforcement (purely static), no LLM-judge semantic prompt-injection/toxic-flow analysis, no live MCP tool-description fetch or rug-pull tool-pinning, no ML model-artifact scanning, no central fleet dashboard, no policy-as-code gateway. Biggest moats: free + zero-account + OSS (Snyk agent-scan needs a SNYK_TOKEN; enterprise tier is all paid/acquired), deep Claude Code config specificity, source-confidence false-positive weighting, and ECC distribution. Clear ECC Pro wedges: hosted fleet dashboard, LLM-judge deep-scan, live MCP runtime proxy + rug-pull detection, policy-as-code CI gates, model-artifact scanning, and a curated AI-tooling malicious-package/skill intel feed.</summary>
</invoke>

Notable gaps vs us (missing today):

- **GoPlus AgentGuard — local-only runtime action enforcement + trust registry (the runtime gap)** — Ship a free lightweight PreToolUse hook-based runtime guard (AgentShield already understands Claude Code hook wiring deeply — natural extension via agentshield init), reserving the managed trust registry, org-wide allow/block policy sync, and runtime telemetry/alerting for ECC Pro. Neutralizes AgentGuard's differentiator while keeping the upsell.
- **Lakera Guard (Check Point) — runtime prompt-injection firewall** — Enterprise inline-firewall is capital-intensive and now owned by Check Point/SentinelOne, so not a near-term build. Realistic ECC Pro angle: a hosted /guard-style endpoint reusing AgentShield's injection rule corpus for lightweight dev/CI gating of agent prompts and tool descriptions — developer-first and cheaper, not an enterprise WAF.
- **Prompt Security (SentinelOne) — MCP Gateway + dynamic risk scoring of 13,000+ public MCP servers** — Build a free community MCP/skill reputation registry (crowd + AgentShield scan results across the ECC ecosystem) as a growth/data-flywheel asset, then sell continuous monitoring + org allow/block policy + Shadow-MCP discovery as Pro. The registry doubles as marketing and as the data backbone for a Pro risk-score API.
- **HiddenLayer + Protect AI Guardian (Palo Alto/Prisma AIRS) — ML model-artifact supply-chain scanning** — Pro add-on: pickle/safetensors/GGUF deserialization scanner for agents that load local model artifacts, plus a Hugging Face model-reference checker in agent configs. Niche but a clean upsell for local-OSS-model teams; integrate a free OSS pickle-scan core (picklescan-style) with a Pro signature/IOC feed.
- **Cloudflare / Microsoft Defender — MCP gateways and managed enforcement infrastructure** — Stay complementary: position AgentShield/ECC Pro as the developer-side pre-flight + CI gate that feeds findings into these gateways (SARIF/JSON export already exists). A Pro integration that exports AgentShield posture to Cloudflare/Defender policy or emits Shadow-MCP candidate lists is a partnership-friendly upsell rather than a competitive build.

### unbuilt-ideation

AgentShield already ships an unusually broad static surface: 102+ rules across secrets/permissions/hooks/MCP/agents, MCP CVE + tool-poisoning detection, supply-chain provenance, taint analysis, sandbox hook execution, injection testing, watch/drift mode, a PreToolUse runtime monitor, org policy-as-code, evidence packs, baseline gates, SARIF/HTML, and the ECC Tools GitHub App + Pro tier. So the real unbuilt ideation is NOT "add another scanner category" — it is moving from static config audit toward live runtime defense, cross-call/cross-session reasoning, and a hosted continuous-assurance product. The biggest concrete gaps, grounded in the shipped code and the 2026 threat landscape: (1) the "runtime monitor" is only a static deny-rule + rate-limit PreToolUse evaluator — there is no behavioral baselining, intent-drift detection, or live taint propagation across actual tool calls; (2) taint tracking is single-file static only, not cross-tool-call / cross-session data-flow; (3) autofix has no verification loop (applies string transforms, never re-scans to prove the finding is gone and nothing new was introduced); (4) zero coverage of non-human/agent identity, least-privilege token scoping, or OAuth/credential-flow tracing (the fastest-growing 2026 risk per CSA/OWASP NHI work); (5) no MCP provenance attestation / signed lockfile (supply-chain is detection + npm metadata, not cryptographic attestation); (6) no A2A / multi-agent / agent-to-agent protocol coverage; (7) no hosted continuous-scanning dashboard with fleet trend lines (evidence-pack fleet exists as CLI, but no SaaS); (8) community rule-pack loader is requested (issue #101) but unbuilt. Each maps cleanly to ECC Pro / ECC Tools monetization because they require hosting, threat-intel feeds, or org-fleet state that an OSS CLI can't carry.

Notable gaps vs us (missing today):

- **Autofix with verification loop (re-scan + no-regression proof)** — OSS gets verify-after-fix locally. Pro gets autofix-as-PR via ECC Tools GitHub App: open a remediation PR, run the verified re-scan in CI, attach the before/after evidence pack, and auto-merge on green — a paid managed-remediation workflow.
- **Agent identity, least-privilege, and non-human-identity (NHI) governance** — Enterprise policy-pack feature: ship least-privilege scoring + token-rotation/age gates as a 'regulated/enterprise' Pro policy pack, and a hosted NHI inventory across the org's repos in ECC Tools (fleet-level identity sprawl map).
- **Agent-to-agent (A2A) and multi-agent topology security** — Premium control-pane integration: render the org's multi-agent delegation graph with privilege-escalation paths highlighted, sold alongside ECC 2.0 control pane / Layer 4 proximity as a paid org-fleet visualization.
- **Community/external rule-pack loader (--rule-pack)** — OSS gets the loader + local packs. Pro gets a curated, signed, continuously-updated commercial rule-pack feed (the CVE/known-malicious-MCP intel from the supply-chain item), turning detections into a subscription.

### devtool-demand-gaps

Across SAST/SCA tools (Snyk, CodeQL, Semgrep, SonarQube, Dependabot) the dominant 2026 developer complaint is not detection but triage: alert fatigue, false positives, and low-value PRs. A Go maintainer publicly called Dependabot a "noise machine"; teams report spending more time triaging Snyk SCA alerts than fixing issues; CodeQL FP-heavy unit-test flags and a postback-on-dismiss UX push developers to ignore alerts entirely. The clear demand is for low-noise, context-aware, PR-time findings with autofix and SARIF/compliance output. For AI-agent codebases specifically, two new direct competitors emerged: Snyk Agent Scan (Open Preview, May 2026 — CLI + background MDM/CrowdStrike mode, cloud-backed, sends tool metadata off-machine) and DryRun Security (contextual NL code policies in PRs, feeds Claude/Cursor/Codex). AgentShield already ships much of what the market asks for in agent-config security: 102 rules, SARIF, GitHub Action, autofix (--fix/remediation), evidence packs, supply-chain checks, runtimeConfidence FP weighting, a local runtime hook-enforcement layer (runtime.ndjson) and a watch/drift detector. The biggest unmet, monetizable gaps are: (1) a hosted Sentry-style aggregated dashboard + agent runtime telemetry (error/tool-failure/cost/drift across many repos and machines) — nobody unifies config-scan + runtime observability; (2) true inline PR-comment review (AgentShield's Action fails CI and emits SARIF but does not post sticky inline comments like DryRun/Aikido); (3) IDE/editor integration (Cursor/Windsurf/VS Code/Claude Code) so findings and fixes land where agents code; (4) natural-language custom org policies (DryRun-style) beyond the current JSON policy presets; (5) compliance/evidence packs mapped to SOC2/PCI frameworks as a paid Pro deliverable. AgentShield's local-first, no-data-leaves-machine posture is a concrete differentiator against Snyk Agent Scan's cloud metadata transmission and a privacy selling point for regulated buyers.

Notable gaps vs us (missing today):

- **IDE/editor integration — findings and fixes where agents actually write code** — Ship a VS Code/Cursor extension (and a Claude Code skill already exists via ecc:security-scan) that lints agent configs on save, shows findings inline, and offers fixes — gated behind Pro for org policy sync. Builds on existing harness-adapters; meets developers in the editor where Snyk Agent Scan (CLI/MDM) does not.

> Note: a fourth research thread (recent agentic/MCP CVEs) was blocked by an automated
> usage-policy classifier on the raw "find vulnerabilities" prompt. The CVE-database refresh
> need it would have covered is captured under the rule-pack + intel-feed item, and will be
> handled as a scoped, defensive OSV/GHSA/NVD sync rather than free-form vulnerability research.

## Appendix: open PR / issue triage

### affaan-m/ECC

| Disposition | Ref | Title |
| --- | --- | --- |
| merge | PR #2320 | feat(control-pane): 3D agent-airspace viz + /api/proximity feed (Layer 4 observability) |
| merge | PR #2133 | fix(llm): align Claude provider with current Anthropic API |
| needs-work | PR #2274 | fix(gateguard): make fact-force checklist tool-agnostic |
| merge | PR #2307 | fix(tests): resolve 10 failing tests on Windows |
| merge | PR #2293 | chore(deps): bump npm-minor-and-patch group (5 updates) |
| needs-work | PR #2260 | chore(deps-dev): bump eslint 9.39.2 to 10.5.0 |
| triage-later | PR #2319 | feat: add ecc-recipes skill |
| needs-work | PR #2318 | feat: add OpenSpec ecosystem (5 agents, 2 orchestration skills, 3 integrations) |
| needs-work | PR #2315 | feat(skills): add 10 custom local skills |
| triage-later | PR #2314 | feat(skills): add quant-trading-systems skill |
| close | PR #2313 | Add Pylint workflow for Python code analysis |
| merge | PR #2312 | fix(opencode): sync plugin metadata counts |
| triage-later | PR #2311 | feat(skills): add story-lifecycle skill |
| triage-later | PR #2310 | feat(skills): add project-context skill |
| triage-later | PR #2309 | feat(skills): add dev-team skill (multi-persona session) |
| needs-work | PR #2287 | refactor: migrate .kiro.hook files to JSON v1 format |
| triage-later | PR #2285 | feat(agents): add nuxt-reviewer and /nuxt-review surface |
| triage-later | PR #2281 | feat: add council-multi-model skill (heterogeneous Codex review) |
| triage-later | PR #2280 | feat: add AL/Business Central language pack |
| triage-later | PR #2277 | Add living-docs-governance skill |
| triage-later | PR #2275 | feat(rules,skills): React Native / Expo rules pack + react-native-patterns skill |
| merge | PR #2273 | docs(code-tour): document the ref field |
| needs-work | PR #2270 | fix(omp): harden harness contract |
| needs-work | PR #2264 | Harden release automation 6097857685862934372 |
| needs-work | PR #2254 | [codex] add everything codex plugin alias |
| merge | PR #2246 | docs(commands): generate discoverable <name>/SKILL.md skills not inert flat files |
| needs-work | PR #2154 | feat: add Kimi Code CLI support |
| close | PR #2137 | feat: add ULTRA CODE self-evolving operator SOP |
| needs-work | PR #2136 | Add opt-in AURA trust-check adapter (integrations/aura) |
| merge | PR #2063 | fix(instinct-cli): pin file reads and stdout to UTF-8 on Windows |
| merge | issue #2316 | plan-orchestrate: stale ECC install detection after marketplace rename to ecc@ecc |
| triage-later | issue #2308 | feat: add dev-team, project-context, story-lifecycle community skills |
| merge | issue #2306 | docs: Scope Decision Guide table duplicated in SKILL.md and observer.md with drift |
| merge | issue #2305 | chore: unused 'from unittest import mock' in test\_parse\_instinct.py |
| triage-later | issue #2304 | chore: three naming conventions coexist in continuous-learning-v2 shell scripts |
| triage-later | issue #2303 | chore: inconsistent shebangs across continuous-learning-v2 shell scripts |
| merge | issue #2302 | test: add coverage for cmd\_prune, projects delete/gc/merge, \_promote\_specific dry-run,  |
| merge | issue #2301 | bug: migrate-homunculus.sh pgrep pattern treats $HOME as regex |
| merge | issue #2300 | bug: SIGALRM handler silently drops in-flight observations in observe.sh |
| merge | issue #2299 | bug: Python \_update\_registry omits 'id' field present in shell counterpart |
| merge | issue #2298 | bug: observer.md says 'each instance >= 0.8' but code uses average confidence |
| security-priority | issue #2297 | bug: \_remove\_project\_storage lacks path containment check |
| needs-work | issue #2296 | bug: signal counter race condition in observe.sh throttle logic |
| merge | issue #2295 | fix: replace hardcoded sleep 2 with PID file poll in start-observer.sh |
| security-priority | issue #2294 | fix: \_write\_registry missing file lock (race with \_update\_registry) |
| merge | issue #2293-dup | (see PR #2293) |
| triage-later | issue #2283 | OpenSpec Ecosystem: spec-miner lifecycle extension (5 agents + 3 integrations + CI) |
| triage-later | issue #2112 | ctx — potential synergy between ECC and ctx |
| triage-later | issue #2103 | Skill proposal: Before You Build Skill |
| needs-work | issue #2076 | OpenClaude Compatibility |
| needs-work | issue #2074 | Frequent 'bun: command not found' Error in OpenCode TUI (Windows) |
| needs-work | issue #2073 | Do agents/*.md need TOML rewrite for Codex subagent recognition? |
| triage-later | issue #2069 | Featured ECC in a Medium article — request to add to README and reshare |
| triage-later | PR #2288 | feat(skills): add mailtrap-email-integration skill |

Triaged all open PRs (30) and issues (24) on affaan-m/ECC. MERGE-READY (clean, correct, mergeable): PR #2320 (maintainer's Layer 4 control-pane 3D viz — top Pro/MRR value), PR #2133 (Claude provider model-ID + adaptive-thinking fix, verified correct against the authoritative Claude API reference — sonnet-4-6/haiku-4-5/opus-4-8, omit temperature, adaptive thinking for Opus 4.7/4.8), PR #2307 + #2063 (Windows fixes), PR #2273/#2246/#2312 (docs/workflow fixes), PR #2293 (dependabot minor/patch). Plus several quick-win issues in continuous-learning-v2 (#2306, #2305, #2302, #2301, #2299, #2298, #2295, #2300) and #2316 (plan-orchestrate stale install detection). SECURITY-PRIORITY: issue #2297 (path traversal — shutil.rmtree without containment check) and issue #2294 (registry write without file lock → corruption) in skills/continuous-learning-v2/scripts/instinct-cli.py. Both should be fixed as a hardening pass. PR #2136 (AURA external trust integration) needs a security review of its third-party dependency. NEEDS-WORK (rebase/scope/review): PR #2274 (gateguard tool-agnostic fix — correct but CONFLICTING), PR #2270 (OMP — +3151/-454, CONFLICTING, scope creep into release automation; split it), PR #2318/#2315/#2154 (large skill/harness drops needing catalog sync + per-item review), PR #2260 (eslint 9→10 major bump — verify before merge), drafts #2264/#2254, plus needs-info issues #2076/#2074/#2073. CLOSE candidates: PR #2313 (empty template, likely conflicts with existing python review), PR #2137 (vague 'ULTRA CODE self-evolving SOP', CONFLICTING, AI-slop). TRIAGE-LATER: the three BMAD-inspired community skills (#2309/#2310/#2311 under tracking issue #2308) and assorted new-skill PRs (#2319, #2314, #2281, #2280, #2277, #2275, #2288, #2285) — all need overlap/dedup review against the existing 200+ skill catalog and manifest sync. Issue #2069 is a marketing reshare request (route to content; note ECC was 'featured', not a winner). Pro/MRR-relevant cluster: control-pane Layer 4 (#2320), harness-neutral expansion (Kimi #2154, Codex alias #2254, OpenClaude/Codex compat #2076/#2073), multi-model orchestration skills (#2281, #2318), and continuous-learning reliability/security (#2294/#2297/#2300).

### affaan-m/agentshield

| Disposition | Ref | Title |
| --- | --- | --- |
| merge | PR #103 | fix: treat dangerous flags inside permissions.deny/ask rules as prohibitions, not usages |
| merge | issue #102 | False positive: permissions.deny rules blocking --no-verify flagged CRITICAL, zeroing Perm |
| needs-work | issue #100 | False positives: --no-verify in string literals (CRITICAL) and 'backward ...' English flag |
| triage-later | issue #101 | Proposal: external rule-pack loader (--rule-pack) to load community detection rules |
| merge | PR #97 | docs: Add FAQ section for common questions |
| needs-work | PR #96 | chore(deps-dev): bump vitest from 3.2.4 to 4.1.8 |
| close | issue #99 | bm |

7 open items on affaan-m/agentshield: 3 PRs (#103, #97, #96) and 4 issues (#102, #101, #100, #99). The headline is the false-positive cluster (#100, #102, #99-adjacent) where the scanner flags --no-verify inside permissions.deny rules as CRITICAL and zeros the Permissions score — penalizing its own recommended remediation. PR #103 cleanly fixes the structurally-decidable JSON case (#102) with fail-closed logic, 6 new tests, and all review-bot checks green; recommend MERGE as the top trust/conversion win. #100 covers two remaining FPs (--no-verify in string literals + 'backward' English matched as reversed-text in agents.ts:1561) not addressed by #103 — needs-work follow-up. #101 (external --rule-pack loader, ATR integration) is a high-value ecosystem/Pro proposal, well-scoped, recommend triage-later with intent to accept the PR. #97 (README FAQ) is mergeable docs. #96 (vitest 3→4) has a real test failure (renderTerminalAlert assertion under vitest 4) and needs work before merge. #99 ('bm', empty body) is spam — close. Notable caveat: PR #103's checks are only review bots (CodeRabbit/Greptile/GitGuardian); the Verify/test matrix does not appear to have run, so maintainer should confirm the suite passes locally before merge.
