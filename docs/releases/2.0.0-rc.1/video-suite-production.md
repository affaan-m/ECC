# ECC 2.0 Video Suite Production Manifest

Snapshot date: 2026-05-19.

This is the production contract for the ECC 2.0 release video suite. It keeps
the public release story, local source inventory, render outputs, and self-eval
gate in one place without committing raw footage, private transcript exports, or
absolute local paths.

## Claim

ECC 2.0 is the harness-native operator system for agentic work.

The videos should prove that claim directly:

- one reusable layer across Claude Code, Codex, OpenCode, Cursor, Gemini, Zed,
  GitHub Copilot, and terminal workflows;
- reusable skills, rules, hooks, agents, MCP conventions, release gates, and
  operator workflows;
- `ecc2/` as the alpha control-plane/TUI direction, not the whole product;
- AgentShield and supply-chain gates as the enterprise trust layer;
- OSS stays free, with GitHub Sponsors, ECC Tools Pro, and consulting as the
  funding surface.

Do not frame the launch as a rename, pivot, config pack, or Claude-only package.

## Private Inputs

Do not commit raw footage, transcript JSON, or timeline exports.

Operators should point the validator at local media using environment variables:

```bash
ECC_VIDEO_SOURCE_ROOT=/path/to/ecc_2_raws \
ECC_VIDEO_RELEASE_SUITE_ROOT=/path/to/ecc_2_release_suite \
npm run release:video-suite -- --format json
```

`ECC_VIDEO_SOURCE_ROOT` should contain proof images and may contain an `_edited/`
subdirectory with edited source clips. `ECC_VIDEO_RELEASE_SUITE_ROOT` should
contain `edl/`, `segments/`, `renders/`, `timelines/`, and `transcripts/`.

## Source Inventory

These basenames are the required local inputs for the release suite validator.

| Asset | Lane | Proof |
| --- | --- | --- |
| `longform-full-wide.mp4` | Primary launch video | operator system, control-plane direction, closing proof |
| `sf-longform-full.mp4` | Primary launch video | structured context opener |
| `sf-thread-2-whatisecc.mp4` | What is ECC | category clarity and GitHub App explanation |
| `sf-thread-4-security.mp4` | Security proof | AgentShield, hooks, MCP, permission risk |
| `thread-2-ghapp-money.mp4` | Money/proof clip | OSS plus paid hosting and services |
| `architecture-2-wide.mp4` | B-roll | harness-native architecture |
| `terminal-scan-2-wide.mp4` | Install proof | terminal workflow and install confidence |
| `new_site_raw.mp4` | B-roll | site and product surface |
| `coverage-montage-wide.mp4` | Coverage/social proof | distribution and social proof |
| `metrics-ticker-2-wide.mp4` | Money/proof clip | traction and funnel proof |
| `growth-timeline-2-wide.mp4` | Coverage/social proof | release momentum timeline |
| `gh_app_1.png` | Money/proof clip | hosted GitHub App surface |
| `star_history.png` | Coverage/social proof | OSS adoption chart |
| `x_analytics.png` | Coverage/social proof | social distribution proof |
| `100k.png` | Coverage/social proof | reach milestone proof |

## Deliverables

| Deliverable | Length | Aspect | Output |
| --- | ---: | --- | --- |
| Primary launch video | 90-150s | 16:9 | `ecc-2-primary-launch.mp4` |
| Install proof clip | 25-35s | 16:9 and 9:16 | `ecc-2-install-proof-*` |
| What is ECC clip | 45-60s | 16:9 and 9:16 | `ecc-2-what-is-ecc-*` |
| Security proof clip | 45-60s | 16:9 and 9:16 | `ecc-2-security-proof-*` |
| Money/proof clip | 30-45s | 16:9 and 9:16 | `ecc-2-money-proof-*` |
| Coverage/social proof clip | 30-45s | 16:9 and 9:16 | `ecc-2-social-proof-*` |

## Primary Launch Video

The rough v1 primary launch assembly is the current spine. It should stay
speech-led, with product proof covering jump cuts and older wording.

| Order | Source | In | Out | Use |
| --- | --- | ---: | ---: | --- |
| 01 | `sf-longform-full.mp4` | 161.12 | 177.68 | Cleaner opener: ECC as structured context with skills, commands, agents, hooks, and project setup. |
| 02 | `thread-2-ghapp-money.mp4` | 21.84 | 30.40 | Direct product thesis: agentic harness optimization. |
| 03 | `thread-2-ghapp-money.mp4` | 41.00 | 59.72 | Not another harness; ECC is the layer and tooling on top of harnesses. |
| 04 | `longform-full-wide.mp4` | 254.60 | 271.20 | Agentic IDE, observability, tracing, and multi-agent control-plane direction. |
| 05 | `sf-thread-2-whatisecc.mp4` | 40.08 | 60.60 | GitHub App analyzes repos and injects project-specific skills, prompts, and hooks. |
| 06 | `sf-thread-4-security.mp4` | 17.60 | 32.72 | Security risk setup: hooks, MCP servers, permissions. |
| 07 | `sf-thread-4-security.mp4` | 37.28 | 51.32 | AgentShield proof: rules, categories, grades, secrets, injection, exfiltration. |
| 08 | `thread-2-ghapp-money.mp4` | 59.72 | 75.96 | OSS-first business model plus managed GitHub App surface. |
| 09 | `longform-full-wide.mp4` | 507.34 | 525.62 | Close on workflows, tested shipping, and secure daily agent work. |

