# ECC v2.0.0-rc.1 Publication Evidence - 2026-05-18

This is release-readiness evidence only. It does not create a GitHub release,
npm publication, plugin tag, marketplace submission, or announcement post.

## Source Commit

| Field | Evidence |
| --- | --- |
| Upstream main | `4470e2e6702f17099d6feb137ba03ff00582c202` |
| Git remote | `https://github.com/affaan-m/everything-claude-code.git` |
| Evidence scope | Current `main` after PR #1970 workflow-security validator bypass fixes, PR #1971 metrics bridge cost-reporting fixes, PR #1972 `uncloud` skill merge, PR #1973 stale script cleanup, issue #1974 cost-reporting verification/closure, PR #1976 OpenAI/AstraFlow provider response guards, PR #1978 review/closure, catalog/operator dashboard refresh, ECC-Tools Wrangler OAuth billing readback mirror, AgentShield `840952a` fleet-ticket and Mini Shai-Hulud IOC evidence mirror, Mini Shai-Hulud/TanStack protection recheck, defensive-deny IOC scanner hardening, release name/plugin publication checklist, readiness/smoke gate enforcement for that checklist, release OIDC publishing-scope hardening, workflow line-ending normalization, current-head CI/security scan, work-items sync, Linear progress sync, the ITO-46 publication-path dry-run refresh, ITO-46 Linear closure, and the post-closure operator dashboard refresh |
| Local status caveat | `git status --short --branch` was clean at dashboard generation time; generated evidence files are committed after the source snapshot they describe |

The actual release operator should repeat all publish-facing checks from the
final release commit with a strictly clean checkout before publishing.

## Queue And Discussion State

| Surface | Command | Result |
| --- | --- | --- |
| Trunk PRs | `gh pr list --limit 100 --json number,title,state,author,updatedAt,url` | 0 open PRs |
| Trunk issues | `gh issue list --limit 100 --json number,title,state,updatedAt,url,labels` | 0 open issues |
| Discussion audit | `npm run discussion:audit -- --json` | Ready; 58 sampled discussions in `affaan-m/everything-claude-code`, 0 needing maintainer touch, 0 answerable discussions missing accepted answer, and 0 fetch errors |
| Platform audit | `node scripts/platform-audit.js --json --allow-untracked docs/drafts/` | Ready; tracked repos report 0 open PRs, 0 open issues, 0 discussion maintainer-touch gaps, 0 answerable Q&A missing accepted answers, and 0 blocking dirty files |
| Work-items sync | `node scripts/work-items.js sync-github --repo <tracked-repo>` for five tracked repos; `node scripts/status.js --json`; `node scripts/work-items.js list --json` | All five tracked repos synced with 0 open PRs/issues and no changed work items; local status reports 0 open, 0 blocked, and 0 closed work items |
| Operator dashboard | `npm run operator:dashboard -- --markdown --write docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-18.md` | Regenerated at `4470e2e6702f17099d6feb137ba03ff00582c202`; dashboard ready true, publication ready false because release, npm, plugin, billing, and announcement gates are approval-gated; 0 PRs, 0 issues, and 0 discussion gaps remain across tracked repos; AgentShield enterprise evidence includes `840952a`; ECC Tools native-payments gate now names the narrowed ITO-61 blocker: create or verify Marketplace-managed Pro target billing-state with webhook provenance, configure the target account and `INTERNAL_API_SECRET`, then rerun target readback and the live announcement gate |

Tracked repositories in the platform audit and work-items sync were:

- `affaan-m/everything-claude-code`
- `affaan-m/agentshield`
- `affaan-m/JARVIS`
- `ECC-Tools/ECC-Tools`
- `ECC-Tools/ECC-website`

## Merge And Triage Batch

