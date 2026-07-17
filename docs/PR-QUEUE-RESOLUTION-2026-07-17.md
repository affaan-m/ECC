# ECC PR Queue Resolution - 2026-07-17

Generated from a live open-PR inventory on 2026-07-17.

Repository reviewed: `affaan-m/ECC`

Open PRs reviewed: 80

Review scope:

- usefulness and project cohesion
- merge state and available checks
- bug-fix value
- outbound links and external-service/data movement
- workflow, package, hook, provider, and install surface risk
- self-promotion, generated review metadata, and unrelated shoutouts
- jailbreak or prompt-injection content

No PRs were merged, closed, commented on, or approved during this review.

## Executive Recommendation

Treat this queue as three lanes:

1. **Merge or rebase small fixes first.** The best near-term value is in focused
   bug fixes with tests and no new external surface.
2. **Port useful overlapping work on maintainer branches.** Several PRs are
   good ideas but conflict with each other or touch risky hooks/provider/package
   paths.
3. **Close broad, generated, promotional, or out-of-scope bundles.** A few PRs
   add unrelated product apps, generated artifacts, submodules, or placeholder
   files. They are not safe to merge into ECC.

## Top Merge Candidates

These are the top "review now" PRs. Some still need maintainer-triggered trusted
CI or rebase because GitHub reports `UNSTABLE`/`DIRTY` merge state, but they are
the most coherent and valuable contributions.

| Rank | PR | Action | Why |
| ---: | --- | --- | --- |
| 1 | #2525 `feat(codex): add ECC navigation guide` | Merge after checks | Cohesive Codex navigation guide with sync/package tests and green checks. |
| 2 | #2515 `fix(llm/providers/claude): attach cache_control to system block` | Merge, then close #2521 | Best Claude cache-control fix: preserves caching behavior and adds tests. |
| 3 | #2503 `fix: make the installer runtime pass strict supply-chain vetting` | Merge after install/package CI | Strong supply-chain hardening; review package surface before merge. |
| 4 | #2501 `fix(plan-canvas): stop dropping list items` | Merge after checks | Focused parser fix with targeted plan-canvas markdown tests. |
| 5 | #2498 `fix(project-detect): parse Python deps pinned with ~= and @` | Merge after checks | Low-risk framework detection bug fix with regression tests. |
| 6 | #2494 `refactor(hooks): consolidate PostToolUse hooks` | Merge after full CI | High blast radius, but clean, coherent, and heavily tested. |
| 7 | #2493 `fix(hooks): preserve Stop output` | Merge after checks | Focused hook stdout preservation fix with regression tests. |
| 8 | #2491 `fix(opencode): resolve command agent ids` | Merge after checks | Clean OpenCode compatibility fix, full CI green. |
| 9 | #2490 `fix(skill-evolution): wire Skill PostToolUse tracker` | Merge after checks | Local-only skill run tracking with tests; no outbound movement. |
| 10 | #2466 `feat(session-start): rank injected instincts by relevance` | Merge after checks | Useful local relevance ranking, opt-out via env, full CI green. |
| 11 | #2464 `fix(observer): repair daemon boot` | Merge after checks | Tight CLV2 observer fix with regression tests. |
| 12 | #2459 `fix(opencode/tools): normalize backslashes` | Merge after checks | Clean cross-platform fix with substantial branch coverage. |

## Bug-Fix Batch

Recommended bug-fix sequence:

| PR | Action | Notes |
| --- | --- | --- |
| #2517 | Merge after checks | Fixes a yarn regex bug that made too many tmux reminders fire; includes regression tests. |
| #2516 | Merge after manual dashboard smoke | Small dashboard refresh fix; no test coverage. |
| #2511 | Merge after checks | One-line CLV2 resolver rename fix. |
| #2508 | Merge after checks | Cargo lock-only Dependabot update; checks green. |
| #2507 | Merge after checks | Pinned-SHA GitHub Actions bump; checks green. |
| #2495 | Merge after trusted CI | Good shell-substitution parser tests; supersedes #2478. |
| #2492 | Merge after trusted CI | Useful Windows/MSYS stocktake fixes and docs cleanup. |
| #2487 | Merge after checks | Small strategic-compact env-var docs clarification. |
| #2486 | Merge after trusted CI | Focused hook noise fixes with tests. |
| #2484 | Merge after checks | One-line CLV2 resolver-name fix. |
| #2483 | Merge after checks | Fixes cost inflation via transcript message-id dedupe. |
| #2462 | Merge after full CI | Auto-update root probing fix with tests. |
| #2460 | Merge | One-character docs typo fix. |
| #2455 | Merge after checks | PyYAML dev lower-bound hardening. |
| #2454 | Merge after checks | pytest-mock dev lower-bound bump. |
| #2405 | Merge after full CI | Focused hook/parser fixes with tests. |
| #2380 | Merge after full CI | Privacy/performance fix that suppresses raw hook input echo. |
| #2364 | Merge after full CI | Python CI hardening; workflow change needs trusted maintainer run. |
| #2327 | Merge after dependency review | Dependabot-only pytest-asyncio lower-bound update, checks green. |
| #2063 | Salvage manually or rebase with test | Tiny Windows UTF-8 fix; avoid merging conflicting PR as-is. |

