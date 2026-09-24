# ECC v2.0.0-rc.1 Publication Evidence - 2026-05-19

This is release-readiness evidence only. It does not create a GitHub release,
npm publication, plugin tag, marketplace submission, billing announcement, or
social announcement.

## Source Commit

| Field | Evidence |
| --- | --- |
| Upstream main | `c2471fe5c535310f8a8008c9ed7ea9f6757b33f2` |
| Git remote | `https://github.com/affaan-m/ECC.git` |
| Evidence scope | Current `main` after PR #1990 harness-audit GitHub integration scoring, PR #1991 canonical ECC identity gate, PR #1992 release video-suite gate, PR #1993 growth outreach pack, PR #1994 May 19 publication evidence refresh, PR #1995 operator dashboard refresh, PR #1996 primary render self-eval gate, PR #1997 publish-candidate gate, PR #1998 visual QA gate, PR #1999 video dashboard evidence refresh, PR #2000 suite-count evidence refresh, PR #2001 owner approval packet addition, PR #2002 owner approval dashboard gate refresh, PR #2004 Linear readiness evidence sync, PR #2005 post-PR #2004 evidence refresh, PR #2008 release supply-chain evidence gate fix, PR #2006 per-project Claude Code adapter, PR #2009 continuous-learning project registry hygiene fix, PR #2011 GateGuard quoted git introspection fix, PR #2013 deterministic release approval gate, PR #2017 AgentShield adapter evidence sync, PR #2018 AgentShield Dependabot evidence sync, ECC-Tools #80-#91 hosted observability/readback, Marketplace Pro selected-target, selected-target announcement gate, and env-file operator-path batch, AgentShield #94 Zed/VS Code adapter coverage, AgentShield #95 Dependabot alert closure, PR #2019 Marketplace Pro release-gate sync, and PR #2020 selected-target announcement gate sync |
| Local status caveat | `git status --short --branch` was clean after pulling `origin/main`; generated evidence files are committed after the source snapshot they describe |

The release operator must repeat all publish-facing checks from the exact final
release commit with a strictly clean checkout before publishing.

## Queue And Discussion State

| Surface | Command | Result |
| --- | --- | --- |
| Platform audit | `node scripts/platform-audit.js --json` | Ready true; tracked repos report 0 open PRs, 0 open issues, 0 discussion maintainer-touch gaps, 0 answerable Q&A gaps, 0 conflicting PRs, and 0 blocking dirty files |
| Trunk PRs | `gh pr list --repo affaan-m/ECC --state open --json number,title,url,author --limit 100` | `[]` |
| Trunk issues | `gh issue list --repo affaan-m/ECC --state open --json number,title,url,author --limit 100` | `[]` |
| Discussion audit through platform audit | `node scripts/platform-audit.js --json` | `affaan-m/ECC` discussions enabled; 60 sampled after #2015 setup-location Q&A was answered and accepted; 0 needing maintainer touch; 0 answerable without accepted answer |
| Worktree | `git status --short --branch` | `## main...origin/main` |

Tracked repositories in the platform audit were:

- `affaan-m/ECC`
- `affaan-m/agentshield`
- `affaan-m/JARVIS`
- `ECC-Tools/ECC-Tools`
- `ECC-Tools/ECC-website`

## Merge Batch

