# ECC v2.0.0-rc.1 Owner Approval Packet

Snapshot date: 2026-05-19.

This packet is the final human decision sheet for the rc.1 public launch. It
does not publish anything by itself. Use it to approve, defer, or block each
release action after the final evidence commands are rerun from the intended
release commit.

Source commit for the clean evidence baseline this packet extends:
`bc519e5b8ed42f26c0a5a611756e04351c323f21`.

## Current Evidence

| Evidence | Current recorded state | Repeat before approval |
| --- | --- | --- |
| Platform audit | ready true, 0 open PRs, 0 open issues, 0 discussion gaps, 0 dirty files | yes |
| Preview pack smoke | ready true, digest `790430aef4a8`, 5/5 checks | yes |
| Video suite | ready true, 15/15 source assets, 13/13 suite artifacts, 12/12 publish candidates | yes |
| Release surface tests | 27/27 passed after this packet was added | yes |
| Full local suite | 2560/2560 passed after PR #2009 was prepared; focused post-merge regressions passed on `main` | yes |
| GitHub CI | PR #1998, PR #1999, PR #2000, PR #2001, PR #2002, PR #2004, PR #2008, post-PR #2006 `main`, PR #2009, and post-PR #2009 `main` all merged or advanced after green required checks | verify current head |

## Decision Register

| Decision | Approve / defer / block | Evidence required first | Notes |
| --- | --- | --- | --- |
| GitHub prerelease | defer | final clean branch, URL ledger, release notes, attached video or video link | Approve only after final release notes contain live package/plugin/video URLs or explicitly marked blocked URLs. |
| npm `next` publish | defer | `npm pack --dry-run`, `npm publish --tag next --dry-run`, registry dist-tag readback plan | Keep `ecc-universal@2.0.0-rc.1` on `next`; do not move `latest` during rc.1. |
| Claude plugin tag | defer | `claude plugin validate .claude-plugin/plugin.json`, `claude plugin tag .claude-plugin --dry-run` | Create and push the real tag only after release approval. |
| Codex repo marketplace | defer | temp-home marketplace add smoke and current official Plugin Directory status | Claim repo-marketplace distribution only; do not claim official Plugin Directory listing without listing evidence. |
| ECC Tools billing language | defer | live readiness readback for the target account and billing/product state | Do not announce native payments or Marketplace-managed Pro until the gate is live. |
| Video upload | defer | owner selects primary launch cut plus short clips, self-eval stays clean | Upload only approved cuts; keep editable timeline/project output preserved. |
| X, LinkedIn, GitHub Discussion, longform | defer | live release, npm, plugin, video, and billing URL ledger updates | Personal-account posts and outbound copy need explicit approval. |
| Sponsor, partner, consulting, conference, podcast outreach | defer | final public URLs plus owner-approved outbound copy | Do not send drafts until the owner approves the exact batch. |

## Final URL Fill-In

Update these surfaces after the approved publication actions finish:

| Surface | Final value source | Update targets |
| --- | --- | --- |
| GitHub prerelease URL | `gh release view v2.0.0-rc.1 --repo affaan-m/ECC --json url` | release notes, URL ledger, social copy |
| npm rc package URL | `npm view ecc-universal@2.0.0-rc.1 version dist-tags --json` | URL ledger, quickstart, release notes |
| Claude plugin tag URL | pushed `ecc--v2.0.0-rc.1` tag or marketplace readback | URL ledger, plugin docs, release notes |
| Codex repo-marketplace evidence | temp-home `codex plugin marketplace add <local-checkout>` readback | URL ledger, publication readiness |
| Primary launch video URL | uploaded owner-approved primary launch video | GitHub release, X, LinkedIn, longform |
| Short clip URLs | uploaded approved clips | X thread, LinkedIn, partner/sponsor/talk pack |
| ECC Tools billing/readiness URL | live readiness readback or explicit blocked status | sponsor copy, Pro copy, release notes |

## Final Evidence Commands

Run these from the exact release commit before approving publication:

```bash
git status --short --branch
node scripts/platform-audit.js --json
npm run preview-pack:smoke -- --format json
npm run release:video-suite -- --format json
npm run harness:adapters -- --check
npm run harness:audit -- --format json
npm run observability:ready
npm run security:ioc-scan
npm audit --audit-level=moderate
npm audit signatures
node tests/docs/ecc2-release-surface.test.js
node tests/run-all.js
cd ecc2 && cargo test
```

## Approval Text

Use short, explicit approvals. Example:

```text
Approved for rc.1 GitHub prerelease, npm next publish, Claude plugin tag, and
release announcement after the final evidence commands pass from commit <sha>.
Video uploads approved for <primary-video> and <shorts-list>.
Outbound sponsor, partner, consulting, conference, and podcast messages remain
blocked until I approve the exact batch.
```

## Do Not Approve If

- The final branch is dirty or no longer matches the intended release commit.
- Any required evidence command fails or is skipped without a written deferral.
- The release copy claims live billing, plugin marketplace propagation, npm
  `next`, or official Codex Plugin Directory listing before readback exists.
- Announcement copy contains stale URLs, private paths, or unresolved live-link
  decisions.
- The selected video cut has black frames, missing audio, stale URLs, weak
  product proof, or unreviewed captions.
- The outbound batch has not been reviewed exactly as it will be sent.

No outbound email, personal-account post, package publish, plugin tag, or billing announcement is authorized by this packet alone.