| Item | Result |
| --- | --- |
| PR #1970 | Merged workflow-security validator fixes for quoted `write-all` and `refs/pull/*` checkout bypasses; main includes `e06d0382` and `7bb31720` from that slice |
| PR #1971 | Merged metrics bridge cost-reporting fixes, full costs-file scan behavior, and persistent warning de-duplication across hook subprocesses; main includes commits through `9b1d8918` |
| PR #1972 | Merged `skills/uncloud/SKILL.md` with activation structure and uncloud command references; main includes `8b6aed0`, `2e5f30f`, and `caee7cf` |
| PR #1973 | Merged stale `skills/strategic-compact/suggest-compact.sh` removal after confirming the active hook is `scripts/hooks/suggest-compact.js`; remote main includes `812d4d06` |
| Issue #1974 | Closed after verifying current `origin/main` already reads the latest cumulative metrics bridge cost row and focused cost/metrics tests pass |
| Catalog/operator refresh | Pushed `81fca2ce` to refresh generated catalog count, URL ledger, and operator dashboard state after #1973/#1974 |
| PR #1976 | Merged provider response hardening for OpenAI-compatible and AstraFlow providers; main includes `eb0d8939` follow-up guards for empty/filtered provider choices, missing OpenAI `response.usage`, shared filtered-response error text, and credential-less provider construction validation |
| Provider guard validation | `uv run --extra dev pytest -q tests/test_provider_tools.py tests/test_astraflow_provider.py`, `uv run --extra dev pytest -q`, `node tests/run-all.js`, and `git diff --check` passed before merging #1976 follow-up into main: 11 provider-focused Python tests, 76 full Python tests, 2509 Node tests, and clean whitespace checks |
| Defensive-deny IOC scanner hardening | Pushed `04d4d819` so explicit Claude `permissions.deny` IOC entries are treated as defensive controls while the same IOC still fails in hooks, tasks, scripts, locks, and payload files; local `npm test` passed 2511/2511 and current-head CI `26017368895` passed 37/37 |
| Release name/plugin publication checklist | Pushed `6c0fbfb6` to add `docs/releases/2.0.0-rc.1/release-name-plugin-publication-checklist-2026-05-18.md`; the artifact freezes rc.1 as Everything Claude Code / ECC, keeps npm `ecc-universal`, keeps Claude/Codex plugin slug `ecc`, cites current Anthropic/OpenAI plugin publication paths, and blocks rename/npm publish/plugin tag/submission/billing/social actions until final release evidence exists; GitHub Actions CI `26034898420` passed |
| Dashboard and preview-pack checklist enforcement | Added `680aeff0` so `scripts/operator-readiness-dashboard.js` and `scripts/preview-pack-smoke.js` require the release-name/plugin publication checklist; local dashboard and smoke tests passed and preview-pack smoke now enforces 26 required artifacts |
| AgentShield enterprise evidence mirror | Added `2ba0c62d` and refreshed the dashboard generator/GA roadmap/AgentShield enterprise roadmap so the ECC release evidence names AgentShield `840952a` fleet review ticket payloads and current Mini Shai-Hulud IOC breadcrumb coverage |
| PR #1978 | Closed broad/failing outside Excel harness PR after review; recorded a corrected split path for a future smaller Excel harness proposal, install-target/tooling PR, plugin-runtime PR, and translation-automation PR |
| Announcement draft tracking | Added `docs/drafts/release-1.10.1-announcement.md` so the stabilization announcement draft is tracked instead of remaining as release-blocking untracked local state |
| Clean-worktree preview-pack smoke | Detached worktree at `680aeff0fb9a8598858e3105ba4742973ef386ab`; `node scripts/preview-pack-smoke.js --root <worktree> --format json` passed 5/5 with digest `0ed831dbd0cf`; 26 required artifacts, final verification commands, Hermes public sanitization boundary, and approval-gated publication blockers were all preserved |
| Public queues | Rechecked after the merge and issue-closure batch; 0 PRs, 0 issues, and 0 discussion gaps remain across tracked repos |
| Release OIDC publishing scope | Pushed `7911af4a` to keep the release workflow's trusted-publishing path scoped to release publication instead of broadening OIDC permissions across unrelated jobs; local workflow security validation passed |
| Release workflow normalization | Pushed `97567a91` to normalize release workflow line endings after the OIDC hardening slice; current-head CI `26050727969` passed for `97567a91e79e1ee4c291eb78f5f9c30c2046ac94` |
| Operator readiness evidence refresh | Pushed `0f1775e3`, `fe7b4f2b`, and `67e63e63` to refresh blocker evidence, regenerate the operator dashboard, and align publication readiness to the latest CI/security evidence; pushed `4470e2e6` to close ITO-46 publication-path evidence, then regenerated the dashboard at `4470e2e6702f17099d6feb137ba03ff00582c202`; current-head CI `26057806361` passed for `4470e2e6702f17099d6feb137ba03ff00582c202` |

