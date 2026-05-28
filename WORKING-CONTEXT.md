# Working Context

Last updated: 2026-04-08

## Purpose

Public ECC plugin repo for agents, skills, commands, hooks, rules, install surfaces, and ECC 2.0 platform buildout.

## Current Truth

- Default branch: `main`
- Public release surface is aligned at `v1.10.0`
- Public catalog truth is `47` agents, `79` commands, and `181` skills
- Public plugin slug is now `ecc`; legacy `everything-claude-code` install paths remain supported for compatibility
- Release discussion: `#1272`
- ECC 2.0 exists in-tree and builds, but it is still alpha rather than GA
- Main active operational work:
  - keep default branch green
  - continue issue-driven fixes from `main` now that the public PR backlog is at zero
  - continue ECC 2.0 control-plane and operator-surface buildout

## Current Constraints

- No merge by title or commit summary alone.
- No arbitrary external runtime installs in shipped ECC surfaces.
- Overlapping skills, hooks, or agents should be consolidated when overlap is material and runtime separation is not required.

## Active Queues

- PR backlog: reduced but active; keep direct-porting only safe ECC-native changes and close overlap, stale generators, and unaudited external-runtime lanes
- Upstream branch backlog still needs selective mining and cleanup:
  - `origin/feat/hermes-generated-ops-skills` still has three unique commits, but only reusable ECC-native skills should be salvaged from it
  - multiple `origin/ecc-tools/*` automation branches are stale and should be pruned after confirming they carry no unique value
- Product:
  - selective install cleanup
  - control plane primitives
  - operator surface
  - self-improving skills
  - keep `agent.yaml` export parity with the shipped `commands/` and `skills/` directories so modern install surfaces do not silently lose command registration
- Skill quality:
  - rewrite content-facing skills to use source-backed voice modeling
  - remove generic LLM rhetoric, canned CTA patterns, and forced platform stereotypes
  - continue one-by-one audit of overlapping or low-signal skill content
  - move repo guidance and contribution flow to skills-first, leaving commands only as explicit compatibility shims
  - add operator skills that wrap connected surfaces instead of exposing only raw APIs or disconnected primitives
  - land the canonical voice system, network-optimization lane, and reusable Manim explainer lane
- Security:
  - keep dependency posture clean
  - preserve self-contained hook and MCP behavior

## Open PR Classification

- Closed on 2026-04-01 under backlog hygiene / merge policy:
  - `#1069` `feat: add everything-claude-code ECC bundle`
  - `#1068` `feat: add everything-claude-code-conventions ECC bundle`
  - `#1080` `feat: add everything-claude-code ECC bundle`
  - `#1079` `feat: add everything-claude-code-conventions ECC bundle`
  - `#1064` `chore(deps-dev): bump @eslint/js from 9.39.2 to 10.0.1`
  - `#1063` `chore(deps-dev): bump eslint from 9.39.2 to 10.1.0`
- Closed on 2026-04-01 because the content is sourced from external ecosystems and should only land via manual ECC-native re-port:
  - `#640` harper skills
- Native-support candidates to fully diff-audit next:
  - `#1055` Dart / Flutter support
  - `#1043` C# reviewer and .NET skills
- Direct-port candidates landed after audit:
  - `#1078` hook-id dedupe for managed Claude hook reinstalls
  - `#844` ui-demo skill
  - `#1110` install-time Claude hook root resolution
  - `#1106` portable Codex Context7 key extraction
  - `#1107` Codex baseline merge and sample agent-role sync
  - `#1119` stale CI/lint cleanup that still contained safe low-risk fixes
- Port or rebuild inside ECC after full audit:
  - `#894` Jira integration
  - `#814` + `#808` rebuild as a single consolidated notifications lane for Opencode and cross-harness surfaces

## Interfaces

- Public truth: GitHub issues and PRs
- Internal execution truth: linked Linear work items under the ECC program
- Current linked Linear items:
  - `ECC-206` ecosystem CI baseline
  - `ECC-207` PR backlog audit and merge-policy enforcement
  - `ECC-208` context hygiene
  - `ECC-210` skills-first workflow migration and command compatibility retirement

