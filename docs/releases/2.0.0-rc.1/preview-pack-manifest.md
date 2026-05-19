# ECC v2.0.0-rc.1 Preview Pack Manifest

This manifest defines the reviewed preview pack for `2.0.0-rc.1`. It is not a
release action by itself. Use it to verify that the public launch surface is
assembled before creating the GitHub prerelease, publishing npm, tagging plugin
surfaces, or posting announcements.

## Pack Contents

| Artifact | Role | Gate |
| --- | --- | --- |
| `README.md` | Public onramp and install surface | Links Hermes setup, rc.1 notes, plugin install, manual install, reset, and uninstall guidance |
| `docs/HERMES-SETUP.md` | Public Hermes operator topology | No raw workspace export, credentials, private account names, or local-only operator state |
| `skills/hermes-imports/SKILL.md` | Sanitized Hermes-to-ECC import workflow | Includes import rules, sanitization checklist, conversion pattern, and output contract |
| `docs/architecture/cross-harness.md` | Shared substrate model for Claude Code, Codex, OpenCode, Cursor, Gemini, Hermes, and terminal-only use | Names portability boundaries and does not claim unsupported native parity |
| `docs/architecture/harness-adapter-compliance.md` | Adapter matrix and scorecard | Verified by `npm run harness:adapters -- --check` |
| `docs/architecture/observability-readiness.md` | Local operator-readiness gate | Verified by `npm run observability:ready` |
| `docs/architecture/progress-sync-contract.md` | GitHub, Linear, handoff, roadmap, and work-item sync boundary | Checked by `node scripts/platform-audit.js --json` |
| `scripts/preview-pack-smoke.js` | Deterministic preview-pack smoke gate | Verified by `npm run preview-pack:smoke` |
| `docs/releases/2.0.0-rc.1/release-notes.md` | GitHub release copy source | Must be refreshed with final live release/package/plugin URLs before publication |
| `docs/releases/2.0.0-rc.1/quickstart.md` | Clone-to-first-workflow path | Covers clone, install, verify, first skill, and harness switch |
| `docs/releases/2.0.0-rc.1/launch-checklist.md` | Operator launch checklist | Must remain approval-gated for release, package, plugin, and announcement actions |
| `docs/releases/2.0.0-rc.1/publication-readiness.md` | Release gate | Requires fresh evidence from the exact release commit |
| `docs/releases/2.0.0-rc.1/publication-evidence-2026-05-15.md` | Current May 15 queue, roadmap, security, supply-chain watch, no-lifecycle CI install hardening, AgentShield #86 evidence-pack provenance, ECC Tools billing-gate, Actions cache purge, and `ecc2` test evidence through PR #1941 | Must be superseded by a final clean-checkout evidence file before real publication |
| `docs/releases/2.0.0-rc.1/publication-evidence-2026-05-16.md` | Current May 16/17 queue cleanup, recsys skill merge, GateGuard triage, PR #1947 supply-chain protection, AgentShield #87 plugin-cache confidence evidence, AgentShield #88 evidence-pack inspect/readback, AgentShield #89 evidence-pack fleet routing, AgentShield #90 fleet review items, AgentShield #91 policy export, AgentShield #92 policy promotion, ECC-Tools #76 fleet-summary consumption, ECC-Tools #77 hosted finding evidence paths, ECC-Tools #78 harness policy-route linking, dashboard refresh, and combined Node/Rust/release-surface gate evidence through the May 16 mirror | Must still be repeated from a strict clean checkout before real publication |
| `docs/releases/2.0.0-rc.1/publication-evidence-2026-05-17.md` | May 17 queue-zero state, Japanese localization merge, Dependabot TypeScript and Node type merges, post-merge ja-JP lint repair, Mini Shai-Hulud/TanStack protection recheck, npm audit/signature checks, legacy and Linear progress routing, deterministic preview-pack smoke, operator dashboard refresh, Linear sync, and GitHub CI evidence for `27dc2918` | Superseded by the May 18 evidence snapshot; repeat from a strict clean checkout before real publication |
| `docs/releases/2.0.0-rc.1/publication-evidence-2026-05-18.md` | May 18 queue-zero state, #1970/#1971/#1972 merge batch, #1978 review/closure, supply-chain recheck, AgentShield evidence mirror, Linear sync, current-head CI/security scan success for `4470e2e6`, and ITO-46 naming/plugin publication closure | Superseded by the May 19 ECC identity, video, and growth evidence snapshot |
| `docs/releases/2.0.0-rc.1/publication-evidence-2026-05-19.md` | Current May 19 evidence for canonical ECC identity, release video suite, partner/sponsor/talk outreach pack, May 19 operator dashboard, preview-pack smoke digest `bc2bf157616e`, 2547-test local suite, PR #1998 visual QA CI success, and PR #1999 dashboard evidence CI success | Current strongest readiness snapshot; must still be repeated from a strict clean checkout before real publication |
| `docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-17.md` | Previous prompt-to-artifact operator dashboard | Superseded by the May 18 generated dashboard |
| `docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-18.md` | Previous prompt-to-artifact operator dashboard | Superseded by the May 19 generated dashboard |
| `docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-19.md` | Current prompt-to-artifact operator dashboard | Shows PR/issue/discussion/platform/supply-chain gates current and adds the current `$1,728/mo` to `$10,000/mo` hypergrowth, video owner-approval, and outbound-pack operating lanes |
| `docs/releases/2.0.0-rc.1/release-url-ledger-2026-05-19.md` | Live URL and approval-gated URL ledger for release copy | Must be regenerated from the final release commit before public announcements |
| `docs/releases/2.0.0-rc.1/video-suite-production.md` | Release video production manifest | Gates local media inventory, rough primary render, captions, timeline, self-eval, and no-private-path publication rules |
| `docs/releases/2.0.0-rc.1/partner-sponsor-talks-pack.md` | Partner, sponsor, consulting, conference, podcast, and discussion copy | Must stay approval-gated and avoid live billing, release, package, or plugin claims without evidence |
| `docs/releases/2.0.0-rc.1/naming-and-publication-matrix.md` | Naming, slug, and publication-path decision record | Keeps `ECC`, npm `ecc-universal`, and plugin slug `ecc` for rc.1 |
| `docs/releases/2.0.0-rc.1/release-name-plugin-publication-checklist-2026-05-18.md` | Release name, package, Claude plugin, Codex plugin, and publication-order checklist | Freezes rc.1 identity and requires final commit evidence before release, npm, plugin, billing, or announcement actions |
| `docs/releases/2.0.0-rc.1/x-thread.md` | X launch draft | Must replace placeholders with live URLs after release/package/plugin publication |
| `docs/releases/2.0.0-rc.1/linkedin-post.md` | LinkedIn launch draft | Must replace placeholders with live URLs after release/package/plugin publication |
| `docs/releases/2.0.0-rc.1/article-outline.md` | Longform launch outline | Must stay release-candidate framed until GA evidence exists |
| `docs/releases/2.0.0-rc.1/telegram-handoff.md` | Internal/shareable handoff copy | Must not include private workspace or credential details |
| `docs/releases/2.0.0-rc.1/demo-prompts.md` | Demo prompts and proof-of-work prompts | Must keep private Hermes workflows abstracted into public examples |

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

The preview pack is assembled, but publication is still blocked until these live
surfaces exist and are recorded in a final evidence file:

- final release URL ledger regenerated from the intended release commit;
- final release name/plugin publication checklist rerun from the intended
  release commit;
- GitHub prerelease `v2.0.0-rc.1`;
- npm `ecc-universal@2.0.0-rc.1` on the `next` dist-tag;
- Claude plugin tag / marketplace propagation for `ecc@ecc`;
- Codex repo-marketplace distribution evidence plus official Plugin Directory
  availability status;
- final announcement URLs in X, LinkedIn, GitHub release, and longform copy;
- ECC Tools billing/product readiness evidence before any native-payments
  announcement copy is published.

## Result

The rc.1 preview pack is ready for a final clean-checkout release gate, but not
for public publication without the approval-gated release, package, plugin, and
announcement steps above.