| Item | Result |
| --- | --- |
| PR #1990 | Merged GitHub integration harness-audit scoring and conflict salvage from the earlier unsafe PR lane |
| PR #1991 | Merged canonical ECC release identity gate across README, plugin/package metadata, OpenCode surfaces, Marketplace metadata, audit defaults, quickstart, release URL ledger, naming/publication matrix, and release tests |
| PR #1992 | Merged the release video-suite gate, production manifest, validator, package file surface, preview-pack smoke wiring, release-surface tests, and compact CI JSON output |
| PR #1993 | Merged the partner, sponsor, consulting, conference, podcast, GitHub Discussion, and video CTA pack for the hypergrowth outbound lane |
| PR #1994 | Merged the May 19 publication-evidence refresh, platform-audit evidence gate, preview-pack smoke evidence gate, and URL/readiness/roadmap references |
| PR #1995 | Merged the May 19 operator dashboard refresh with the `$1,728/mo` MRR baseline, `$10,000/mo` target, and release/video/outbound top actions |
| PR #1996 | Merged the primary launch render self-eval gate for duration, size, resolution, video stream, and audio stream checks |
| PR #1997 | Merged the publish-candidate gate for the primary launch MP4/captions plus five short clips in wide and vertical formats |
| PR #1998 | Merged the release video visual QA gate for publish candidates and black-frame segment detection |
| PR #1999 | Merged the operator dashboard refresh that moved the release video suite to current once publish-candidate evidence was recorded |
| PR #2000 | Merged the suite-count evidence refresh so the platform audit rejects stale local-suite totals |
| PR #2001 | Merged the final human decision sheet for release, package, plugin, video, billing, social, and outbound approvals; GitHub Actions run `26102500291` completed successfully |
| PR #2002 | Merged the owner-approval dashboard refresh so the operator dashboard fails closed when the final decision sheet is missing or incomplete; CI passed before merge |
| PR #2004 | Merged the May 19 Linear readiness evidence sync after PR #2002, including roadmap, dashboard, preview-pack manifest, publication evidence, operator dashboard generator, and release-surface test updates |
| PR #2005 | Merged the post-PR #2004 evidence refresh, keeping the May 19 readiness ledger, dashboard, roadmap, and release-surface references current on `main` |
| PR #2008 | Merged the release supply-chain evidence gate fix so platform-audit readiness keeps matching current publication evidence |
| PR #2006 | Merged the `claude-project` install target for per-project Claude Code adapter support, then fixed the manifest schema enum on top of the feature branch before merge |
| PR #2009 | Merged the continuous-learning project registry hygiene fix: non-git hook payloads stay global, no-remote linked worktrees migrate to the main worktree project ID, and `instinct-cli.py projects delete`, `merge`, and `gc` provide operator maintenance commands |
| PR #2011 | Merged the GateGuard read-only git introspection tokenizer fix so quoted `git show` pathspecs with spaces are preserved while quoted shell separators stay outside the bypass |
| PR #2013 | Merged the deterministic `release:approval-gate` so final publication, package, plugin, video, billing, social, and outbound actions remain blocked until owner decisions and live URL readbacks are complete |
| PR #2017 | Merged the AgentShield #94 evidence mirror as `906e06406e95742944ccb05065f95a7e4dd4a036`, syncing roadmap, publication evidence, preview-pack manifest, and supply-chain incident-response surfaces after full GitHub CI passed |
| PR #2018 | Merged the AgentShield #95 Dependabot evidence mirror as `68b4e45145968acd52e68d900f8422061ed7f4a2`, syncing the roadmap, publication evidence, and preview-pack manifest after full PR CI passed |
| PR #2019 | Merged the Marketplace Pro selected-target release-gate sync as `30f60710d4e0424fc70d9bbdc105009db141d9d8`, updating the roadmap, publication evidence, naming matrix, preview manifest, and operator dashboard after full PR CI passed |
| PR #2020 | Merged the selected-target announcement gate sync as `c2471fe5c535310f8a8008c9ed7ea9f6757b33f2`, updating the roadmap, publication evidence, naming matrix, preview manifest, release URL ledger, platform audit surfaces, and operator dashboard after full PR CI passed |

## Post-Queue-Zero Sync - 2026-05-19 Late Pass

| Surface | Evidence |
| --- | --- |
| ECC approval gate | PR #2013 merged as `9819626459a662773be7d0b1c18d82c1316b8c36`; GitHub Actions run `26128749863` completed successfully; `npm run release:approval-gate -- --format json` remains intentionally blocked with digest `ef8f49f727b7`, 4/6 passing, and failures only on owner decisions plus live URL readbacks |
| ECC platform audit | `node scripts/platform-audit.js --json` at `2026-05-19T22:45:15Z` returned ready true, 0 open PRs, 0 open issues, 0 discussion maintainer-touch gaps, 0 answerable Q&A gaps, and 0 dirty blockers across `affaan-m/ECC`, `affaan-m/agentshield`, `affaan-m/JARVIS`, `ECC-Tools/ECC-Tools`, and `ECC-Tools/ECC-website` |
| ECC-Tools billing hardening | ECC-Tools PR #79 merged as `67ee247ae1b7b50ecc1261ed5d62d65cc8390da8`; preflight and live billing-announcement output now redact account login values to a stable fingerprint while preserving readiness blockers/actions; local validation passed targeted tests, full test suite 678/678, lint, typecheck, manual preflight, and `git diff --check`; post-merge main CI run `26129253509` completed successfully |
| JARVIS queue drain | JARVIS PR #15 merged the Dependabot `idna` 3.11 to 3.15 security bump as `4b3685d6ee23b4da1f1a7d22281c6b5d6c0a42c7`; PR checks and post-merge CI/CodeQL passed |
| JARVIS deploy repair | JARVIS PR #16 merged as `4369c34babd21d539c420866da51c7a8365f1c9e`; the deploy workflow no longer uses an invalid job-level `secrets.*` condition, Vercel deploy skips cleanly when secrets are absent, backend image build/push succeeds, and main CI, CodeQL, and Deploy runs `26129539376`, `26129539427`, and `26129539425` completed successfully |
| Linear roadmap sync | Linear document `ecc-may-19-late-queue-zero-and-release-gate-sync-1c26f65e6b3f`, project comment `d42bf0e2-7a8e-4934-9f3f-e281498ee805`, and issue comments on ITO-44, ITO-50, ITO-54, ITO-56, and ITO-61 record the late-pass queue-zero, release-gate, billing-safety, and progress-sync state. |

