# ECC v2.0.0-rc.1 Launch Checklist

## Repo

- verify local `main` is synced to `origin/main`
- verify `docs/ECC-2.0-GA-ROADMAP.md` reflects the current Linear milestone
  plan and the latest `ECC Platform Roadmap` project snapshot under the Ito
  Markets workspace
- verify `docs/HERMES-SETUP.md` is present
- verify `docs/architecture/cross-harness.md` is present
- verify this release directory is committed
- verify `preview-pack-manifest.md` lists the public release, Hermes, adapter,
  observability, publication, and announcement artifacts before running final
  publish checks
- verify `release-name-plugin-publication-checklist-2026-05-18.md` still
  matches current GitHub, npm, Claude, Codex, OpenCode, and billing surfaces
- keep private tokens, personal docs, and raw workspace exports out of the repo

## Release Surface

- verify package, plugin, marketplace, OpenCode, and agent metadata stays at `2.0.0-rc.1`
- verify `ecc2/Cargo.toml` stays at `0.1.0` for rc.1; `ecc2/` remains an alpha control-plane scaffold
- complete `publication-readiness.md` with fresh evidence before any GitHub release, npm publish, plugin submission, or announcement post
- run `npm run release:approval-gate -- --format json` after owner approvals
  and live URL readbacks are recorded; it must return ready true before any
  publish, upload, social, or outbound action
- rerun the release name/plugin publication checklist before creating a
  GitHub prerelease, publishing npm, pushing Claude plugin tags, recording the
  Codex marketplace path, or posting public copy
- include `publication-evidence-2026-05-17.md` and
  `operator-readiness-dashboard-2026-05-17.md` in the final evidence review,
  then rerun publish-facing checks from the exact release commit
- update release metadata in one dedicated release-version PR
- run the root test suite
- run `cd ecc2 && cargo test`

## Content

- publish the X thread from `x-thread.md`
- publish the LinkedIn draft from `linkedin-post.md`
- use `article-outline.md` for the longer writeup
- route sponsor, partner, consulting, conference, podcast, and GitHub
  Discussion copy through `partner-sponsor-talks-pack.md`
- record one 30-60 second proof-of-work clip
- validate the release video suite with `npm run release:video-suite -- --format json`
  after setting `ECC_VIDEO_SOURCE_ROOT` and `ECC_VIDEO_RELEASE_SUITE_ROOT`
- keep `video-suite-production.md` aligned with the actual primary launch
  render, timeline, captions, and self-eval gate

## Demo Asset Suggestions

- Hermes plus ECC side by side
- release docs being generated or reviewed from the repo
- a workflow moving from brief to post to checklist
- `ecc2/` dashboard or session surface with alpha framing

## Messaging

Use language like:

- "release candidate"
- "sanitized operator stack"
- "cross-harness operating system for agentic work"
- "ECC is the reusable substrate; Hermes is the operator shell"
- "private/local integrations land after sanitization"

Do not send sponsor, partner, consulting, conference, or podcast outreach
without explicit human approval.
