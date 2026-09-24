# Stale PR Salvage Ledger

This ledger records useful work recovered from stale, conflicted, or closed PRs.
The rule is simple: queue cleanup closes stale PRs, but it does not discard
useful work. Maintainers should inspect the closed diff, port compatible pieces
on fresh branches, and credit the source PR.

## Classification States

| State | Meaning |
| --- | --- |
| Salvaged | Useful work was ported to current `main` through a maintainer PR. |
| Already present | Current `main` already contained the useful work before salvage. |
| Superseded | Current `main` solved the same problem differently. |
| Skipped | The PR was accidental, too broad, unsafe, or too low-signal to port. |
| Translator/manual review | Content may be useful, but needs human language/domain review before import. |

## Salvaged Into Current Main

| Source PR | Original contribution | Salvage result |
| --- | --- | --- |
| #1232 | `skill-scout` search-before-creating workflow | Salvaged in the May 12 cost/skill-scout maintainer pass with current repo wording, external-source vetting, and no stale catalog-count edits. |
| #1304 | Cost tracking skill and `/cost-report` command | Salvaged in the May 12 cost/skill-scout maintainer pass with current command/skill conventions and without stale hard-coded model pricing. |
| #1309 | Trading/community project material | Salvaged in #1761 as a neutral community-project README listing. |
| #1310 | Django reviewer, build resolver, and Celery async task guidance | Salvaged in the May 12 Django/Celery maintainer pass with current catalog counts and minor example cleanup. |
| #1322 | Vietnamese README translation | Salvaged in #1764 as `docs/vi-VN/README.md` plus selector updates. |
| #1325 | Quarkus framework guidance, Java agents, and localization material | Salvaged across #1771 and #1803; stale broad docs/count edits were not copied. |
| #1326 | Angular developer skill and rules | Salvaged in #1763 with current skill, rules, install wiring, and catalog updates. |
| #1328 | Continuous-learning Windows UTF-8 stdout fix | Salvaged in #1761. |
| #1329 | Plugin install detection hardening | Salvaged in #1761 through current harness audit detection support. |
| #1334 | Windows desktop E2E skill | Salvaged in #1762 with install, package, and catalog wiring. |
| #1352 | Qwen install target | Salvaged in #1738 through the current Qwen install target. |
| #1413 | Network and homelab skills/agents | Salvaged through #1729, #1731, #1745, and #1778. |
| #1414 | F# rules, reviewer agent, and testing skill | Salvaged in #1770 with current install manifests, detection tests, and catalog wiring. |
| #1429 | JoyCode install target | Salvaged in #1737 through the current JoyCode install target. |
| #1467 | Scientific skills and OpenCode discovery work | Useful USPTO and gget pieces salvaged in #1740; stale generated claims were not copied. |
| #1478 | HarmonyOS/ArkTS rules, resolver agent, and CLAUDE example | Salvaged in #1769 with current install wiring; stale `ecc2` session/TUI edits were not carried. |
| #1493 | SessionStart context scoping | Salvaged in #1774 with current hook semantics and tests. |
| #1498 | PRD planning flow | Salvaged in #1777. |
| #1504 | Statusline/context monitor hooks | Salvaged in #1776 with current hook manifest structure and tests. |
| #1528/#1529/#1547 | Astraflow and UModelVerse provider support | Salvaged in #1775 with current provider wiring and defensive tool-call parsing. |
| #1558 | `agentic-os` skill | Salvaged in #1772. |
| #1559 | `error-handling` skill | Salvaged in #1772. |
| #1566 | Agent architecture audit skill | Salvaged in #1772. |
| #1578 | OpenCode file-probe hardening | Salvaged in #1773. |
| #1603 | `plan-orchestrate` skill | Salvaged in #1766 with current manifest/catalog wiring. |
| #1658 | Code-reviewer false-positive suppression | Salvaged in the May 12 code-reviewer maintainer pass with current review-agent wording, a proof gate for HIGH/CRITICAL findings, common false-positive exclusions, and a regression test. |
| #1659 | Frontend design direction and interface-polish skills | Salvaged in the May 12 frontend-design maintainer pass with canonical `skills/` layout and current ECC frontend guidance, while preserving the repo guardrail that the official `frontend-design` skill should be installed from `anthropics/skills`. |
| #1674 | Production audit skill | Salvaged in #1732 after supply-chain/privacy review and rewrite. |
| #1687 | zh-CN localization sync | Large safe subsets salvaged in #1746-#1752; remaining pieces require translator/manual review. |
| #1694 | Portfolio curation | Useful focused curation updates salvaged in #1723 and #1724. |
| #1695 | Russian README translation | Ported in #1722. |
| #1697 | Saved LLM selector config | Salvaged as part of provider config/tool schema work in #1720. |
| #1699 | Windows post-edit-format path guard | Ported in #1719. |
| #1700 | Provider tool serialization | Ported in #1720. |
| #1705/#1780 | Production UI motion system | Salvaged in #1772, #1781, and #1782 with examples fixed before merge. |
| #1713 | Swift language support | Ported in #1721. |
| #1715 | CI personal-path validator hardening | Ported through CI validator hardening in #1717. |
| #1727 | MySQL patterns skill | Salvaged in #1733. |
| #1757 | Machine-learning engineering workflow | Salvaged in #1758 and tuned in #1759. |