## May 20 Hosted Observability And AgentShield Adapter Sync

| Surface | Evidence |
| --- | --- |
| ECC discussion queue | Discussion #2015 was answered and marked accepted with conservative setup guidance: do not install in `C:\`; use a normal workspace; install `ecc@ecc` once through the Claude plugin marketplace; copy only needed rule folders when using manual rules; do not stack plugin plus full manual install. |
| ECC platform audit | `node scripts/platform-audit.js --json` at `2026-05-20T00:25:38Z` returned ready true with 0 open PRs, 0 open issues, 0 discussion maintainer-touch gaps, 0 answerable Q&A gaps, 0 conflicting PRs, and 0 dirty blockers across `affaan-m/ECC`, `affaan-m/agentshield`, `affaan-m/JARVIS`, `ECC-Tools/ECC-Tools`, and `ECC-Tools/ECC-website`. |
| ECC platform audit recheck | `npm run platform:audit -- --json` at `2026-05-20T00:42:11Z` returned ready true with 0 open PRs, 0 open issues, 0 discussion maintainer-touch gaps, 0 answerable Q&A gaps, 0 conflicting PRs, 0 GitHub errors, and 0 dirty blockers across the same tracked repo set after AgentShield #94 merged. |
| ECC-Tools #80/#81/#82 | PR #80 merged runtime-receipt failure-reason enforcement as `4efc8cc858022f84c844690f3298633b081c4398`; PR #81 preserved AgentShield fleet approval IDs as `1fbf635f492284f75ba7166c029c39eb8cc15794`; PR #82 rendered those approval IDs in hosted security review comments/check-runs as `7a7b4d096a176ae80b3a2076c09d45601e36013a`. |
| ECC-Tools #83/#84 | PR #83 merged deterministic Linear external-ID reuse for deferred follow-ups as `b6b107f33961bef18a85fb619f3a976eb5d752dd`; PR #84 merged hosted AgentShield remediation sync to Linear as `73bac7058071c55cb30c6b8ac6db779b3660c02c`. Local validation covered focused route/client tests, typecheck, lint, full ECC-Tools test suite, and whitespace checks before merge; GitHub Verify, Security Audit, and Workers Builds passed. |
| ECC-Tools #85/#86/#87 | PR #85 merged hosted job observability events as `1637e0f2bfa0a889387f2c20675680ccc5528123`; PR #86 merged hosted status observability readback as `5a9e94d3ff860307c3e7fd9fd065f0de2bd633dd`; PR #87 merged hosted depth-plan observability readback as `508fbc02b63cf1fcb5af2f3624608fa66e53b5d4`. Local validation for the final depth-plan readback slice passed the focused hosted depth-plan route test, full route suite (89/89), typecheck, lint, full ECC-Tools Vitest suite (683/683), and `git diff --check`; GitHub Verify, Security Audit, and Workers Builds passed before merge. |
| ECC-Tools #88 | PR #88 merged authenticated hosted observability API readback as `c836ac3fb24ed7e2ae38cd61e41c9651ac9c00f8`. `GET /api/analysis/observability` now summarizes hosted events by event type and job for operator/dashboard readback, skips malformed stale KV records, and the deployment runbook includes the production smoke command. Local verification passed typecheck, lint, full ECC-Tools Vitest suite (686/686), and `git diff --check`; GitHub Verify, Security Audit, and Workers Builds passed before merge. |
| AgentShield #94 | PR #94 merged Zed/VS Code adapter coverage as `4caee27acfadb50a4cd024e738b5c3cbd4b0bb03`. AgentShield now reports Zed and VS Code as first-class harness adapters, discovers `.zed/settings.json`, `.zed/tasks.json`, and `.zed` hook-code files, and flags `.zed/setup.mjs` in the AI-tool persistence IOC rule alongside `.vscode/setup.mjs`. Local verification passed typecheck, lint, focused scanner/rule tests, full `npm test` (1822 tests), `npm run build`, and `git diff --check`; GitHub checks passed across GitGuardian, scan suite, self-scan, self-scan examples, Node 18/20/22 CI, CodeRabbit, and Cubic after rerunning a transient artifact-upload failure. |
| AgentShield #95 | PR #95 merged the `brace-expansion` Dependabot fix as `25d91f0002214c408da4ceaac7def20bad40ca10`. The lockfile now resolves vulnerable transitive `brace-expansion` 5.x entries to `5.0.6`, local `npm audit --audit-level=moderate` returns 0 vulnerabilities, and `gh api repos/affaan-m/agentshield/dependabot/alerts?state=open` returns `[]`. Local validation passed typecheck, lint, full `npm test` (1822 tests), build, audit, and whitespace checks; GitHub checks passed across Verify Node 18/20/22, self-scan, self-scan examples, Test GitHub Action, GitGuardian, CodeRabbit, and Cubic. |
| Linear roadmap sync | Linear ITO-54 comment `74dcc101-3be5-4173-be13-62b80d54f569` and ECC Platform Roadmap project comment `348ea8f5-2a2d-46d9-a0fe-ed99653e7fe5` record the May 20 hosted observability status/depth-plan readback batch; Linear comments `291e2a4b-06e3-4672-a057-cdb141478161` and `b2d35de0-ca49-44cb-982a-ddec229e7691` add the #88 observability API readback; Linear ITO-49 comment `faed69dd-35f5-469d-acb5-ddde6a70d6a1` and project comment `70187c1e-d481-4181-b418-09bd65d54b5e` add the #94 AgentShield Zed/VS Code adapter evidence; Linear ITO-49 comment `371fc3e4-611f-4d20-a23f-67db1260b418`, ITO-57 comment `bd06e252-15c1-4256-b667-caa3f64f5968`, and project comment `22c2c388-2fd1-4dea-a939-6141f40c9a21` add the #95 AgentShield Dependabot alert closure; earlier comments on ITO-54, ITO-48, and the project record the #84 hosted remediation sync and #85 hosted observability event emission batches. |