## Port Or Rebuild

These are useful ideas but should not be merged exactly as submitted.

| PR | Recommendation | Reason |
| --- | --- | --- |
| #2510 | Port/rebase after #2515 | Minimax provider is useful and tested, but touches external API domains and overlaps provider changes. |
| #2485 | Port after #2493/#2494 | Valuable transcript-bloat fix, but overlaps hook stdout/dispatcher work. |
| #2472 | Park for package-surface audit | Broad install/package expansion; review every newly published skill path first. |
| #2468 | Port as canonical 1M model-family fix | Better than #2465 due boundary-aware tests. |
| #2446 | Port | RAG reviewer agent is useful; existing PR is dirty and count metadata is stale. |
| #2424 | Port exact docs changes | Useful Quarkus/ZAP docs modernization; dirty docs drift. |
| #2385 | Port after CI/config cleanup | Useful configurable provider defaults; overlaps Python CI/provider work. |
| #2318 | Stage as product addition | Coherent OpenSpec ecosystem but broad: agents, skills, CI scripts, manifests. |
| #2311 | Rebase, register, then review | Story workflow is plausible but registration/counts need cleanup. |
| #2309 | Rebase, register, then review | Dev-team skill is coherent and treats project context as untrusted data. |
| #2280 | Rebase plus domain/security review | AL/Business Central pack is coherent, but broad and includes Microsoft Learn MCP surface. |
| #2277 | Merge after normal skill review | Focused living-docs skill, registered, full CI green. |
| #2246 | Re-review after requested changes | Focused command docs fix; existing changes-requested must be resolved. |

## Needs Changes Before Merge

| PR | Required changes |
| --- | --- |
| #2524 | Do not merge as-is. Copilot adapter expands execution surface, has path/spawn reliability issues, placeholder scripts, floating Actions, and broad `ecc-run` execution. |
| #2519 | Remove contributor repo/social references and any unrelated promotion before merge. |
| #2518 | Security intent is good, but CI fails and the patch appears incomplete; port with tests using existing loopback/path-safety helpers. |
| #2509 | Dependabot npm bump fails required checks; regenerate from current base. |
| #2496 | Close or rewrite: adds a config-health skill that references missing implementation and fails many checks. |
| #2488 | Fix Windows CI failure in `plugin-hook-bootstrap.test.js`. |
| #2456 | Fix Windows pnpm failure before considering Actions major bump. |
| #2444 | Remove personal portfolio link, pin or vendor-check external CLI behavior, and clarify that `npx locakit` is an explicit install/execution surface. |
| #2322 | Product/security review required: Browser Use Cloud MCP adds API-key browser automation and cookie/profile surfaces. |
| #2314 | Owner review required: skill content is plausible but registration/publish intent is unclear. |
| #2313 | Rework workflow: pin actions, avoid unpinned `pip install`, add explicit permissions, PR trigger, and tests. |
| #2287 | Rework Kiro hook migration with schema validation, safer default enablement, and tests. |
| #2281 | Product/security review required: scripts install/use Codex tooling and send decision context to a second model. |
| #2270 | Keep blocked until requested changes resolve path bounds, local state, and tool prompt-injection boundaries. |
| #2136 | Hold for product/security decision: external AURA trust-check egress is opt-in but real. |

## Close Or Skip

