# ECC 2.0 Hypergrowth Release Command Center

Snapshot date: 2026-05-19.

This is the execution map for turning ECC 2.0 into a complete public release,
partner funnel, sponsor funnel, consulting surface, and content launch. It is
written for operators. Use it to decide what ships, what gets announced, and
what stays blocked until evidence exists.

## Release Claim

ECC 2.0 is the harness-native operator system for agentic work.

The public proof must show the actual system:

- reusable skills, rules, hooks, MCP conventions, and release gates;
- Claude Code, Codex, OpenCode, Cursor, Gemini, Zed, GitHub Copilot, and
  terminal-only workflows as supported execution surfaces;
- `ecc2/` as the alpha control-plane/TUI direction;
- Hermes as the optional operator shell for chat, cron, handoffs, and daily
  work routing;
- ECC Tools Pro, GitHub Sponsors, and consulting as the business surface that
  funds the OSS layer.

Avoid language that frames this as a rename or a retreat from the old project.
The release copy should show the 2.0 product shape directly.

## Current Growth Baseline

| Metric | Current | Target | Gap |
| --- | ---: | ---: | ---: |
| MRR | `$1,728/mo` | `$10,000/mo` | `$8,272/mo` |
| Sponsor motion | Active GitHub Sponsors plus open inbound | Repeatable sponsor close loop | Approval-gated outbound |
| Consulting motion | Open, non-primary | Partner-ready packages | Public proof, talks, and intake |
| Content motion | Release video publish candidates ready | Weekly launch clips and founder proof | Owner approval, upload, and public URLs |
| Community motion | Discord exists | Useful coding/operator community | Invite, channels, pins, moderation |

MRR growth should come from four lanes at once:

- GitHub Sponsors and OSS partner sponsors;
- ECC Tools Pro subscriptions;
- consulting and implementation contracts;
- talks, podcasts, conference demos, and partner webinars that create inbound.

## Release Gates

| Lane | Done when | Current action |
| --- | --- | --- |
| Repo identity | README, package metadata, plugin metadata, release docs, workflows, and launch copy all use `affaan-m/ECC` where public URLs are needed | Canonical URL sweep |
| Package and plugin publication | `ecc-universal@2.0.0-rc.1` dry-runs clean, npm `next` is approved, Claude plugin tag dry-runs, Codex repo marketplace smoke passes, OpenCode build passes | Refresh publication evidence from final commit |
| Product proof | Quickstart, cross-harness architecture, demo prompts, `ecc2/` alpha boundary, AgentShield safety proof, and hosted ECC Tools links are consistent | Keep proof surfaces concrete |
| Revenue proof | Sponsor tiers, Pro pricing, consulting CTA, partner CTA, and billing-readback language are current | Do not announce billing claims before live readback |
| Content proof | Launch video, short-form clips, screenshots, release notes, GitHub Discussion, X, LinkedIn, and longform post are aligned | Pick final video cuts, upload after approval, and attach public URLs |
| Community proof | Discord invite, rules, channels, onboarding, and sponsor/community routing are ready | Needs invite/token decision before public links |

## Video Suite

The video lane should use the existing ECC video-editing skill plus the
`browser-use/video-use` model where useful: transcript as the editing surface,
strategy approval before render, deterministic cuts, timeline/project output
when available, and self-eval before publication.

Reference pattern: <https://github.com/browser-use/video-use>

Primary source classes already exist in the local ECC media library. Keep raw
absolute paths out of public docs; use basenames or a private production
manifest when handing work to an editor or agent.