## May 20 Marketplace Pro Release-Gate Sync

| Surface | Evidence |
| --- | --- |
| ECC-Tools #89 | PR #89 merged as `512bca6b99cdaa67058a6aa9a4e7e7f0b1d9873a` after Verify, Security Audit, and Workers Builds passed. It added `billing:kv-readback -- --select-ready-target --require-ready`, allowing operators to select a ready Marketplace Pro target internally without passing or printing the login. |
| Live production readback | The 2026-05-20 Wrangler OAuth readback found ready-like Marketplace Pro records with webhook provenance, selected a target with both key families, seat and webhook readiness, no overage, and 0 blockers, with account details redacted. The old missing Marketplace Pro target-state blocker is cleared. |
| ECC #2019 | PR #2019 merged as `30f60710d4e0424fc70d9bbdc105009db141d9d8`, syncing the selected-target readback evidence into the GA roadmap, rc.1 publication evidence, naming matrix, preview manifest, and operator dashboard. |
| ECC-Tools #90 | PR #90 merged as `16a5bb33ee5ce7c31d2ad8d041e5afac03308f05` after Verify, Security Audit, and Workers Builds passed. It added the selected-target official announcement gate through `/api/billing/readiness?selectReadyTarget=1` and `npm run billing:announcement-gate -- --select-ready-target`, keeping the raw account login out of command logs. |
| ECC #2020 | PR #2020 merged as `c2471fe5c535310f8a8008c9ed7ea9f6757b33f2`, syncing ECC-Tools #90 into the roadmap, publication evidence, naming matrix, preview manifest, publication readiness, release URL ledger, platform audit surfaces, and operator dashboard. |
| ECC-Tools #91 | PR #91 merged as `72119a1acc6f5a0cd3bb5d90afd6e87fd1fefd05` after Verify, Security Audit, and Workers Builds passed. It added `--env-file` to the billing announcement and KV readback scripts for ignored local operator credential files, with tests proving sentinel secrets and account logins are not printed. |
| ECC-Tools #92 | PR #92 merged as `18d80197be779619283e0b37e2952bac53819a07` after Verify, Security Audit, and Workers Builds passed. It added the non-breaking `INTERNAL_OPERATOR_API_SECRET` bearer accepted by privileged internal API routes without rotating the primary `INTERNAL_API_SECRET`, and the merged Worker was deployed to `api.ecc.tools`. |
| May 20 live selected-target gate | Vault-backed Wrangler readback passed with Marketplace Pro state, target fingerprint `e953a74209fe`, both key families, webhook evidence, seat readiness, no overage, and 0 blockers. After rotating the operator bearer, `npm run billing:announcement-gate -- --preflight --select-ready-target` returned ready and `npm run billing:announcement-gate -- --select-ready-target` returned `announcementGateReady: true`, 0 required actions, 0 blockers, and audit summary 6 pass / 1 warn / 0 fail. |
| ECC-Tools #93 | PR #93 merged as `d3d62df83fa075660fa4530c3e0edc311a4355fe`, recording the live billing announcement gate pass in the launch checklist and distribution roadmap while preserving final release/plugin/URL approval gates. |
| Post-merge main CI | ECC GitHub Actions runs `26135974576`, `26136949698`, and `26138015245` completed successfully on `main` for `30f60710d4e0424fc70d9bbdc105009db141d9d8`, `c2471fe5c535310f8a8008c9ed7ea9f6757b33f2`, and `6e25458dbc15cd07cfb7a4e1f0b06f3eda41a043` across lint, coverage, security, validation, and the full OS/package-manager matrix. ECC-Tools main CI runs `26137280847`, `26138403065`, and `26138669148` completed successfully for `72119a1acc6f5a0cd3bb5d90afd6e87fd1fefd05`, `18d80197be779619283e0b37e2952bac53819a07`, and `d3d62df83fa075660fa4530c3e0edc311a4355fe`. |
| Post-merge local gates | `npm run platform:audit -- --json` returned ready true with 0 PRs, 0 issues, 0 discussion gaps, and 0 dirty blockers; `npm run preview-pack:smoke -- --format json` returned ready true with digest `531328aaaa53` before the May 20 dashboard rollover and `eebb8a66c33e` after adding the May 20 dashboard artifact; `git diff --check HEAD~1..HEAD` was clean. |
| Linear roadmap sync | Linear ITO-61 comment `467d148a-712a-4777-aad9-95593e9f1739` and ECC Platform Roadmap project comment `7642ee9c-3107-400c-a229-53e2895a8914` record ECC-Tools #89, ECC #2019, the green post-merge CI run, and the earlier internal bearer-token gate; Linear ITO-44 comment `a9297467-208a-41e4-8dbb-35f0dad5fe2b`, ITO-56 comment `5008b70b-cf98-43cd-a8d4-f098ba9b9780`, ITO-61 comment `5ebf0aaf-e2d3-4537-878f-484f49dcf87a`, and project reply `1c74a3d0-f8ca-4306-997e-a37c53d49f97` record the ECC #2020 selected-target announcement-gate sync; a new Linear sync should record ECC-Tools #92/#93 and the live gate pass. |
| Remaining blocker | Native-payments billing evidence is ready as of the May 20 selected-target gate pass. Repeat KV readback and `billing:announcement-gate -- --select-ready-target` immediately before launch, and keep native-payments copy behind the final release, plugin, live URL, and owner-approval gates. |

