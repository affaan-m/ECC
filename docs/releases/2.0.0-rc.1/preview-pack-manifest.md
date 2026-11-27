# ECC v2.0.0-rc.1 Preview Pack Manifest

This manifest defines the reviewed preview pack for `2.0.0-rc.1`. It is not a
release action by itself. Use it to verify that the public launch surface stays
assembled after the GitHub prerelease and npm `next` publish, and before
tagging plugin surfaces, uploading video, or posting announcements.

## Pack Contents

| Artifact | Role | Gate |
| --- | --- | --- |
| `README.md` | Public onramp and install surface | Links Hermes setup, rc.1 notes, plugin install, manual install, reset, and uninstall guidance |
| `docs/HERMES-SETUP.md` | Public Hermes operator topology | No raw workspace export, credentials, private account names, or local-only operator state |
| `skills/hermes-imports/SKILL.md` | Sanitized Hermes-to-ECC import workflow | Includes import rules, sanitization checklist, conversion pattern, and output contract |
| `docs/architecture/cross-harness.md` | Shared substrate model for Claude Code, Codex, OpenCode, Cursor, Gemini, Hermes, and terminal-only use | Names portability boundaries and does not claim unsupported native parity |
| `docs/architecture/harness-adapter-compliance.md` | Adapter matrix and scorecard | Verified by `npm run harness:adapters -- --check` |
| `docs/architecture/platform-value-loop.md` | Product integration and full-stack platform thesis | Keeps external product skill packs, gated APIs, case studies, sponsorship, Pro, and consulting loops separate from unsupported GA/control-pane claims |
| `docs/architecture/observability-readiness.md` | Local operator-readiness gate | Verified by `npm run observability:ready` |
| `docs/architecture/progress-sync-contract.md` | GitHub, Linear, handoff, roadmap, and work-item sync boundary | Checked by `node scripts/platform-audit.js --json` |
| `scripts/preview-pack-smoke.js` | Deterministic preview-pack smoke gate | Verified by `npm run preview-pack:smoke` |
| `scripts/release-approval-gate.js` | Final owner-decision, live-URL, and launch-copy gate | Must return ready true before any additional release/package action, plugin tag, video upload, announcement, or outbound batch |
| `docs/releases/2.0.0-rc.1/release-notes.md` | GitHub release copy source | Must stay aligned with live GitHub/npm URLs and remaining plugin/video/billing gates before publication |
| `docs/releases/2.0.0-rc.1/quickstart.md` | Clone-to-first-workflow path | Covers clone, install, verify, first skill, and harness switch |
| `docs/releases/2.0.0-rc.1/launch-checklist.md` | Operator launch checklist | Must remain approval-gated for plugin, video, billing, and announcement actions |
| `docs/releases/2.0.0-rc.1/publication-readiness.md` | Release gate | Requires fresh evidence from the exact release commit |
| `docs/releases/2.0.0-rc.1/publication-evidence-2026-05-15.md` | Current May 15 queue, roadmap, security, supply-chain watch, no-lifecycle CI install hardening, AgentShield #86 evidence-pack provenance, ECC Tools billing-gate, Actions cache purge, and `ecc2` test evidence through PR #1941 | Must be superseded by a final clean-checkout evidence file before real publication |
| `docs/releases/2.0.0-rc.1/publication-evidence-2026-05-16.md` | Current May 16/17 queue cleanup, recsys skill merge, GateGuard triage, PR #1947 supply-chain protection, AgentShield #87 plugin-cache confidence evidence, AgentShield #88 evidence-pack inspect/readback, AgentShield #89 evidence-pack fleet routing, AgentShield #90 fleet review items, AgentShield #91 policy export, AgentShield #92 policy promotion, ECC-Tools #76 fleet-summary consumption, ECC-Tools #77 hosted finding evidence paths, ECC-Tools #78 harness policy-route linking, dashboard refresh, and combined Node/Rust/release-surface gate evidence through the May 16 mirror | Must still be repeated from a strict clean checkout before real publication |
| `docs/releases/2.0.0-rc.1/publication-evidence-2026-05-17.md` | May 17 queue-zero state, Japanese localization merge, Dependabot TypeScript and Node type merges, post-merge ja-JP lint repair, Mini Shai-Hulud/TanStack protection recheck, npm audit/signature checks, legacy and Linear progress routing, deterministic preview-pack smoke, operator dashboard refresh, Linear sync, and GitHub CI evidence for `27dc2918` | Superseded by the May 18 evidence snapshot; repeat from a strict clean checkout before real publication |
| `docs/releases/2.0.0-rc.1/publication-evidence-2026-05-18.md` | May 18 queue-zero state, #1970/#1971/#1972 merge batch, #1978 review/closure, supply-chain recheck, AgentShield evidence mirror, Linear sync, current-head CI/security scan success for `4470e2e6`, and ITO-46 naming/plugin publication closure | Superseded by the May 19 ECC identity, video, and growth evidence snapshot |
| `docs/releases/2.0.0-rc.1/publication-evidence-2026-05-19.md` | Current May 19/20 evidence for canonical ECC identity, release video suite, partner/sponsor/talk outreach pack, owner approval packet, release approval gate, May 20 operator dashboard, preview-pack smoke digest `eebb8a66c33e`, 2568-test local suite, PR #1998 visual QA CI success, PR #1999 dashboard evidence CI success, PR #2000 suite-count evidence success, PR #2001 owner approval packet CI success, PR #2002 owner-approval dashboard gate CI success, PR #2004 Linear readiness evidence sync CI success, PR #2008 supply-chain evidence gate CI success, post-PR #2006 main CI success, PR #2009 project-registry hygiene CI success, post-PR #2009 main CI success, post-PR #2011 GateGuard CI success, post-PR #2013 release-approval-gate CI success, PR #2017/#2018 AgentShield evidence sync, ECC-Tools #79 billing-announcement redaction hardening, ECC-Tools #80-#93 runtime-receipt, AgentShield approval-ID, Linear sync, remediation sync, hosted observability event/status/depth-plan/API readback, Marketplace Pro selected-target readback, selected-target announcement gate, env-file billing operator path, non-breaking operator bearer path, live `announcementGateReady: true`, AgentShield #94 Zed/VS Code adapter coverage, AgentShield #95 Dependabot alert closure, JARVIS #15/#16 queue/deploy repair, ECC #2019/#2020 Marketplace Pro gate sync, and the May 19/20 Linear sync comments | Current strongest readiness snapshot; must still be repeated from a strict clean checkout before real publication |
| `docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-17.md` | Previous prompt-to-artifact operator dashboard | Superseded by the May 18 generated dashboard |
| `docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-18.md` | Previous prompt-to-artifact operator dashboard | Superseded by the May 19 generated dashboard |
| `docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-19.md` | Previous prompt-to-artifact operator dashboard | Superseded by the May 20 generated dashboard |
| `docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-20.md` | Current prompt-to-artifact operator dashboard | Shows PR/issue/discussion/platform/supply-chain gates current and adds the current `$1,728/mo` to `$10,000/mo` hypergrowth, video owner-approval, Linear release-gate sync, selected-target billing gate, operator bearer path, live billing gate pass, and outbound-pack operating lanes |
| `docs/releases/2.0.0-rc.1/owner-approval-packet-2026-05-19.md` | Final human decision sheet for release, package, plugin, video, billing, social, and outbound approvals | Must be reviewed by the owner before any publication or outbound action |
| `docs/releases/2.0.0-rc.1/release-url-ledger-2026-05-19.md` | Live URL and approval-gated URL ledger for release copy | Must be regenerated from the final release commit before public announcements |
| `docs/releases/2.0.0-rc.1/video-suite-production.md` | Release video production manifest | Gates local media inventory, rough primary render, captions, timeline, self-eval, and no-private-path publication rules |
| `docs/releases/2.0.0-rc.1/partner-sponsor-talks-pack.md` | Partner, sponsor, consulting, conference, podcast, and discussion copy | Must stay approval-gated and avoid live billing, release, package, or plugin claims without evidence |
| `docs/releases/2.0.0-rc.1/naming-and-publication-matrix.md` | Naming, slug, and publication-path decision record | Keeps `ECC`, npm `ecc-universal`, and plugin slug `ecc` for rc.1 |
| `docs/releases/2.0.0-rc.1/release-name-plugin-publication-checklist-2026-05-18.md` | Release name, package, Claude plugin, Codex plugin, and publication-order checklist | Freezes rc.1 identity and requires final commit evidence before plugin, billing, or announcement actions |
| `docs/releases/2.0.0-rc.1/x-thread.md` | X launch draft | Must use live GitHub/npm URLs and keep remaining plugin/video/billing URLs gated |
| `docs/releases/2.0.0-rc.1/linkedin-post.md` | LinkedIn launch draft | Must use live GitHub/npm URLs and keep remaining plugin/video/billing URLs gated |
| `docs/releases/2.0.0-rc.1/article-outline.md` | Longform launch outline | Must stay release-candidate framed until GA evidence exists |
| `docs/releases/2.0.0-rc.1/telegram-handoff.md` | Internal/shareable handoff copy | Must not include private workspace or credential details |
| `docs/releases/2.0.0-rc.1/demo-prompts.md` | Demo prompts and proof-of-work prompts | Must keep private Hermes workflows abstracted into public examples |
| `docs/releases/2.0.0-rc.1/ito-prediction-market-skill-pack.md` | Public Itô skill-pack distribution note | Keeps Itô API access gated, non-advisory, and separate from ECC Tools billing |

