# ECC v2.0.0-rc.1 Publication Evidence - 2026-05-19

This is release-readiness evidence only. It does not create a GitHub release,
npm publication, plugin tag, marketplace submission, billing announcement, or
social announcement.

## Source Commit

| Field | Evidence |
| --- | --- |
| Upstream main | `bc519e5b8ed42f26c0a5a611756e04351c323f21` |
| Git remote | `https://github.com/affaan-m/ECC.git` |
| Evidence scope | Current `main` after PR #1990 harness-audit GitHub integration scoring, PR #1991 canonical ECC identity gate, PR #1992 release video-suite gate, PR #1993 growth outreach pack, PR #1994 May 19 publication evidence refresh, PR #1995 operator dashboard refresh, PR #1996 primary render self-eval gate, PR #1997 publish-candidate gate, PR #1998 visual QA gate, PR #1999 video dashboard evidence refresh, PR #2000 suite-count evidence refresh, PR #2001 owner approval packet addition, PR #2002 owner approval dashboard gate refresh, PR #2004 Linear readiness evidence sync, PR #2005 post-PR #2004 evidence refresh, PR #2008 release supply-chain evidence gate fix, PR #2006 per-project Claude Code adapter, and PR #2009 continuous-learning project registry hygiene fix |
| Local status caveat | `git status --short --branch` was clean after pulling `origin/main`; generated evidence files are committed after the source snapshot they describe |

The release operator must repeat all publish-facing checks from the exact final
release commit with a strictly clean checkout before publishing.

## Queue And Discussion State

| Surface | Command | Result |
| --- | --- | --- |
| Platform audit | `node scripts/platform-audit.js --json` | Ready true; tracked repos report 0 open PRs, 0 open issues, 0 discussion maintainer-touch gaps, 0 answerable Q&A gaps, 0 conflicting PRs, and 0 blocking dirty files |
| Trunk PRs | `gh pr list --repo affaan-m/ECC --state open --json number,title,url,author --limit 100` | `[]` |
| Trunk issues | `gh issue list --repo affaan-m/ECC --state open --json number,title,url,author --limit 100` | `[]` |
| Discussion audit through platform audit | `node scripts/platform-audit.js --json` | `affaan-m/ECC` discussions enabled; 59 sampled after #2003 AURA integration proposal; 0 needing maintainer touch; 0 answerable without accepted answer |
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

## Release And Growth Evidence

| Gate | Command | Result |
| --- | --- | --- |
| Release-surface tests | `node tests/docs/ecc2-release-surface.test.js` | 27 passed, 0 failed |
| Preview-pack smoke | `npm run preview-pack:smoke -- --format json` | Ready true; digest `790430aef4a8`; 31 required artifacts; 5 passed, 0 failed |
| Operator dashboard | `npm run operator:dashboard -- --write docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-19.md` | Regenerated from the May 19 `main` baseline with platform audit ready true, 0 tracked PRs, 0 tracked issues, 0 discussion gaps, `$1,728/mo` current MRR, `$10,000/mo` target MRR, the release video suite marked current, and top actions for plugin publication, notifications, outbound approval, AgentShield, and ECC Tools billing |
| Supply-chain verification | `npm audit --audit-level=moderate`; `npm audit signatures`; `yarn install --immutable --mode=skip-build` | Current supply-chain refresh found 0 npm vulnerabilities, verified 254 registry signatures and 30 attestations, and accepted the Yarn lock after pinning `@types/node@25.7.0` plus refreshing `brace-expansion` to `5.0.6` / `1.1.14` |
| Release video suite | `npm run release:video-suite -- --format json --summary` with `ECC_VIDEO_SOURCE_ROOT` and `ECC_VIDEO_RELEASE_SUITE_ROOT` | Ready true; 15/15 source assets present; 13/13 render, timeline, caption, EDL, and segment artifacts present; 12/12 publish-candidate outputs present with zero detected black-frame segments; primary rough render self-eval passed at 144.759 seconds, 1920x1080, 1 audio stream, and 106.78 MB |
| Focused post-merge regression set | `node tests/hooks/detect-project-worktree.test.js`; `node tests/hooks/observe-subdirectory-detection.test.js`; `node tests/scripts/instinct-cli-projects.test.js`; `node tests/hooks/hooks.test.js` | 10/10, 6/6, 5/5, and 237/237 passed after PR #2009 merged |
| Full local suite | `node tests/run-all.js` | 2560 passed, 0 failed |
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
| Linear sync | Linear document `ecc-may-19-post-pr-2002-sync-64cef8f668e0` plus project comment `a6411e3a-8c8e-4a58-adba-687e77d4c543` | Project and issue lanes now record PR #2002 evidence, discussion #2003 routing, owner-approval dashboard gate, and In Progress status for ITO-47, ITO-48, ITO-49, ITO-51, ITO-54, and ITO-56 |
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
| Operator dashboard | `operator-readiness-dashboard-2026-05-19.md` pulls the growth baseline into the same queue, publication, video, outbound, AgentShield, ECC Tools, Linear, and supply-chain control surface |
| Linear progress proof | Linear project document `ecc-may-19-post-pr-2002-sync-64cef8f668e0` mirrors the post-PR #2002 state and records active lanes for launch materials, AgentShield, ECC Tools deep analysis, observability, and final release publication |

## Current Publication Blockers

- GitHub prerelease `v2.0.0-rc.1` is still not created in this pass.
- npm `ecc-universal@2.0.0-rc.1` is still not published to the `next`
  dist-tag.
- Claude plugin tag and marketplace propagation remain approval-gated.
- Codex repo-marketplace distribution is verified by prior evidence, but
  official Plugin Directory publishing remains blocked on OpenAI submission or
  listing evidence.
- ECC Tools billing/native-payments copy remains blocked until a Marketplace
  Pro purchase/webhook path writes ready production billing state for a target
  Marketplace test account and the billing announcement gate passes.
- Release notes, X, LinkedIn, GitHub release, GitHub Discussion, longform copy,
  sponsor outreach, partner outreach, consulting copy, conference pitches, and
  podcast pitches still need final live URLs plus human approval before posting
  or sending.
- Discord/community links still need a real invite or bot/guild credential path
  before public docs should route users there.

## Result

The tracked public PR queue, issue queue, discussion queue, canonical ECC
identity, release video suite, preview pack, growth outreach packet, per-project
Claude Code adapter surface, and continuous-learning project registry hygiene
are current on May 19, 2026 for `main` through
`bc519e5b8ed42f26c0a5a611756e04351c323f21`. The remaining video work is owner
approval, upload, and public URL attachment, not render or QA production.

This improves publication readiness but does not replace the approval-gated
release, package, plugin, billing, Discord, and announcement steps in
`publication-readiness.md`.