Required local rough v1 artifacts:

- `edl/primary-launch.edl.md`
- `timelines/primary-launch-v1.timeline.json`
- `renders/ecc-2-primary-launch-rough-v1.mp4`
- `renders/ecc-2-primary-launch-rough-v1.captions.srt`
- `segments/primary-launch-v1/01-structured-context.mp4`
- `segments/primary-launch-v1/02-agentic-harness-optimization.mp4`
- `segments/primary-launch-v1/03-not-another-harness.mp4`
- `segments/primary-launch-v1/04-agentic-ide-surface.mp4`
- `segments/primary-launch-v1/05-github-app-proof.mp4`
- `segments/primary-launch-v1/06-security-risk.mp4`
- `segments/primary-launch-v1/07-agentshield-proof.mp4`
- `segments/primary-launch-v1/08-oss-paid-model.mp4`
- `segments/primary-launch-v1/09-close-shipping-system.mp4`

## Publish-Candidate Outputs

The release validator also expects the current publish-candidate set under
`renders/publish-candidates/`. These are still local review files, not public
uploads or committed media.

| Output | Target |
| --- | --- |
| `ecc-2-primary-launch.mp4` | 90-150s, 1920x1080, audio |
| `ecc-2-primary-launch.captions.srt` | primary captions |
| `ecc-2-install-proof-wide.mp4` | 25-35s, 1920x1080, audio |
| `ecc-2-install-proof-vertical.mp4` | 25-35s, 1080x1920, audio |
| `ecc-2-what-is-ecc-wide.mp4` | 45-60s, 1920x1080, audio |
| `ecc-2-what-is-ecc-vertical.mp4` | 45-60s, 1080x1920, audio |
| `ecc-2-security-proof-wide.mp4` | 45-60s, 1920x1080, audio |
| `ecc-2-security-proof-vertical.mp4` | 45-60s, 1080x1920, audio |
| `ecc-2-money-proof-wide.mp4` | 30-45s, 1920x1080, audio |
| `ecc-2-money-proof-vertical.mp4` | 30-45s, 1080x1920, audio |
| `ecc-2-social-proof-wide.mp4` | 30-45s, 1920x1080, audio |
| `ecc-2-social-proof-vertical.mp4` | 30-45s, 1080x1920, audio |

## video-use compatible workflow

Use the same production shape as Video Use while keeping the ECC-specific media
stack intact:

1. Treat transcript and timeline data as the editing surface.
2. Inspect filmstrip or frame samples only at ambiguous cut points.
3. Keep an edit decision list before rendering.
4. Cut deterministically with FFmpeg.
5. Add proof overlays with Remotion or Manim where product claims need visual
   evidence.
6. Export the MP4 plus editable timeline and caption state.
7. Run self-eval before any upload or social post.

Do not dump frames into the repo. Frame samples used for self-eval belong in the
local release suite workspace.

## Browser Capture Plan

Use Browser or equivalent desktop capture only for proof footage that must be
current on release day:

| Surface | Capture |
| --- | --- |
| GitHub repo | README hero, install block, sponsor links, release notes |
| Codex plugin | repo marketplace install path and local plugin README |
| OpenCode package | package install and plugin banner |
| ECC Tools Pro | billing/product page only after live readback confirms claims |
| AgentShield | CLI output, policy category view, supply-chain gate |
| `ecc2/` | alpha control-plane/TUI surface with alpha framing |

If a surface is not live, use a local browser capture and label it as local or
release-candidate proof. Do not claim marketplace, billing, or official
directory availability before evidence exists.

## Self-Eval Gate

Run the validator:

```bash
ECC_VIDEO_SOURCE_ROOT=/path/to/ecc_2_raws \
ECC_VIDEO_RELEASE_SUITE_ROOT=/path/to/ecc_2_release_suite \
npm run release:video-suite -- --format json
```

Then manually check the final render for:

- validator self-eval passes for the primary render: 90-150 seconds, at least
  1280x720, video stream present, audio stream present, and non-empty output;
- validator self-eval passes for the publish-candidate set: primary MP4 plus
  captions and five short clips in both wide and vertical formats;
- no blank frames or accidental desktop exposure;
- no stale repo name, pivot, rename, or Claude-only framing in captions;
- no captions that rewrite speech into a false claim;
- no stale URLs, old install commands, or pre-rename repository links;
- no internal MRR numbers unless the post explicitly needs them;
- audio continuity across every cut;
- first 10 seconds clearly say what ECC is;
- final CTA routes to repo, sponsor, Pro, or consulting without clutter.

## Do Not Publish If

- `npm run release:video-suite` is not ready for the local source roots.
- The primary launch render is outside the 90-150 second target.
- Captions mention the old repository name.
- Product proof relies on private screens, secrets, customer data, or raw local
  paths.
- The release URL, npm, plugin, billing, or marketplace claims outrun the
  evidence in `publication-readiness.md`.