## Update Rule

Keep this file detailed for only the current sprint, blockers, and next actions. Summarize completed work into archive or repo docs once it is no longer actively shaping execution.

## Latest Execution Notes

- 2026-04-05: Continued `#1213` overlap cleanup by narrowing `coding-standards` into the baseline cross-project conventions layer instead of deleting it. The skill now explicitly points detailed React/UI guidance to `frontend-patterns`, backend/API structure to `backend-patterns` / `api-design`, and keeps only reusable naming, readability, immutability, and code-quality expectations.
- 2026-04-05: Added a packaging regression guard for the OpenCode release path after `#1287` showed the published `v1.10.0` artifact was still stale. `tests/scripts/build-opencode.test.js` now asserts the `npm pack --dry-run` tarball includes `.opencode/dist/index.js` plus compiled plugin/tool entrypoints, so future releases cannot silently omit the built OpenCode payload.
- 2026-04-05: Landed `skills/agent-introspection-debugging` for `#829` as an ECC-native self-debugging framework. It is intentionally guidance-first rather than fake runtime automation: capture failure state, classify the pattern, apply the smallest contained recovery action, then emit a structured introspection report and hand off to `verification-loop` / `continuous-learning-v2` when appropriate.
- 2026-04-05: Fixed the `main` npm CI break after the latest direct ports. `package-lock.json` had drifted behind `package.json` on the `globals` devDependency (`^17.1.0` vs `^17.4.0`), which caused all npm-based GitHub Actions jobs to fail at `npm ci`. Refreshed the lockfile only, verified `npm ci --ignore-scripts`, and kept the mixed-lock workspace otherwise untouched.
- 2026-04-05: Direct-ported the useful discoverability part of `#1221` without duplicating a second healthcare compliance system. Added `skills/hipaa-compliance/SKILL.md` as a thin HIPAA-specific entrypoint that points into the canonical `healthcare-phi-compliance` / `healthcare-reviewer` lane, and wired both healthcare privacy skills into the `security` install module for selective installs.
- 2026-04-05: Direct-ported the audited blockchain/web3 security lane from `#1222` into `main` as four self-contained skills: `defi-amm-security`, `evm-token-decimals`, `llm-trading-agent-security`, and `nodejs-keccak256`. These are now part of the `security` install module instead of living as an unmerged fork PR.
- 2026-04-05: Finished the useful salvage pass from `#1203` directly on `main`. `skills/security-bounty-hunter`, `skills/api-connector-builder`, and `skills/dashboard-builder` are now in-tree as ECC-native rewrites instead of the thinner original community drafts. The original PR should be treated as superseded rather than merged.
- 2026-04-02: `ECC-Tools/main` shipped `9566637` (`fix: prefer commit lookup over git ref resolution`). The PR-analysis fire is now fixed in the app repo by preferring explicit commit resolution before `git.getRef`, with regression coverage for pull refs and plain branch refs. Mirrored public tracking issue `#1184` in this repo was closed as resolved upstream.
- 2026-04-02: Direct-ported the clean native-support core of `#1043` into `main`: `agents/csharp-reviewer.md`, `skills/dotnet-patterns/SKILL.md`, and `skills/csharp-testing/SKILL.md`. This fills the gap between existing C# rule/docs mentions and actual shipped C# review/testing guidance.
- 2026-04-02: Direct-ported the clean native-support core of `#1055` into `main`: `agents/dart-build-resolver.md`, `commands/flutter-build.md`, `commands/flutter-review.md`, `commands/flutter-test.md`, `rules/dart/*`, and `skills/dart-flutter-patterns/SKILL.md`. The skill paths were wired into the current `framework-language` module instead of replaying the older PR's separate `flutter-dart` module layout.
- 2026-04-02: Closed `#1081` after diff audit. The PR only added vendor-marketing docs for an external X/Twitter backend (`Xquik` / `x-twitter-scraper`) to the canonical `x-api` skill instead of contributing an ECC-native capability.
- 2026-04-02: Direct-ported the useful Jira lane from `#894`, but sanitized it to match current supply-chain policy. `commands/jira.md`, `skills/jira-integration/SKILL.md`, and the pinned `jira` MCP template in `mcp-configs/mcp-servers.json` are in-tree, while the skill no longer tells users to install `uv` via `curl | bash`. `jira-integration` is classified under `operator-workflows` for selective installs.
- 2026-04-02: Closed `#1125` after full diff audit. The bundle/skill-router lane hardcoded many non-existent or non-canonical surfaces and created a second routing abstraction instead of a small ECC-native index layer.
- 2026-04-02: Closed `#1124` after full diff audit. The added agent roster was thoughtfully written, but it duplicated the existing ECC agent surface with a second competing catalog (`dispatch`, `explore`, `verifier`, `executor`, etc.) instead of strengthening canonical agents already in-tree.
- 2026-04-02: Closed the full Argus cluster `#1098`, `#1099`, `#1100`, `#1101`, and `#1102` after full diff audit. The common failure mode was the same across all five PRs: external multi-CLI dispatch was treated as a first-class runtime dependency of shipped ECC surfaces. Any useful protocol ideas should be re-ported later into ECC-native orchestration, review, or reflection lanes without external CLI fan-out assumptions.
- 2026-04-02: The previously open native-support / integration queue (`#1081`, `#1055`, `#1043`, `#894`) has now been fully resolved by direct-port or closure policy. The active public PR queue is currently zero; next focus stays on issue-driven mainline fixes and CI health, not backlog PR intake.
- 2026-04-01: `main` CI was restored locally with `1723/1723` tests passing after lockfile and hook validation fixes.
- 2026-04-01: Auto-generated ECC bundle PRs `#1068` and `#1069` were closed instead of merged; useful ideas must be ported manually after explicit diff audit.
- 2026-04-01: Major-version ESLint bump PRs `#1063` and `#1064` were closed; revisit only inside a planned ESLint 10 migration lane.
- 2026-04-01: Notification PRs `#808` and `#814` were identified as overlapping and should be rebuilt as one unified feature instead of landing as parallel branches.
- 2026-04-01: External-source skill PRs `#640`, `#851`, and `#852` were closed under the new ingestion policy; copy ideas from audited source later rather than merging branded/source-import PRs directly.
- 2026-04-01: The remaining low GitHub advisory on `ecc2/Cargo.lock` was addressed by moving `ratatui` to `0.30` with `crossterm_0_28`, which updated transitive `lru` from `0.12.5` to `0.16.3`. `cargo build --manifest-path ecc2/Cargo.toml` still passes.
- 2026-04-01: Safe core of `#834` was ported directly into `main` instead of merging the PR wholesale. This included stricter install-plan validation, antigravity target filtering that skips unsupported module trees, tracked catalog sync for English plus zh-CN docs, and a dedicated `catalog:sync` write mode.
- 2026-04-01: Repo catalog truth is now synced at `36` agents, `68` commands, and `142` skills across the tracked English and zh-CN docs.
- 2026-04-01: Legacy emoji and non-essential symbol usage in docs, scripts, and tests was normalized to keep the unicode-safety lane green without weakening the check itself.
- 2026-04-01: The remaining self-contained piece of `#834`, `docs/zh-CN/skills/browser-qa/SKILL.md`, was ported directly into the repo. After commit, `#834` should be closed as superseded-by-direct-port.
- 2026-04-01: Content skill cleanup started with `content-engine`, `crosspost`, `article-writing`, and `investor-outreach`. The new direction is source-first voice capture, explicit anti-trope bans, and no forced platform persona shifts.
- 2026-04-01: `node scripts/ci/check-unicode-safety.js --write` sanitized the remaining emoji-bearing Markdown files, including several `remotion-video-creation` rule docs and an old local plan note.
- 2026-04-01: Core English repo surfaces were shifted to a skills-first posture. README, AGENTS, plugin metadata, and contributor instructions now treat `skills/` as canonical and `commands/` as legacy slash-entry compatibility during migration.
- 2026-04-01: Follow-up bundle cleanup closed `#1080` and `#1079`, which were generated `.claude/` bundle PRs duplicating command-first scaffolding instead of shipping canonical ECC source changes.
- 2026-04-01: Ported the useful core of `#1078` directly into `main`, but tightened the implementation so legacy no-id hook installs deduplicate cleanly on the first reinstall instead of the second. Added stable hook ids to `hooks/hooks.json`, semantic fallback aliases in `mergeHookEntries()`, and a regression test covering upgrade from pre-id settings.
- 2026-04-01: Collapsed the obvious command/skill duplicates into thin legacy shims so `skills/` now hold the maintained bodies for NanoClaw, context-budget, DevFleet, docs lookup, E2E, evals, orchestration, prompt optimization, rules distillation, TDD, and verification.
- 2026-04-01: Ported the self-contained core of `#844` directly into `main` as `skills/ui-demo/SKILL.md` and registered it under the `media-generation` install module instead of merging the PR wholesale.
- 2026-04-01: Added the first connected-workflow operator lane as ECC-native skills instead of leaving the surface as raw plugins or APIs: `workspace-surface-audit`, `customer-billing-ops`, `project-flow-ops`, and `google-workspace-ops`. These are tracked under the new `operator-workflows` install module.
- 2026-04-01: Direct-ported the real fix from the unresolved hook-path PR lane into the active installer. Claude installs now replace `${CLAUDE_PLUGIN_ROOT}` with the concrete install root in both `settings.json` and the copied `hooks/hooks.json`, which keeps PreToolUse/PostToolUse hooks working outside plugin-managed env injection.
- 2026-04-01: Replaced the GNU-only `grep -P` parser in `scripts/sync-ecc-to-codex.sh` with a portable Node parser for Context7 key extraction. Added source-level regression coverage so BSD/macOS syncs do not drift back to non-portable parsing.
- 2026-04-01: Targeted regression suite after the direct ports is green: `tests/scripts/install-apply.test.js`, `tests/scripts/sync-ecc-to-codex.test.js`, and `tests/scripts/codex-hooks.test.js`.
- 2026-04-01: Ported the useful core of `#1107` directly into `main` as an add-only Codex baseline merge. `scripts/sync-ecc-to-codex.sh` now fills missing non-MCP defaults from `.codex/config.toml`, syncs sample agent role files into `~/.codex/agents`, and preserves user config instead of replacing it. Added regression coverage for sparse configs and implicit parent tables.
- 2026-04-01: Ported the safe low-risk cleanup from `#1119` directly into `main` instead of keeping an obsolete CI PR open. This included `.mjs` eslint handling, stricter null checks, Windows home-dir coverage in bash-log tests, and longer Trae shell-test timeouts.
- 2026-04-01: Added `brand-voice` as the canonical source-derived writing-style system and wired the content lane to treat it as the shared voice source of truth instead of duplicating partial style heuristics across skills.
- 2026-04-01: Added `connections-optimizer` as the review-first social-graph reorganization workflow for X and LinkedIn, with explicit pruning modes, browser fallback expectations, and Apple Mail drafting guidance.
- 2026-04-01: Added `manim-video` as the reusable technical explainer lane and seeded it with a starter network-graph scene so launch and systems animations do not depend on one-off scratch scripts.
- 2026-04-02: Re-extracted `social-graph-ranker` as a standalone primitive because the weighted bridge-decay model is reusable outside the full lead workflow. `lead-intelligence` now points to it for canonical graph ranking instead of carrying the full algorithm explanation inline, while `connections-optimizer` stays the broader operator layer for pruning, adds, and outbound review packs.
- 2026-04-02: Applied the same consolidation rule to the writing lane. `brand-voice` remains the canonical voice system, while `content-engine`, `crosspost`, `article-writing`, and `investor-outreach` now keep only workflow-specific guidance instead of duplicating a second Affaan/ECC voice model or repeating the full ban list in multiple places.
- 2026-04-02: Closed fresh auto-generated bundle PRs `#1182` and `#1183` under the existing policy. Useful ideas from generator output must be ported manually into canonical repo surfaces instead of merging `.claude`/bundle PRs wholesale.
- 2026-04-02: Ported the safe one-file macOS observer fix from `#1164` directly into `main` as a POSIX `mkdir` fallback for `continuous-learning-v2` lazy-start locking, then closed the PR as superseded by direct port.
- 2026-04-02: Ported the safe core of `#1153` directly into `main`: markdownlint cleanup for orchestration/docs surfaces plus the Windows `USERPROFILE` and path-normalization fixes in `install-apply` / `repair` tests. Local validation after installing repo deps: `node tests/scripts/install-apply.test.js`, `node tests/scripts/repair.test.js`, and targeted `yarn markdownlint` all passed.
- 2026-04-02: Direct-ported the safe web/frontend rules lane from `#1122` into `rules/web/`, but adapted `rules/web/hooks.md` to prefer project-local tooling and avoid remote one-off package execution examples.
- 2026-04-02: Adapted the design-quality reminder from `#1127` into the current ECC hook architecture with a local `scripts/hooks/design-quality-check.js`, Claude `hooks/hooks.json` wiring, Cursor `after-file-edit.js` wiring, and dedicated hook coverage in `tests/hooks/design-quality-check.test.js`.
- 2026-04-02: Fixed `#1141` on `main` in `16e9b17`. The observer lifecycle is now session-aware instead of purely detached: `SessionStart` writes a project-scoped lease, `SessionEnd` removes that lease and stops the observer when the final lease disappears, `observe.sh` records project activity, and `observer-loop.sh` now exits on idle when no leases remain. Targeted validation passed with `bash -n`, `node tests/hooks/observer-memory.test.js`, `node tests/integration/hooks.test.js`, `node scripts/ci/validate-hooks.js hooks/hooks.json`, and `node scripts/ci/check-unicode-safety.js`.
- 2026-04-02: Fixed the remaining Windows-only hook regression behind `#1070` by making `scripts/lib/utils.js#getHomeDir()` honor explicit `HOME` / `USERPROFILE` overrides before falling back to `os.homedir()`. This restores test-isolated observer state paths for hook integration runs on Windows. Added regression coverage in `tests/lib/utils.test.js`. Targeted validation passed with `node tests/lib/utils.test.js`, `node tests/integration/hooks.test.js`, `node tests/hooks/observer-memory.test.js`, and `node scripts/ci/check-unicode-safety.js`.
- 2026-04-02: Direct-ported NestJS support for `#1022` into `main` as `skills/nestjs-patterns/SKILL.md` and wired it into the `framework-language` install module. Synced the repo catalog afterward (`38` agents, `72` commands, `156` skills) and updated the docs so NestJS is no longer listed as an unfilled framework gap.
- 2026-04-05: Shipped `846ffb7` (`chore: ship v1.10.0 release surface refresh`). This updated README/plugin metadata/package versions, synced the explicit plugin agent inventory, bumped stale star/fork/contributor counts, created `docs/releases/1.10.0/*`, tagged and released `v1.10.0`, and posted the announcement discussion at `#1272`.
- 2026-04-05: Salvaged the reusable Hermes-branch operator skills in `6eba30f` without replaying the full branch. Added `skills/github-ops`, `skills/knowledge-ops`, and `skills/hookify-rules`, wired them into install modules, and re-synced the repo to `159` skills. `knowledge-ops` was explicitly adapted to the current workspace model: live code in cloned repos, active truth in GitHub/Linear, broader non-code context in the KB/archive layers.
- 2026-04-05: Fixed the remaining OpenCode npm-publish gap in `db6d52e`. The root package now builds `.opencode/dist` during `prepack`, includes the compiled OpenCode plugin assets in the published tarball, and carries a dedicated regression test (`tests/scripts/build-opencode.test.js`) so the package no longer ships only raw TypeScript source for that surface.
- 2026-04-05: Added `skills/council`, direct-ported the safe `code-tour` lane from `#1193`, and re-synced the repo to `162` skills. `code-tour` stays self-contained and only produces `.tours/*.tour` artifacts with real file/line anchors; no external runtime or extension install is assumed inside the skill.
- 2026-04-05: Closed the latest auto-generated ECC bundle PR wave (`#1275`-`#1281`) after deploying `ECC-Tools/main` fix `f615905`, which now blocks repo-level issue-comment `/analyze` requests from opening repeated bundle PRs while still allowing PR-thread retry analysis to run against immutable head SHAs.
- 2026-04-05: Filled the SEO gap by direct-porting `agents/seo-specialist.md` and `skills/seo/SKILL.md` into `main`, then wiring `skills/seo` into `business-content`. This resolves the stale `team-builder` reference to an SEO specialist and brings the public catalog to `39` agents and `163` skills without merging the stale PR wholesale.
- 2026-04-05: Salvaged the useful common-rule deltas from `#1214` directly into `rules/common/coding-style.md` and `rules/common/testing.md` (KISS/DRY/YAGNI reminders, naming conventions, code-smell guidance, and AAA-style test guidance), then closed the original mixed deletion PR. The broad skill removals in that PR were intentionally not replayed.
- 2026-04-05: Fixed the stale-row bug in `.github/workflows/monthly-metrics.yml` with `bf5961e`. The workflow now refreshes the current month row in issue `#1087` instead of early-returning when the month already exists, and the dispatched run updated the April snapshot to the current star/fork/release counts.
- 2026-04-05: Recovered the useful cost-control workflow from the divergent Hermes branch as a small ECC-native operator skill instead of replaying the branch. `skills/ecc-tools-cost-audit/SKILL.md` is now wired into `operator-workflows` and focused on webhook -> queue -> worker tracing, burn containment, quota bypass, premium-model leakage, and retry fanout in the sibling `ECC-Tools` repo.
- 2026-04-05: Added `skills/council/SKILL.md` in `753da37` as an ECC-native four-voice decision workflow. The useful protocol from PR `#1254` was retained, but the shadow `~/.claude/notes` write path was explicitly removed in favor of `knowledge-ops`, `/save-session`, or direct GitHub/Linear updates when a decision delta matters.
- 2026-04-05: Direct-ported the safe `globals` bump from PR `#1243` into `main` as part of the council lane and closed the PR as superseded.
- 2026-04-05: Closed PR `#1232` after full audit. The proposed `skill-scout` workflow overlaps current `search-first`, `/skill-create`, and `skill-stocktake`; if a dedicated marketplace-discovery layer returns later it should be rebuilt on top of the current install/catalog model rather than landing as a parallel discovery path.
- 2026-04-05: Ported the safe localized README switcher fixes from PR `#1209` directly into `main` rather than merging the docs PR wholesale. The navigation now consistently includes `Português (Brasil)` and `Türkçe` across the localized README switchers, while newer localized body copy stays intact.
- 2026-04-05: Removed the stale InsAIts shipped surface from `main`. ECC no longer ships the external Python MCP entry, opt-in hook wiring, wrapper/monitor scripts, or current docs mentions for `insa-its`; changelog history remains, but the live product surface is now fully ECC-native again.
- 2026-04-05: Salvaged the reusable Hermes-generated operator workflow lane without replaying the whole branch. Added six ECC-native top-level skills instead of the old nested `skills/hermes-generated/*` tree: `automation-audit-ops`, `email-ops`, `finance-billing-ops`, `messages-ops`, `research-ops`, and `terminal-ops`. `research-ops` now wraps the existing research stack, while the other five extend `operator-workflows` without introducing any external runtime assumptions.
- 2026-04-05: Added `skills/product-capability` plus `docs/examples/product-capability-template.md` as the canonical PRD-to-SRS lane for issue `#1185`. This is the ECC-native capability-contract step between vague product intent and implementation, and it lives in `business-content` rather than spawning a parallel planning subsystem.
- 2026-04-05: Tightened `product-lens` so it no longer overlaps the new capability-contract lane. `product-lens` now explicitly owns product diagnosis / brief validation, while `product-capability` owns implementation-ready capability plans and SRS-style constraints.
- 2026-04-05: Continued `#1213` cleanup by removing stale references to the deleted `project-guidelines-example` skill from exported inventory/docs and marking `continuous-learning` v1 as a supported legacy path with an explicit handoff to `continuous-learning-v2`.
- 2026-04-05: Removed the last orphaned localized `project-guidelines-example` docs from `docs/ko-KR` and `docs/zh-CN`. The template now lives only in `docs/examples/project-guidelines-template.md`, which matches the current repo surface and avoids shipping translated docs for a deleted skill.
- 2026-04-05: Landed `skills/agent-sort` and the legacy `/agent-sort` shim from issue `#916` as an ECC-native selective-install workflow. It classifies agents, skills, commands, rules, hooks, and extras into DAILY vs LIBRARY buckets using concrete repo evidence, then hands off installation changes to `configure-ecc` instead of inventing a parallel installer. Catalog truth is now `39` agents, `73` commands, and `179` skills.
- 2026-04-05: Direct-ported the safe README-only `#1285` slice into `main` instead of merging the branch: added a small `Community Projects` section so downstream teams can link public work built on ECC without changing install, security, or runtime surfaces. Rejected `#1286` at review because it adds an external third-party GitHub Action (`hashgraph-online/codex-plugin-scanner`) that does not meet the current supply-chain policy.
- 2026-04-05: Re-audited `origin/feat/hermes-generated-ops-skills` by full diff. The branch is still not mergeable: it deletes current ECC-native surfaces, regresses packaging/install metadata, and removes newer `main` content. Continued the selective-salvage policy instead of branch merge.
- 2026-04-05: Selectively salvaged `skills/frontend-design` from the Hermes branch as a self-contained ECC-native skill, mirrored it into `.agents`, wired it into `framework-language`, and re-synced the catalog to `180` skills after validation. The branch itself remains reference-only until every remaining unique file is either ported intentionally or rejected.
- 2026-04-05: Selectively salvaged the `hookify` command bundle plus the supporting `conversation-analyzer` agent from the Hermes branch. `hookify-rules` already existed as the canonical skill; this pass restores the user-facing command surfaces (`/hookify`, `/hookify-help`, `/hookify-list`, `/hookify-configure`) without pulling in any external runtime or branch-wide regressions. Catalog truth is now `40` agents, `77` commands, and `180` skills.
- 2026-04-05: Selectively salvaged the self-contained review/development bundle from the Hermes branch: `review-pr`, `feature-dev`, and the supporting analyzer/architecture agents (`code-architect`, `code-explorer`, `code-simplifier`, `comment-analyzer`, `pr-test-analyzer`, `silent-failure-hunter`, `type-design-analyzer`). This adds ECC-native command surfaces around PR review and feature planning without merging the branch's broader regressions. Catalog truth is now `47` agents, `79` commands, and `180` skills.
- 2026-04-05: Ported `docs/HERMES-SETUP.md` from the Hermes branch as a sanitized operator-topology document for the migration lane. This is docs-only support for `#1051`, not a runtime change and not a sign that the Hermes branch itself is mergeable.
- 2026-04-05: Finished the useful salvage pass over `origin/feat/hermes-generated-ops-skills`. The remaining unique files were explicitly rejected:
  - duplicate git helper commands (`commit`, `commit-push-pr`, `clean-gone`) overlap current checkpoint / publish flows
  - `scripts/hooks/security-reminder*` adds a new Python-backed hook path not justified by current runtime policy
  - `skills/oura-health` and `skills/pmx-guidelines` are user- or project-specific, not canonical ECC surfaces
  - `docs/releases/2.0.0-preview/*` is premature collateral and should be rebuilt from current product truth later
  - nested `skills/hermes-generated/*` is superseded by the top-level ECC-native operator skills already ported to `main`
- 2026-04-08: Fixed the command-export regression reported in `#1327` by restoring a canonical `commands:` section in `agent.yaml` and adding `tests/ci/agent-yaml-surface.test.js` to enforce exact parity between the YAML export surface and the real `commands/` directory. Verified with the full repo test sweep: `1764/1764` passing.