## Supply-Chain And Security Evidence

| Gate | Command | Result |
| --- | --- | --- |
| Repo IOC scan | `npm run security:ioc-scan` | Passed; 198 files inspected |
| Home persistence IOC scan | `node scripts/ci/scan-supply-chain-iocs.js --home --json` | Passed; 200 files inspected; `findings: []` |
| ECC workspace IOC recheck | `node scripts/ci/scan-supply-chain-iocs.js --root <local ECC root> --home --json` | Passed; 1212 files inspected; `findings: []`; exact local path is kept out of public release evidence |
| Narrow active persistence sweep | Targeted search over user-level Claude, VS Code, LaunchAgent/systemd, local-bin, `/tmp`, and `/private/tmp` campaign paths | Existing active targets: 2; no campaign marker hits |
| Scanner fixture tests | `node tests/ci/scan-supply-chain-iocs.test.js` | 20 passed, 0 failed, including defensive Claude deny-wall pass and hook-with-same-IOC fail-closed coverage |
| Advisory source refresh | `node scripts/ci/supply-chain-advisory-sources.js --refresh --json` | Ready with 9 sources; live refresh produced 1 OpenAI URL warning from Node fetch while primary TanStack, GitHub advisory, StepSecurity, Wiz, Socket, npm, and CISA sources returned OK |
| No-lifecycle install | `npm ci --ignore-scripts` | Completed cleanly; 213 packages installed, 0 vulnerabilities |
| npm audit | `npm audit --audit-level=high` | 0 vulnerabilities |
| npm signatures | `npm audit signatures` | 213 verified registry signatures; 17 verified attestations |
| Workflow security | `node scripts/ci/validate-workflow-security.js` | Validated 8 workflow files after the release OIDC publishing-scope hardening |
| AgentShield project scan | `npx --no-install ecc-agentshield scan --format json` | Grade A / 99; 0 critical, 0 high, 0 medium; 6 low docs-example skill telemetry/governance findings |
| Current-head CI security scan | `gh run view 26057806361 --repo affaan-m/everything-claude-code --json status,conclusion,headSha,jobs,url` | Completed successfully for `4470e2e6702f17099d6feb137ba03ff00582c202`; 37/37 CI jobs passed, including lint, workflow/component validation, coverage, cross-platform package-manager tests, npm audit, and supply-chain IOC scan |
| Latest Supply-Chain Watch | `gh run view 26010432490 --repo affaan-m/everything-claude-code --json status,conclusion,headSha,url` | Completed successfully for `25ac57ac40e9fc5a0606e76e6339e72c79748c99`; rerun from the final release commit before publication |

## ITO-46 Publication Path Refresh