| Deliverable | Length | Source material | Proof goal |
| --- | ---: | --- | --- |
| Primary launch video | 90-150s | `longform-full-wide.mp4`, `sf-longform-full.mp4`, `architecture-2-wide.mp4`, `terminal-scan-2-wide.mp4`, `new_site_raw.mp4` | ECC 2.0 as the operator system |
| Install proof | 30s | README install, terminal scan, quickstart, plugin install | Fewer-click adoption |
| What is ECC | 45-60s | `sf-thread-2-whatisecc.mp4`, `vertical-2-whatisecc.mp4`, `architecture-2-*` | Product category clarity |
| Security proof | 45-60s | `sf-thread-4-security.mp4`, AgentShield evidence, supply-chain gates | Enterprise trust |
| Money/proof clip | 30-45s | `thread-2-ghapp-money.mp4`, `metrics-ticker-2-*`, `gh_app_*.png` | Sponsor, Pro, and partner credibility |
| Coverage/social proof | 30-45s | `coverage-montage-wide.mp4`, `100k.png`, `star_history.png`, `x_analytics.png`, coverage screenshots | Distribution leverage |

Production steps:

1. Generate transcripts for the longform and shortform raw clips.
2. Build an edit decision list with hook, proof, demo, business CTA, and final
   CTA segments.
3. Cut deterministically with FFmpeg.
4. Add overlays and data motion in Remotion or Manim.
5. Add captions, light color correction, audio normalization, and platform
   reframes.
6. Run a self-eval pass for blank frames, bad captions, jump cuts, weak hook,
   missing product proof, and stale URLs.
7. Export final MP4s plus the editable timeline/project state.

## Distribution Plan

| Channel | Asset | CTA |
| --- | --- | --- |
| GitHub Release | release notes, quickstart, launch video, sponsor link | star, install, sponsor |
| GitHub Discussion | short announcement and proof bullets | questions, feedback, sponsors |
| X | launch thread, 30s install clip, proof clips | repo, sponsor, Pro |
| LinkedIn | partner-friendly product proof, consulting CTA | sponsors, consulting, talks |
| YouTube/Shorts/Reels/TikTok | primary launch video and clips | repo, site, newsletter/community |
| Podcasts/talks | one-page pitch, demo outline, founder proof | bookings, partners |
| Sponsor outbound | direct sponsor note and tier table | GitHub Sponsors or Pro |

The source of truth for sponsor, partner, consulting, conference, podcast, and
GitHub Discussion copy is
`docs/releases/2.0.0-rc.1/partner-sponsor-talks-pack.md`.

## Copy Rules

Use direct product language:

- `ECC 2.0 is the harness-native operator system for agentic work.`
- `One reusable layer across Claude Code, Codex, OpenCode, Cursor, Gemini, Zed, GitHub Copilot, and terminal workflows.`
- `OSS stays free. Sponsors and Pro fund the work.`
- `Use ECC for skills, hooks, rules, MCP conventions, release gates, and operator workflows.`

Avoid:

- `we renamed the repo`;
- `pivot`;
- legacy config-pack framing;
- `Claude-only`;
- generic founder-journey language;
- claims about billing, marketplace payments, or official directory listings
  before live evidence exists.

## First Build Order

1. Land the public repo identity fixes.
2. Refresh package, plugin, workflow, release, and launch-copy URLs.
3. Record final publication evidence from the exact release commit.
4. Keep the video suite manifest, transcripts, publish candidates, and visual QA
   current with `npm run release:video-suite -- --format json`.
5. Browser-capture the README, ECC Tools app, install flow, and relevant proof
   surfaces for b-roll.
6. Choose the owner-approved primary launch video and five short clips, then
   upload and attach final public URLs.
7. Finalize GitHub release, X thread, LinkedIn post, Discussion announcement,
   sponsor email copy, consulting intro, partner DM, and podcast/talk pitch.
8. Publish only after npm, plugin, release URL, and billing-readback gates are
   either live or explicitly marked blocked.

## Owner Approvals

These actions need a human approval or credential before they move:

- sending annual-upgrade or sponsor emails;
- updating LinkedIn profile text;
- wiring Discord with a bot token and guild ID;
- publishing npm or creating plugin tags;
- announcing billing/native payments;
- sending partner, consulting, conference, podcast, or sponsor outreach;
- posting final social copy from personal accounts.