## Itô Skill Pack Boundary

The general product-integration contract is recorded in
`docs/architecture/platform-value-loop.md`. The Itô pack is the first worked
example: useful public workflows, separate gated API access, and sanitized
operator patterns feeding back into ECC without merging business ownership.

The preview pack includes six public teaser skills for prediction-market and
Itô-adjacent workflows:

- `skills/ito-market-intelligence/SKILL.md`
- `skills/ito-basket-compare/SKILL.md`
- `skills/ito-trade-planner/SKILL.md`
- `skills/ito-data-atlas-agent/SKILL.md`
- `skills/prediction-market-oracle-research/SKILL.md`
- `skills/prediction-market-risk-review/SKILL.md`

They are research, comparison, planning, and risk-review skills. They do not
place trades, do not provide investment advice, and do not merge ECC Tools with
Itô. Any Itô-backed data call requires explicit gated API access through
`ITO_API_KEY`.

## Hermes Skill Boundary

The preview pack includes one public Hermes-specialized skill:

- `skills/hermes-imports/SKILL.md`

That is intentional for rc.1. The skill is a sanitization and conversion
workflow, not a dump of private Hermes automations. Additional Hermes-generated
skills should enter ECC only after they pass the same rules:

- no raw workspace exports;
- no live account names, client data, finance data, CRM data, health data, or
  private contact graph;