| Gate | Command | Result |
| --- | --- | --- |
| Clean publication-path baseline | `git status --short --branch`; `git rev-parse HEAD`; `git remote get-url origin` | Clean `main` at `67e63e63f9bfd074bd6a21bf6bac71f3dfefa58b`; remote `https://github.com/affaan-m/everything-claude-code.git` |
| Package/plugin identity readback | `node -p "JSON.stringify({pkg, claude, codex, opencode}, null, 2)"` | `ecc-universal@2.0.0-rc.1`; Claude plugin `ecc@2.0.0-rc.1`; Codex plugin `ecc@2.0.0-rc.1`; OpenCode package `ecc-universal@2.0.0-rc.1` |
| Name availability | `npm view ecc name version description repository.url --json`; `npm view @affaan-m/ecc name version --json`; `npm view ecc-universal name version dist-tags --json` | `ecc` is occupied by unrelated `ecc@0.0.2`; `@affaan-m/ecc` returns 404; `ecc-universal` registry latest remains `1.10.0` with no `next` dist-tag |
| Plugin manifest tests | `node tests/plugin-manifest.test.js` | 54 passed, 0 failed |
| Release surface tests | `node tests/docs/ecc2-release-surface.test.js` | 21 passed, 0 failed |
| Claude plugin validation | `claude plugin validate .claude-plugin/plugin.json`; `claude plugin validate .`; `claude plugin tag .claude-plugin --dry-run` | Claude Code `2.1.143`; manifest validation passed; full plugin validation passed with one expected root `CLAUDE.md` context warning; tag dry run would create `ecc--v2.0.0-rc.1` |
| Claude marketplace source help | `claude plugin marketplace add --help`; `claude plugin marketplace update --help` | Marketplace add supports URL, local path, GitHub repo, `--scope`, and `--sparse`; update supports targeted or all-marketplace refresh |
| Codex marketplace help | `codex plugin marketplace add --help` | Codex CLI `0.131.0`; marketplace add supports local paths, `owner/repo[@ref]`, HTTPS Git URL, SSH Git URL, `--ref`, and `--sparse` |
| Codex local marketplace smoke | `HOME="$(mktemp -d)" codex plugin marketplace add ./` | Added marketplace `ecc` from the local checkout without touching the real Codex config |
| Codex GitHub-ref marketplace smoke | `HOME="$(mktemp -d)" codex plugin marketplace add affaan-m/everything-claude-code --ref "$(git rev-parse HEAD)"` | Added marketplace `ecc` from the public GitHub repo pinned to `67e63e63f9bfd074bd6a21bf6bac71f3dfefa58b` without touching the real Codex config |
| npm package dry-run | `NPM_CONFIG_USERCONFIG=/dev/null npm pack --dry-run --json`; `NPM_CONFIG_USERCONFIG=/dev/null npm publish --tag next --dry-run` | Pack produced `ecc-universal-2.0.0-rc.1.tgz`, 2228 files, 4,348,504 bytes packed, 13,024,929 bytes unpacked, shasum `29d6a17029d80f5cb1df068880ba86c55a5d60f1`; publish dry-run would publish `ecc-universal@2.0.0-rc.1` with tag `next` |
| OpenCode package build | `npm run build:opencode` | Passed |
| Preview pack smoke | `npm run preview-pack:smoke` | Ready yes; digest `0ed831dbd0cf`; 5 passed, 0 failed |
| Official docs check | Anthropic `https://code.claude.com/docs/en/plugins` and `https://code.claude.com/docs/en/plugin-marketplaces`; OpenAI `https://developers.openai.com/codex/plugins/build` | Anthropic documents self-hosted marketplace sources; OpenAI documents repo/personal marketplaces and the official Plugin Directory. ECC has not created a real release tag, official listing, or npm publication in this pass |
| ITO-46 closure | Linear ITO-46 comment `9ef92056-ab23-4eed-bfdb-932dddc2b056`; Linear issue status `Done`; GitHub Actions `26057806361` | Publication-path docs now record every channel, name conflicts, package/plugin dry-run commands, and blocker register; Codex repo-marketplace distribution is verified but official Plugin Directory listing is not claimed before OpenAI submission/listing evidence |

## Linear Progress Sync

