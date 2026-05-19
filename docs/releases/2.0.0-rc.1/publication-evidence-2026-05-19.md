# ECC v2.0.0-rc.1 Publication Evidence - 2026-05-19

This is release-readiness evidence only. It does not create a GitHub release,
npm publication, plugin tag, marketplace submission, billing announcement, or
social announcement.

## Source Commit

| Field | Evidence |
| --- | --- |
| Upstream main | `855e8c8336e1c18523cbb31cb29f4ce96d7518a7` |
| Git remote | `https://github.com/affaan-m/ECC.git` |
| Evidence scope | Current `main` after PR #1990 harness-audit GitHub integration scoring, PR #1991 canonical ECC identity gate, PR #1992 release video-suite gate, PR #1993 growth outreach pack, PR #1994 May 19 publication evidence refresh, PR #1995 operator dashboard refresh, PR #1996 primary render self-eval gate, and PR #1997 publish-candidate gate |
| Local status caveat | `git status --short --branch` was clean after pulling `origin/main`; generated evidence files are committed after the source snapshot they describe |

The release operator must repeat all publish-facing checks from the exact final
release commit with a strictly clean checkout before publishing.

## Queue And Discussion State

| Surface | Command | Result |
| --- | --- | --- |
| Platform audit | `node scripts/platform-audit.js --json` | Ready true; tracked repos report 0 open PRs, 0 open issues, 0 discussion maintainer-touch gaps, 0 answerable Q&A gaps, 0 conflicting PRs, and 0 blocking dirty files |
| Trunk PRs | `gh pr list --repo affaan-m/ECC --state open --json number,title,url,author --limit 100` | `[]` |
| Trunk issues | `gh issue list --repo affaan-m/ECC --state open --json number,title,url,author --limit 100` | `[]` |
| Discussion audit through platform audit | `node scripts/platform-audit.js --json` | `affaan-m/ECC` discussions enabled; 58 sampled; 0 needing maintainer touch; 0 answerable without accepted answer |
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

## Release And Growth Evidence

| Gate | Command | Result |
| --- | --- | --- |
| Release-surface tests | `node tests/docs/ecc2-release-surface.test.js` | 25 passed, 0 failed |
| Preview-pack smoke | `npm run preview-pack:smoke -- --format json` | Ready true; digest `bc2bf157616e`; 30 required artifacts; 5 passed, 0 failed |
| Operator dashboard | `npm run operator:dashboard -- --markdown --write docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-19.md` | Generated May 19 dashboard with platform audit ready true, 0 tracked PRs, 0 tracked issues, 0 discussion gaps, `$1,728/mo` current MRR, `$10,000/mo` target MRR, and top actions for plugin publication, notifications, release video, outbound approval, AgentShield, and ECC Tools billing |
| Release video suite | `npm run release:video-suite -- --format json --summary` with `ECC_VIDEO_SOURCE_ROOT` and `ECC_VIDEO_RELEASE_SUITE_ROOT` | Ready true; 15/15 source assets present; 13/13 render, timeline, caption, EDL, and segment artifacts present; 12/12 publish-candidate outputs present with zero detected black-frame segments; primary rough render self-eval passed at 144.759 seconds, 1920x1080, 1 audio stream, and 106.78 MB |
| Full local suite | `node tests/run-all.js` | 2545 passed, 0 failed |
| PR #1997 CI | GitHub Actions run `26097832795` | Completed successfully for `855e8c8336e1c18523cbb31cb29f4ce96d7518a7`; all reported checks passed, including lint, validation, security scan, coverage, GitGuardian, CodeRabbit, Cubic, and the macOS/Ubuntu/Windows test matrix |
| Public-path sanitization | `node scripts/ci/validate-no-personal-paths.js` through local suite and CI | Passed |
| Markdown and whitespace | `markdownlint` focused release docs plus `git diff --check` before PR #1993 | Passed |

## Product And Positioning Evidence

| Surface | Evidence |
| --- | --- |
| Canonical repo identity | Public URLs and release docs now use `https://github.com/affaan-m/ECC` where public links are needed |
| Release claim | Release notes and launch collateral frame ECC as the harness-native operator system for agentic work, not a Claude-only config pack |
| Video proof | `video-suite-production.md` gates the local rough render, timeline, captions, source inventory, publish-candidate clip set, self-eval, black-frame QA, and no-private-path publication rules |
| Growth proof | `partner-sponsor-talks-pack.md` provides approval-gated copy for sponsors, partners, consulting, talks, podcasts, GitHub Discussion, and video CTAs |
| Business baseline | Hypergrowth command center and partner pack use `$1,728/mo` current MRR, `$10,000/mo` target MRR, and `$8,272/mo` gap |
| Operator dashboard | `operator-readiness-dashboard-2026-05-19.md` pulls the growth baseline into the same queue, publication, video, outbound, AgentShield, ECC Tools, Linear, and supply-chain control surface |

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
identity, release video suite, preview pack, and growth outreach packet are
current on May 19, 2026 for `main` through
`855e8c8336e1c18523cbb31cb29f4ce96d7518a7`, with the visual video QA gate
staged for the next merge.

This improves publication readiness but does not replace the approval-gated
release, package, plugin, billing, Discord, and announcement steps in
`publication-readiness.md`.