## Release And Growth Evidence

| Gate | Command | Result |
| --- | --- | --- |
| Release-surface tests | `node tests/docs/ecc2-release-surface.test.js` | 28 passed, 0 failed |
| Preview-pack smoke | `npm run preview-pack:smoke -- --format json` | Ready true; digest `eebb8a66c33e`; 33 required artifacts; 5 passed, 0 failed |
| Release approval gate | `npm run release:approval-gate -- --format json` | Expected blocked; digest `ef8f49f727b7`; 4 passed, 2 failed; owner decisions and live URL readbacks remain approval-gated |
| Operator dashboard | `npm run operator:dashboard -- --write docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-20.md` | Regenerated from the May 20 `main` baseline with platform audit ready true, 0 tracked PRs, 0 tracked issues, 0 discussion gaps, `$1,728/mo` current MRR, `$10,000/mo` target MRR, the release video suite marked current, Linear release-gate sync current, and top actions for plugin publication, notifications, outbound approval, AgentShield, and ECC Tools billing |
| Supply-chain verification | `npm audit --audit-level=moderate`; `npm audit signatures`; `yarn install --immutable --mode=skip-build` | Current supply-chain refresh found 0 npm vulnerabilities, verified 254 registry signatures and 30 attestations, and accepted the Yarn lock after pinning `@types/node@25.7.0` plus refreshing `brace-expansion` to `5.0.6` / `1.1.14` |
| Release video suite | `npm run release:video-suite -- --format json --summary` with `ECC_VIDEO_SOURCE_ROOT` and `ECC_VIDEO_RELEASE_SUITE_ROOT` | Ready true; 15/15 source assets present; 13/13 render, timeline, caption, EDL, and segment artifacts present; 12/12 publish-candidate outputs present with zero detected black-frame segments; primary rough render self-eval passed at 144.759 seconds, 1920x1080, 1 audio stream, and 106.78 MB |
| Focused post-merge regression set | `node tests/hooks/detect-project-worktree.test.js`; `node tests/hooks/observe-subdirectory-detection.test.js`; `node tests/scripts/instinct-cli-projects.test.js`; `node tests/hooks/hooks.test.js` | 10/10, 6/6, 5/5, and 237/237 passed after PR #2009 merged |
| GateGuard PR #2011 regression | `node tests/hooks/gateguard-fact-force.test.js`; `npm test`; `git diff --check main...HEAD` | 91/91 passed on the PR branch; full local suite passed 2560/2560 before merge; whitespace check passed; focused GateGuard suite passed again on current `main` |
| Release approval gate PR #2013 validation | `npm test`; `npm run lint`; `git diff --check`; `npm run preview-pack:smoke -- --format json`; `npm run release:approval-gate -- --format json` | 2568/2568 tests passed before merge; lint and whitespace passed; preview pack stayed ready with digest `531328aaaa53`; release approval gate returned the expected blocked exit with digest `ef8f49f727b7` |
| Full local suite | `node tests/run-all.js` | 2568 passed, 0 failed before PR #2013 merge |
| PR #1998 CI | GitHub Actions run `26099020341` | Completed successfully for `d500de1e9f11c0446b6a1349bd98b522d31f9125`; all reported checks passed, including lint, validation, security scan, coverage, GitGuardian, CodeRabbit, Cubic, and the macOS/Ubuntu/Windows test matrix |
| PR #1999 CI | GitHub Actions run `26100148726` | Completed successfully for `90584b6d5e5814bc2ad9a4cd651bebd043de989d`; lint, validation, security scan, coverage, GitGuardian, CodeRabbit, and the macOS/Ubuntu/Windows test matrix passed; Cubic completed neutral and did not block merge |
| PR #2001 CI | GitHub Actions run `26102500291` | Completed successfully for `8148340ad14eb32c971346f0cb4cb9431ec0f5de`; required checks passed before merge |
| PR #2002 CI | GitHub Actions run `26103853507` | Completed successfully before merge; required checks passed, Cubic remained non-blocking, and PR #2002 merged into `main` as `c7d662c3c68719e5ef0b5305ca3f6782b3214224` |
| PR #2004 CI | GitHub Actions run `26105012698` | Completed successfully after rerunning the single failed Windows Node 18 yarn job; required checks passed, Cubic remained non-blocking, and PR #2004 merged into `main` as `ac7434ea8f39166b11e9d06ce64b38c4fb8d9202` |
| PR #2005 CI | GitHub Actions run `26106321921` | Completed successfully with 37 completed jobs, 0 failed jobs, and PR #2005 merged into `main` as `d6022d6b8dc5ef1393cf18ae40ee58f646f3754e` |
| PR #2008 CI | GitHub Actions run `26108473648` | Completed successfully across the required matrix before merge; non-blocking Cubic skipped after review |
| Post-PR #2006 main CI | GitHub Actions run `26109953093` | Completed successfully with 37 completed jobs, 0 failed jobs, and `main` advanced to `98bd517451f38fa0150a53aab4234c2239a47b7e` |
| PR #2009 CI | GitHub Actions run `26111313938` | Completed successfully with 37 completed jobs, 0 failed jobs after replacing the brittle fake-worktree regression fixture with a real `git worktree add` setup |
| Post-PR #2009 main CI | GitHub Actions run `26111946778` | Completed successfully with 37 completed jobs, 0 failed jobs, and `main` advanced to `bc519e5b8ed42f26c0a5a611756e04351c323f21` |
| Post-PR #2011 main CI | GitHub Actions run `26113695068` | Completed successfully with 37 completed jobs, 0 failed jobs, and `main` advanced to `14d88e517b0c56a80c1a6392b1cde2474948d29f` |
| Post-PR #2013 main CI | GitHub Actions run `26128749863` | Completed successfully with `main` advanced to `9819626459a662773be7d0b1c18d82c1316b8c36` |
| Post-PR #2019 main CI | GitHub Actions run `26135974576` | Completed successfully with `main` advanced to `30f60710d4e0424fc70d9bbdc105009db141d9d8` |
| Post-PR #2020 main CI | GitHub Actions run `26136949698` | Completed successfully with `main` advanced to `c2471fe5c535310f8a8008c9ed7ea9f6757b33f2` |
| ECC-Tools #91 main CI | GitHub Actions run `26137280847` | Completed successfully on ECC-Tools `main` with `72119a1acc6f5a0cd3bb5d90afd6e87fd1fefd05` after the env-file billing gate support merged |
| ECC-Tools #92 main CI | GitHub Actions run `26138403065` | Completed successfully on ECC-Tools `main` with `18d80197be779619283e0b37e2952bac53819a07` after the operator bearer path merged |
| ECC-Tools #93 main CI | GitHub Actions run `26138669148` | Completed successfully on ECC-Tools `main` with `d3d62df83fa075660fa4530c3e0edc311a4355fe` after the live billing announcement evidence merged |
| Linear sync | Linear document `ecc-may-19-post-pr-2002-sync-64cef8f668e0` plus project comment `a6411e3a-8c8e-4a58-adba-687e77d4c543`; late-pass document `ecc-may-19-late-queue-zero-and-release-gate-sync-1c26f65e6b3f` plus project comment `d42bf0e2-7a8e-4934-9f3f-e281498ee805`; May 20 ITO-61 comment `467d148a-712a-4777-aad9-95593e9f1739` plus project comment `7642ee9c-3107-400c-a229-53e2895a8914`; May 20 ITO-44 comment `a9297467-208a-41e4-8dbb-35f0dad5fe2b`, ITO-56 comment `5008b70b-cf98-43cd-a8d4-f098ba9b9780`, ITO-61 comment `5ebf0aaf-e2d3-4537-878f-484f49dcf87a`, and project reply `1c74a3d0-f8ca-4306-997e-a37c53d49f97` | Project and issue lanes record PR #2002 evidence, discussion #2003 routing, owner-approval dashboard gate, and In Progress status for ITO-47, ITO-48, ITO-49, ITO-51, ITO-54, and ITO-56; the late-pass sync attaches PR #2013, ECC-Tools #79, and JARVIS #15/#16 evidence to ITO-44, ITO-50, ITO-54, ITO-56, and ITO-61; the May 20 sync attaches ECC-Tools #89/#90, ECC #2019/#2020 Marketplace Pro selected-target and selected-target announcement-gate evidence, and the remaining env-file/bearer-token gate to ITO-44, ITO-56, ITO-61, and the project |
| Public-path sanitization | `node scripts/ci/validate-no-personal-paths.js` through local suite and CI | Passed |
| Markdown and whitespace | `markdownlint` focused release docs plus `git diff --check` before PR #1999 | Passed |

