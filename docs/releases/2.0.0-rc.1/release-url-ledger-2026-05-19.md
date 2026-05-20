# ECC v2.0.0-rc.1 Release URL Ledger

This ledger separates links that are already public from links that only become
valid after the approval-gated release, package, plugin, and announcement
steps. Regenerate it from the final release commit before posting any public
announcement.

Refreshed on 2026-05-19 after the public repository rename to
`affaan-m/ECC`. The final release pass must replace commit-specific evidence
with output from the exact release commit.

## Live Now

| Surface | URL | Verification |
| --- | --- | --- |
| Repository | <https://github.com/affaan-m/ECC> | `git remote get-url origin` returns `https://github.com/affaan-m/ECC.git` |
| Release pack folder | <https://github.com/affaan-m/ECC/tree/main/docs/releases/2.0.0-rc.1> | In-tree release pack |
| Release notes draft | <https://github.com/affaan-m/ECC/blob/main/docs/releases/2.0.0-rc.1/release-notes.md> | In-tree release copy |
| Hermes setup guide | <https://github.com/affaan-m/ECC/blob/main/docs/HERMES-SETUP.md> | In-tree sanitized Hermes guide |
| May 19 evidence snapshot | <https://github.com/affaan-m/ECC/blob/main/docs/releases/2.0.0-rc.1/publication-evidence-2026-05-19.md> | Current strongest identity, video, growth, and CI readiness evidence |
| May 18 evidence snapshot | <https://github.com/affaan-m/ECC/blob/main/docs/releases/2.0.0-rc.1/publication-evidence-2026-05-18.md> | Previous supply-chain and publication-path readiness evidence |
| May 18 operator dashboard | <https://github.com/affaan-m/ECC/blob/main/docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-18.md> | Previous prompt-to-artifact dashboard |
| May 19 operator dashboard | <https://github.com/affaan-m/ECC/blob/main/docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-19.md> | Previous prompt-to-artifact dashboard with hypergrowth, video, and outbound lanes |
| May 20 operator dashboard | <https://github.com/affaan-m/ECC/blob/main/docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-20.md> | Current prompt-to-artifact dashboard with Marketplace Pro release-gate sync |
| npm package page | <https://www.npmjs.com/package/ecc-universal> | `npm view ecc-universal name version dist-tags --json` returned `latest: 1.10.0`; rc.1 is not published yet |
| Codex marketplace CLI docs | <https://developers.openai.com/codex/cli/reference#codex-plugin-marketplace> | Official docs list `codex plugin marketplace add` for GitHub shorthand, Git URLs, SSH URLs, and local marketplace roots |
| Codex official Plugin Directory status | <https://developers.openai.com/codex/plugins/build#publish-official-public-plugins> | Official docs say public Plugin Directory publishing and self-serve management are coming soon |

## Approval-Gated URLs

| Surface | Intended URL or command | Gate before use |
| --- | --- | --- |
| GitHub prerelease | <https://github.com/affaan-m/ECC/releases/tag/v2.0.0-rc.1> | `gh release view v2.0.0-rc.1 --repo affaan-m/ECC --json tagName,url,isPrerelease` must return the prerelease |
| npm rc package | <https://www.npmjs.com/package/ecc-universal/v/2.0.0-rc.1> | `npm publish --tag next` approval and post-publish `npm view ecc-universal dist-tags --json` |
| Claude plugin tag | `claude plugin tag .claude-plugin --dry-run`, then real tag only after approval | Clean release commit and plugin tag/push approval |
| Codex repo marketplace install | `codex plugin marketplace add affaan-m/ECC --ref v2.0.0-rc.1` | GitHub tag must exist; official Plugin Directory submission remains separate |
| ECC Tools native-payments announcement | ECC Tools Marketplace/App URL plus selected-target billing readiness readback through the operator bearer path | Marketplace-managed selected target returned `announcementGate.ready === true` on 2026-05-20; repeat immediately before publication |
| Public announcements | X, LinkedIn, GitHub release, and longform URLs | GitHub release, npm, plugin, and billing URLs must resolve first |

## Pre-Post Check

Run these immediately before publication:

```bash
git status --short --branch
gh release view v2.0.0-rc.1 --repo affaan-m/ECC --json tagName,url,isPrerelease
npm view ecc-universal name version dist-tags --json
codex plugin marketplace add --help
rg -n "TODO|TBD|PLACEHOLDER" docs/releases/2.0.0-rc.1
npm run preview-pack:smoke
npm run release:approval-gate -- --format json
```

Do not post the social or notification copy until the approval-gated URLs above
resolve from a clean release commit.