| PR | Recommendation | Reason |
| --- | --- | --- |
| #2521 | Close after #2515 | Superseded by better tested cache-control fix. |
| #2505 | Close | Adds ECC as a submodule inside itself; confusing and risky install surface. |
| #2500 | Close | Adds a blank top-level `ECC` file; no value. |
| #2478 | Close | Weaker duplicate of #2495. |
| #2470 | Close | Adds local-project/vendor-specific guidance and external env/service references not cohesive with ECC. |
| #2465 | Close | Superseded by #2468. |
| #2458 | Park | Production dependency floor bump not needed because current range already permits latest Anthropic SDK. |
| #2457 | Park | Production OpenAI SDK major lower-bound bump may break users without clear need. |
| #2450 | Park | Lockfile-only drift without corresponding source change or full CI. |
| #2412 | Park/split | Huge memory telemetry workflow with data-movement/scheduled-worker/schema changes. Needs architecture and security review by slices. |
| #2354 | Close | Unrelated TokenGuard SaaS app, promotional links, AI proxy, open CORS, new deploy/package surface. |
| #2353 | Close | Unrelated incident-response SaaS with Stripe/JWT/webhooks/Slack/generated assets. |
| #2352 | Close/split | 440-file Pi integration and runtime/package surface; too broad for direct merge. |
| #2351 | Hold for translator review | Ukrainian README may be useful but includes social/promo/badge/tooling links. |
| #2349 | Close | Worktree/gap-analysis snapshots with Claude session metadata; not a product contribution. |
| #2312 | Close stale | Metadata count-only drift. |
| #2264 | Close/rewrite | Draft release/SLSA workflow changes with failing matrix and high-risk permissions. |

## Outbound Links And Data Movement Findings

High-signal link and egress concerns:

- #2524 adds a Copilot extension and new workflow, with broad command execution
  and placeholder scan scripts.
- #2510 adds external provider domains: `api.minimax.io` and `api.minimaxi.com`.
- #2444 delegates to the external `locakit` npm CLI and includes a personal
  portfolio link.
- #2322 adds Browser Use Cloud MCP egress to `api.browser-use.com` and
  `cloud.browser-use.com`.
- #2281 adds scripts that can install/use Codex tooling and send decision
  context outside the current model/session.
- #2136 adds opt-in AURA lookup egress to `agent.auraopenprotocol.org`.
- #2353 and #2354 include unrelated SaaS/product surfaces with external APIs,
  payment/webhook/proxy/deploy links, generated assets, and promotional content.
- #2412 introduces telemetry/memory/scheduled-worker data movement and should be
  split before serious review.

Generated/promotion cleanup needed:

- Remove personal portfolio links and unrelated community/social links from
  PR bodies and new docs before merge.
- Do not import generated review badges or session links from PR bodies into
  project docs.
- Existing official ECC metadata links should not be treated as new promotion
  unless a PR expands them or adds unrelated personal/vendor references.

Prompt-injection/jailbreak scan:

- No active jailbreak payload stood out in the queue.
- Several PRs add defensive prompt-injection language. Treat those as guardrails,
  but still review changed agent/skill prompts as untrusted text before merge.

## PR Resolution System

Interrupted work was found in the 2026-07-16 stash:

- `.github/workflows/pr-queue-triage-report.yml`
- `scripts/pr-queue-email-report.js`
- `scripts/pr-review-packet.js`
- `skills/pr-queue-triage/SKILL.md`
- `tests/scripts/pr-queue-email-report.test.js`
- `tests/scripts/pr-review-packet.test.js`
- historical `docs/PR-QUEUE-TRIAGE-2026-07-13.md`

The design is worth reviving, but not as an unattended emailer in its stashed
form. Required fixes before enabling a schedule:

1. Schedule Monday and Thursday UTC, not every third calendar day.
2. Remove the hardcoded personal email recipient from the workflow and script.
3. Make artifact-only mode the default; SMTP should be opt-in.
4. Redact token-like strings, webhook URLs, query strings, and exact jailbreak
   phrases from emailed/stored reports.
5. Report domains/categories rather than full suspicious URLs.
6. Treat large-diff failures as high-risk/split-required.
7. Add socket timeouts and header-injection validation for SMTP.
8. Keep workflow permissions read-only and continue pinning Actions by SHA.
9. Add tests for redaction, large diffs, SMTP misconfiguration, header injection,
   and `since-last-success` fallback.

Recommended first online version:

- Commit the skill, reporter, packet generator, tests, and scheduled workflow.
- Schedule: `17 14 * * 1,4`.
- Workflow defaults to artifact generation only.
- Email requires explicit secrets and `--send-email`; scheduled runs should not
  fail if SMTP is absent.
- Use the stale-PR salvage ledger as the durable disposition ledger after each
  cleanup batch.