## Product And Positioning Evidence

| Surface | Evidence |
| --- | --- |
| Canonical repo identity | Public URLs and release docs now use `https://github.com/affaan-m/ECC` where public links are needed |
| Release claim | Release notes and launch collateral frame ECC as the harness-native operator system for agentic work, not a Claude-only config pack |
| Video proof | `video-suite-production.md` gates the local rough render, timeline, captions, source inventory, publish-candidate clip set, self-eval, black-frame QA, and no-private-path publication rules |
| Growth proof | `partner-sponsor-talks-pack.md` provides approval-gated copy for sponsors, partners, consulting, talks, podcasts, GitHub Discussion, and video CTAs |
| Owner approval proof | `owner-approval-packet-2026-05-19.md` centralizes release, package, plugin, video, billing, social, and outbound decision gates |
| Business baseline | Hypergrowth command center and partner pack use `$1,728/mo` current MRR, `$10,000/mo` target MRR, and `$8,272/mo` gap |
| Operator dashboard | `operator-readiness-dashboard-2026-05-20.md` pulls the growth baseline into the same queue, publication, video, outbound, AgentShield, ECC Tools billing/env-file gate, Linear, and supply-chain control surface |
| Linear progress proof | Linear project document `ecc-may-19-post-pr-2002-sync-64cef8f668e0` mirrors the post-PR #2002 state and records active lanes for launch materials, AgentShield, ECC Tools deep analysis, observability, and final release publication; Linear document `ecc-may-19-late-queue-zero-and-release-gate-sync-1c26f65e6b3f` adds the PR #2013 approval gate, ECC-Tools #79 redaction hardening, and JARVIS #15/#16 queue/deploy repair evidence; May 20 Linear comments `74dcc101-3be5-4173-be13-62b80d54f569`, `348ea8f5-2a2d-46d9-a0fe-ed99653e7fe5`, `291e2a4b-06e3-4672-a057-cdb141478161`, `b2d35de0-ca49-44cb-982a-ddec229e7691`, `faed69dd-35f5-469d-acb5-ddde6a70d6a1`, `70187c1e-d481-4181-b418-09bd65d54b5e`, `371fc3e4-611f-4d20-a23f-67db1260b418`, `bd06e252-15c1-4256-b667-caa3f64f5968`, `22c2c388-2fd1-4dea-a939-6141f40c9a21`, `a9297467-208a-41e4-8dbb-35f0dad5fe2b`, `5008b70b-cf98-43cd-a8d4-f098ba9b9780`, `5ebf0aaf-e2d3-4537-878f-484f49dcf87a`, and `1c74a3d0-f8ca-4306-997e-a37c53d49f97` add ECC-Tools hosted observability readback evidence, AgentShield adapter evidence, AgentShield Dependabot alert closure, and Marketplace selected-target announcement-gate evidence to ITO-44, ITO-49, ITO-54, ITO-56, ITO-57, ITO-61, and the project |