## 2026-05-12 Gap Pass

The initial stale-closure ledger covered the P0 cleanup cohort and the biggest
salvage branches. A follow-up gap pass over PRs closed on 2026-05-11 found
additional useful items that were already present on `main` or still worth
porting.

| Source PR | Disposition |
| --- | --- |
| #1310 | Ported through the Django/Celery maintainer branch after confirming `agents/django-reviewer.md`, `agents/django-build-resolver.md`, and `skills/django-celery/SKILL.md` were still missing. |
| #1325 | Useful Quarkus framework material was already preserved across #1771 and #1803; current `main` contains the Quarkus rules/skills plus Java reviewer/build-resolver surfaces. |
| #1360 | Already present as `skills/security-bounty-hunter/`. |
| #1414 | Useful F# support was already preserved in #1770; current `main` contains the F# rules, reviewer agent, testing skill, install wiring, and detection tests. |
| #1415 | Already present as `skills/vite-patterns/`. |
| #1478 | Useful HarmonyOS/ArkTS support was already preserved in #1769; current `main` contains the ArkTS rules, resolver agent, CLAUDE example, and install wiring. |
| #1438 | Already present as `skills/ui-to-vue/`. |
| #1504 | Already mapped to #1776 in the durable salvage table. |
| #1508 | Already present as `skills/fastapi-patterns/` and `agents/fastapi-reviewer.md`. |
| #1563/#1564/#1565 | Translator/manual review: zh-TW, tr, and pt-BR README syncs may contain useful localization updates, but stale README/version/count text must be reviewed by language owners before import. |
| #1567 | Already present as the current GateGuard subagent file-gate bypass in `scripts/hooks/gateguard-fact-force.js`, with Bash gates preserved and regression tests in `tests/hooks/gateguard-fact-force.test.js`. |
| #1570 | Already present as public `llm.prompt` imports, keyword-based `PromptBuilder` construction, and template registry helpers; current tests register the `unit` marker through `tests/conftest.py`. |
| #1584 | Already present as the iTerm2 native desktop-notification fast path in `scripts/hooks/desktop-notify.js`, with multiplexer fallback to `osascript`. |
| #1589 | Already present as quoted `actions/checkout` detection in `scripts/ci/validate-workflow-security.js` plus double/single-quote regression tests. |
| #1594 | Already present as HTTP MCP reachability handling that treats HTTP 400, 401, and 403 probe responses as reachable/auth-gated, with hook tests. |
| #1597 | Already present as catalog-count validation for README, AGENTS, zh-CN docs, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json`. |
| #1602 | Already present as the `continuous-learning` v1 deprecation that routes new usage to `continuous-learning-v2` while preserving the archival v1 surface. |
| #1603 | Useful `/plan-orchestrate` work was already preserved in #1766 with current package/catalog metadata. |
| #1604 | Skipped: Windows drag-and-drop local installer copies files directly and runs `git pull`; current managed installer/profile flow is safer and supersedes it. |
| #1609 | Translator/manual review: Persian README translation may be useful, but needs language review and current catalog/version refresh before import. |
| #1613 | Already present in `rules/web/hooks.md` as the `tsc --incremental` plus timeout-capped PostToolUse example. |
| #1631 | Already present in `scripts/hooks/suggest-compact.js` and `tests/hooks/hooks.test.js`; current code reads `session_id` from stdin JSON before falling back to `CLAUDE_SESSION_ID`. |
| #1648 | Already present in `src/llm/providers/claude.py`; current Claude provider collects all text and tool-use content blocks and covers the behavior in `tests/test_claude_provider.py`. |
| #1658 | Ported through the code-reviewer maintainer branch after confirming the false-positive proof gate and common false-positive skip list were still missing. |
| #1693 | Already present as `skills/redis-patterns/`. |

