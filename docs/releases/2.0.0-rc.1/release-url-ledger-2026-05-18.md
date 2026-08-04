# ECC v2.0.0-rc.1 Release URL Ledger

This ledger separates links that are already public from links that only become
valid after the approval-gated release, package, plugin, and announcement
steps. Regenerate it from the final release commit before posting any public
announcement.

Captured from source snapshot
`81fca2cea6f1399c52c8faa70f9a17e42f0bd447` on 2026-05-18. The ledger file
may be committed in a later docs-only refresh after the evidence snapshot it
describes.

## Live Now

| Surface | URL | Verification |
| --- | --- | --- |
| Repository | <https://github.com/affaan-m/everything-claude-code> | `git remote get-url origin` |
| Evidence source commit | <https://github.com/affaan-m/everything-claude-code/commit/81fca2cea6f1399c52c8faa70f9a17e42f0bd447> | `git rev-parse HEAD` at evidence capture |
| Release pack folder | <https://github.com/affaan-m/everything-claude-code/tree/main/docs/releases/2.0.0-rc.1> | Release pack evidence captured from `81fca2ce` |
| Release notes draft | <https://github.com/affaan-m/everything-claude-code/blob/main/docs/releases/2.0.0-rc.1/release-notes.md> | In-tree release copy |
| Hermes setup guide | <https://github.com/affaan-m/everything-claude-code/blob/main/docs/HERMES-SETUP.md> | In-tree sanitized Hermes guide |
| May 18 evidence snapshot | <https://github.com/affaan-m/everything-claude-code/blob/main/docs/releases/2.0.0-rc.1/publication-evidence-2026-05-18.md> | Current strongest readiness evidence |
| May 18 operator dashboard | <https://github.com/affaan-m/everything-claude-code/blob/main/docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-18.md> | Prompt-to-artifact dashboard |
| Pushed-head CI | <https://github.com/affaan-m/everything-claude-code/actions/runs/26011460500> | CI passed 37/37 jobs for `81fca2ce`, including the supply-chain IOC scan job |
| Latest Supply-Chain Watch | <https://github.com/affaan-m/everything-claude-code/actions/runs/26010432490> | Supply-Chain Watch passed for `25ac57ac`; rerun from the final release commit before publication |
| npm package page | <https://www.npmjs.com/package/ecc-universal> | `npm view ecc-universal name version dist-tags --json` returned `latest: 1.10.0`; rc.1 is not published yet |
| Codex marketplace CLI docs | <https://developers.openai.com/codex/cli/reference#codex-plugin-marketplace> | Official docs list `codex plugin marketplace add` for GitHub shorthand, Git URLs, SSH URLs, and local marketplace roots |
| Codex official Plugin Directory status | <https://developers.openai.com/codex/plugins/build#publish-official-public-plugins> | Official docs say public Plugin Directory publishing and self-serve management are coming soon |

## Approval-Gated URLs

| Surface | Intended URL or command | Gate before use |
| --- | --- | --- |
| GitHub prerelease | <https://github.com/affaan-m/everything-claude-code/releases/tag/v2.0.0-rc.1> | `gh release view v2.0.0-rc.1 --repo affaan-m/everything-claude-code --json tagName,url,isPrerelease` must return the prerelease |
| npm rc package | <https://www.npmjs.com/package/ecc-universal/v/2.0.0-rc.1> | `npm publish --tag next` approval and post-publish `npm view ecc-universal dist-tags --json` |
| Claude plugin tag | `claude plugin tag .claude-plugin --dry-run`, then real tag only after approval | Clean release commit and plugin tag/push approval |
| Codex repo marketplace install | `codex plugin marketplace add affaan-m/everything-claude-code --ref v2.0.0-rc.1` | GitHub tag must exist; official Plugin Directory submission remains separate |
| ECC Tools native-payments announcement | ECC Tools Marketplace/App URL plus billing readiness readback | Marketplace-managed test account must return `announcementGate.ready === true` |
| Public announcements | X, LinkedIn, GitHub release, and longform URLs | GitHub release, npm, plugin, and billing URLs must resolve first |

## Pre-Post Check

Run these immediately before publication:

```bash
git status --short --branch
gh release view v2.0.0-rc.1 --repo affaan-m/everything-claude-code --json tagName,url,isPrerelease
npm view ecc-universal name version dist-tags --json
codex plugin marketplace add --help
rg -n "TODO|TBD|PLACEHOLDER" docs/releases/2.0.0-rc.1
npm run preview-pack:smoke
```

Do not post the social or notification copy until the approval-gated URLs above
resolve from a clean release commit.