## Current Publication Blockers

- GitHub prerelease `v2.0.0-rc.1` is still not created in this pass.
- npm `ecc-universal@2.0.0-rc.1` is still not published to the `next`
  dist-tag.
- Claude plugin tag and marketplace propagation remain approval-gated.
- Codex repo-marketplace distribution is verified by prior evidence, but
  official Plugin Directory publishing remains blocked on OpenAI submission or
  listing evidence.
- ECC Tools billing/native-payments evidence is no longer blocked by the
  internal bearer-token path or selected-target announcement gate. Repeat
  `billing:kv-readback -- --select-ready-target --require-ready` and
  `billing:announcement-gate -- --select-ready-target` immediately before
  launch, and keep the copy behind the final release, plugin, live URL, and
  owner-approval gates.
  ECC-Tools PR #89 (`512bca6`) added `billing:kv-readback --
  --select-ready-target --require-ready`; its 2026-05-20 production run cleared
  the old missing-target-state blocker without printing the account login.
  ECC-Tools PR #90 (`16a5bb3`) added the selected-target official announcement
  gate, so production preflight no longer needs a raw GitHub login.
  ECC-Tools PR #91 (`72119a1`) added `--env-file` support for ignored local
  billing credentials without printing loaded secrets or account logins.
  ECC-Tools PR #92 (`18d8019`) added the non-breaking operator bearer path, and
  ECC-Tools PR #93 (`d3d62df`) recorded the live gate pass.
- Release notes, X, LinkedIn, GitHub release, GitHub Discussion, longform copy,
  sponsor outreach, partner outreach, consulting copy, conference pitches, and
  podcast pitches still need final live URLs plus human approval before posting
  or sending.
- Discord/community links still need a real invite or bot/guild credential path
  before public docs should route users there.

## Result

The tracked public PR queue, issue queue, discussion queue, canonical ECC
identity, release video suite, preview pack, growth outreach packet, per-project
Claude Code adapter surface, continuous-learning project registry hygiene,
GateGuard quoted git introspection fix, deterministic release approval gate,
ECC-Tools billing-announcement redaction hardening, selected-target billing
readback, selected-target announcement gate, billing gate env-file operator path,
ECC-Tools hosted observability readback, AgentShield Zed/VS Code adapter coverage,
AgentShield Dependabot alert closure, and JARVIS security/deploy queue repairs
are current on May 20, 2026 for ECC `main` through
`c2471fe5c535310f8a8008c9ed7ea9f6757b33f2`, ECC-Tools `main` through
`72119a1acc6f5a0cd3bb5d90afd6e87fd1fefd05`, and AgentShield `main` through
`25d91f0002214c408da4ceaac7def20bad40ca10`. The remaining video work is owner
approval, upload, and public URL attachment, not render or QA production.

This improves publication readiness but does not replace the approval-gated
release, package, plugin, billing, Discord, and announcement steps in
`publication-readiness.md`.