- provider requirements described by capability, not by secret value;
- repo-relative examples instead of local absolute paths;
- tests or docs proving the workflow is useful without private state.

## Reference-Inspired Adapter Direction

The preview pack uses outside systems as design pressure, not as copy targets:

| Reference pressure | ECC preview-pack interpretation |
| --- | --- |
| Claude Code | Native plugin, skills, commands, hooks, MCP conventions, and statusline-oriented workflows |
| Codex | Instruction-backed plugin metadata, shared skills, MCP reference config, and explicit hook-parity caveats |
| OpenCode | Adapter-backed package/plugin surface with shared hook logic at the edge |
| Zed-adjacent tools | Instruction-backed portability until a verified native adapter exists |
| dmux | Session/runtime orchestration signals and handoff exports, not a replacement for repo validation |
| Orca, Superset, Ghast | Reference-only pressure for worktree lifecycle, session grouping, notifications, and workspace presets |
| Hermes Agent, meta-harness, autocontext-style systems | Evaluation, memory, and context-routing pressure routed through public artifacts, verifier outputs, and the evaluator/RAG prototype |

## Final Verification Commands

Run these from the exact release commit before publication:

```bash
git status --short --branch
node scripts/platform-audit.js --json
npm run preview-pack:smoke
npm run release:approval-gate -- --format json
npm run release:video-suite -- --format json
npm run harness:adapters -- --check
npm run harness:audit -- --format json
npm run observability:ready
npm run security:ioc-scan
npm audit --audit-level=moderate
npm audit signatures
node tests/docs/ecc2-release-surface.test.js
node tests/run-all.js
cd ecc2 && cargo test
```

## Publication Blockers

The preview pack is assembled, and the first release/package surfaces are now
live. Full publication is still blocked until these live surfaces and decisions
are recorded in a final evidence file:

- final release URL ledger regenerated from the intended release commit;
- `npm run release:approval-gate -- --format json` returning ready true after
  owner approvals and live URL readbacks are recorded;
- final release name/plugin publication checklist rerun from the intended
  release commit;
- GitHub prerelease `v2.0.0-rc.1` live readback;
- npm `ecc-universal@2.0.0-rc.1` on the `next` dist-tag live readback;
- Claude plugin tag / marketplace propagation for `ecc@ecc`;
- Codex repo-marketplace distribution evidence plus official Plugin Directory
  availability status;
- final announcement URLs in X, LinkedIn, GitHub release, and longform copy;
- ECC Tools billing/product readiness evidence remains fresh: the May 20
  selected-target KV readback and live announcement gate passed through the
  operator bearer path. Repeat the billing readback and gate immediately before
  any native-payments announcement copy is published.

## Result

The rc.1 preview pack is ready for a final clean-checkout release gate, but not
for full public publication without the remaining approval-gated release, package, plugin, and
announcement steps above. GitHub and npm are now recorded; plugin, video,
billing, and outbound approvals remain open.