## Already Present Or Superseded

| Source PR | Disposition |
| --- | --- |
| #1306 | Hook bug workarounds already exist on `main` as `docs/hook-bug-workarounds.md`. |
| #1318 | Gemini agent adaptation utility was already present on current `main`. |
| #1323 | Hook config update was already present on current `main`. |
| #1337 | Catalog count update was superseded by current catalog-count sync. |
| #1631 | `suggest-compact` stdin `session_id` isolation was already present on current `main` with hook tests. |
| #1608 | Unsafe dashboard document/terminal open handling was already present on current `main` through safe runtime helpers and project-bound document opening. |
| #1678 | Windows MCP `.cmd`/`.bat` fallback behavior was already present on current `main` with current health-check tests. |
| #1682/#1701 | Strategic compact hook-path fixes were merged directly or superseded by current docs fixes. |
| JARVIS #4/#5/#6 | Stale failing dependency-only PRs; future dependency state should be regenerated by Dependabot. |

## 2026-05-18 Owner-Wide Queue Cleanup

The ECC release repos were already clean, but an owner-wide `gh search` sweep
found stale queues in older public/private projects. The cleanup closed 24
stale dependency-bot PRs and 72 stale legacy payments/0EM roadmap issues,
then closed the final 9 stale/generated/conflicting/test PRs and 5
legacy/outreach/placeholder issues. The `affaan-m` owner namespace is now at 0
open PRs and 0 open issues by live `gh search`. The detailed before/after
evidence and final queue disposition are recorded in
`docs/releases/2.0.0-rc.1/owner-queue-cleanup-2026-05-18.md`.

| Scope | Disposition |
| --- | --- |
| Dependabot PRs in `stoictradingAI`, `Behavioral_RL`, `dprc-autotrader-v2`, `x-algorithm-score`, `polycule-secure`, and `pragmAItism_defAInce` | Skipped as stale generated dependency bumps; regenerate from current base if still needed. |
| Legacy issues in `payments0-api`, `payments0-sdk`, `agent-payments-gateway`, `0EM_Frontend`, `0em-payments-dashboard`, and `yield-optimizer` | Superseded by ECC Tools native-payments, hosted analysis, billing-readback, and Linear/project roadmap lanes. |
| Archived repos touched for PR closure | `stoictradingAI`, `dprc-autotrader-v2`, `polycule-secure`, and `pragmAItism_defAInce` were restored to archived state after stale PR closure. |
| Final PR/issue sweep | Closed the remaining generated ECC bundles, stale Cloudflare rename PRs, stale README-card PR, test/noise PR, public outreach issues, and empty placeholder issue. Preserved `dexploy#25` findings in Linear `ITO-62` before closure. |

## Skipped

| Source PR | Reason |
| --- | --- |
| #1308 | Stale zh-CN sync would rewind or delete too much current tree state; concrete selector-link fix was already present. |
| #1320 | Package-manager removal conflicts with the current npm/pnpm/yarn/bun CI policy. |
| #1341 | Very large low-signal generated change with no safe focused salvage unit. |
| #1416/#1465 | Accidental fork-sync PRs with no focused contribution. |
| #1475 | One-line Gemini CLI bridge idea was too stale and underspecified to port safely. |
| #1604 | Drag-and-drop Windows installer bypasses the current managed installer, performs direct broad copies, and runs `git pull` from a local install script. |

## Remaining Manual-Review Backlog

The remaining plausibly useful backlog is translation/localization work that is
unsafe to auto-port without language-owner review. This tail is attached to
Linear ITO-55 and is not a release-blocking salvage task; release work should
only verify that the backlog remains recorded and excluded from blind imports:

- #1687 zh-CN localization tail
- #1609 Persian README translation
- #1563 zh-TW README sync
- #1564 Turkish README sync
- #1565 pt-BR README sync

Handling rule:

1. Keep these PRs in translator/manual review.
2. Split any future work by surface: agents, commands, top-level docs, release
   and count surfaces, then skills.
3. Do not import stale top-level docs that carry old version or catalog-count
   facts.
4. Do not reopen old PRs unless the original author returns with a current
   rebase; maintainer-side salvage should happen on fresh branches with
   attribution.

## Future Cleanup Rule

For every stale/conflicted PR cleanup batch:

1. Close or comment on the PR based on the queue policy.
2. Add the source PR to this ledger or a dated successor ledger.
3. Classify it as salvaged, already present, superseded, skipped, or
   translator/manual review.
4. If useful, port a small compatible slice on a fresh maintainer branch.
5. Credit the source PR and author in the maintainer PR body.