| Surface | Evidence |
| --- | --- |
| ITO-57 issue comments | `0b9931b9-1556-4ebc-a70c-f3635557625d` records May 18 queue counts, #1970/#1971/#1972/#1976 merge evidence, supply-chain verification, current-head CI URL, deferred gates, and next slices; reply `6fa15367-d994-4e53-ade3-9462477e1100` records the expanded TanStack/Mini Shai-Hulud recheck, defensive-deny scanner fix, current-head CI `26017368895`, and post-push platform audit; comment `3fe5b2b7-c4fe-401c-a317-b40d72119cb3` records the final emergency refresh against `97567a91`, AgentShield `4e36aab`, clean ECC/Ito/Documents workspace IOC scans, absent dead-man/persistence artifacts, and package-manager/Claude deny-wall posture; comment `43837404-c01c-4aaa-b5e2-1e784c136d69` records ECC-Tools `brace-expansion` alert 44 fixed in `e56fc1a` with CI `26054671308` and Dependabot API `state: fixed` |
| ITO-52 issue status | `f2e5a208-de91-4a3a-960b-5362d12aa5a4` records ECC-Tools `69ca535` team-learning feedback controls, local verification, and CI `26054455434`; Linear ITO-52 is Done |
| ITO-61 issue status | `6904e4fb-bec7-4787-90e2-759f077a628c` records the narrowed native-payments readback blocker: Wrangler OAuth now works, aggregate readback is clean, but there is still no Marketplace-managed Pro target billing-state with webhook provenance and the local announcement preflight is missing the target account plus `INTERNAL_API_SECRET` |
| ECC platform project comment | `e32e5b7a-287b-4bf4-9ed7-314389a157e1` records the earlier current public queue, security, #1976, and remaining-gate state at the project level; follow-up ITO-44 comments `a01eeef3-c69b-48c0-8804-a4682acfc1ef` and `6b0885cc-c4e9-40db-899b-f7b88b4aa046` record ITO-52 completion and the fixed ECC-Tools Dependabot alert |
| Project status update caveat | Linear returned "Project status updates are not enabled for this workspace"; project comment was used as the supported status surface |

## Current Publication Blockers

- GitHub prerelease `v2.0.0-rc.1` is still not created in this pass.
- npm `ecc-universal@2.0.0-rc.1` is still not published to the `next`
  dist-tag.
- Claude plugin tag and marketplace propagation remain approval-gated.
- Codex repo-marketplace distribution is verified for rc.1, but official
  Plugin Directory publishing remains blocked on OpenAI's self-serve publishing
  surface.
- ECC Tools billing/native-payments copy remains blocked until a Marketplace
  Pro purchase/webhook path writes ready production `billing-state:*`
  provenance for the target Marketplace test account, then
  `npm run billing:kv-readback -- --account <github-login> --require-ready`
  with working Cloudflare API auth or repaired Wrangler OAuth, followed by
  `npm run billing:announcement-gate -- --account <github-login>`, return
  announcement-ready gates. The latest Wrangler OAuth aggregate readback found
  256 `account-billing:*` records, 256 `billing-state:*` records, 197
  Marketplace-source records, 59 Stripe-source records, 53 Pro records, 4
  Marketplace webhook-provenance records, all `Open Source`, 0 Marketplace Pro
  states, 0 ready-like Marketplace Pro states, and 0 parse failures. ECC-Tools
  commit `632e059` adds the follow-up target-account readback mode, redacts
  the account login and raw KV key names, and requires both target key families
  before `--require-ready` can pass. ECC-Tools commit `13cd3fc` normalizes
  billing-state key casing. The latest ITO-61 retry fails because no
  Marketplace-managed Pro state exists and the announcement preflight is
  missing the target account plus `INTERNAL_API_SECRET`; Linear ITO-61 tracks
  the exact target-account acceptance criteria.
- Release notes, X, LinkedIn, GitHub release, and longform copy still need final
  live URLs after release/package/plugin URLs exist.
- The local checkout is clean after the dashboard/evidence refresh, but a
  strict clean-checkout release pass remains required before real publication.

## Result

The tracked public PR queue, issue queue, discussion queue, local work-items
bridge, release-name/plugin publication gate, and Mini Shai-Hulud/TanStack
protection loop are current on May 18, 2026 for current `main` through
`97567a91`, with follow-up ECC Tools billing-gate hardening in `632e059`
and AgentShield enterprise/security hardening through `4e36aab`.
This improves publication readiness but does not replace the approval-gated
release, package, plugin, billing, and announcement steps in
`publication-readiness.md`.
