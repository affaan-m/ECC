# ECC v2.0.0-rc.1 Publication Readiness

This checklist is the release gate for public publication surfaces. Do not use
it as evidence by itself. Fill the evidence fields with fresh command output or
URLs from the exact commit being released.

For the current rc.1 naming decision and package/plugin publication path, see
[`naming-and-publication-matrix.md`](naming-and-publication-matrix.md).
For the May 18 release name, package, Claude plugin, Codex plugin, and
publication-order gate, see
[`release-name-plugin-publication-checklist-2026-05-18.md`](release-name-plugin-publication-checklist-2026-05-18.md).
For the assembled rc.1 preview pack boundary, see
[`preview-pack-manifest.md`](preview-pack-manifest.md).
For the May 12 dry-run evidence pass, see
[`publication-evidence-2026-05-12.md`](publication-evidence-2026-05-12.md).
For the May 13 release-readiness evidence refresh, see
[`publication-evidence-2026-05-13.md`](publication-evidence-2026-05-13.md).
For the May 13 post-hardening evidence refresh after PR #1850 and PR #1851, see
[`publication-evidence-2026-05-13-post-hardening.md`](publication-evidence-2026-05-13-post-hardening.md).
For the May 15 queue, discussion, Linear roadmap, Mini Shai-Hulud/TanStack
follow-up, scheduled supply-chain watch, no-lifecycle CI install hardening,
GitHub Actions cache purge, AgentShield release-verification, billing-gate,
AgentShield #86 evidence-pack provenance, and `ecc2` current-dir guard evidence
refresh through PR #1941, see
[`publication-evidence-2026-05-15.md`](publication-evidence-2026-05-15.md).
For the May 16 queue cleanup, recsys skill merge, GateGuard issue triage,
AgentShield #87 plugin-cache runtime-confidence evidence, AgentShield #88
evidence-pack inspect/readback, AgentShield #89 evidence-pack fleet routing,
AgentShield #90 fleet review items, AgentShield #91 checksum-backed policy
export, AgentShield #92 checksum-verified policy promotion, ECC-Tools #76
fleet-summary consumption, ECC-Tools #77 hosted finding evidence paths,
ECC-Tools #78 harness policy-route linking, operator dashboard refresh, and
combined final-gate rerun on current `main`, see
[`publication-evidence-2026-05-16.md`](publication-evidence-2026-05-16.md).
For the May 17 queue cleanup, Japanese localization merge, Dependabot
TypeScript and Node type merges, post-merge ja-JP lint repair, Mini
Shai-Hulud/TanStack local protection recheck, legacy-tail and Linear progress
routing, deterministic preview-pack smoke gate, and current operator dashboard
refresh, see
[`publication-evidence-2026-05-17.md`](publication-evidence-2026-05-17.md).
For the May 18 current-head queue, workflow-security/metrics/uncloud merge
batch, PR #1978 review/closure, Mini Shai-Hulud/TanStack local and home
protection recheck, npm no-lifecycle install/audit/signature gates,
AgentShield project scan, AgentShield `840952a` enterprise/IOC evidence mirror,
release OIDC publishing-scope hardening, workflow normalization, later
dashboard/publication-readiness refreshes through `67e63e63`, work-items sync,
Linear progress comments, ITO-46 closure, operator dashboard refresh, and
current-head CI/security scan success through the May 19 identity, video, and
growth-pack merge batch, see
[`publication-evidence-2026-05-19.md`](publication-evidence-2026-05-19.md).
For the operator-facing prompt-to-artifact readiness dashboard from the same
May 16 pass, see
[`operator-readiness-dashboard-2026-05-15.md`](operator-readiness-dashboard-2026-05-15.md).
For the May 17 operator dashboard refresh, see
[`operator-readiness-dashboard-2026-05-17.md`](operator-readiness-dashboard-2026-05-17.md).
For the May 18 operator dashboard refresh, see
[`operator-readiness-dashboard-2026-05-18.md`](operator-readiness-dashboard-2026-05-18.md).

The current May 19 hypergrowth/operator dashboard is
[`operator-readiness-dashboard-2026-05-19.md`](operator-readiness-dashboard-2026-05-19.md).
For the May 19 live/pending release URL ledger after the public repo rename, see
[`release-url-ledger-2026-05-19.md`](release-url-ledger-2026-05-19.md).

## Release Identity Matrix

| Surface | Expected value | Source of truth | Fresh check | Evidence artifact | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Product name | ECC | `README.md`, plugin manifests, release notes | `rg -n "^# ECC\|displayName.*ECC\|affaan-m/ECC" README.md .codex-plugin/plugin.json docs/releases/2.0.0-rc.1` | `release-name-plugin-publication-checklist-2026-05-18.md` plus `release-url-ledger-2026-05-19.md` | Release owner | Evidence recorded |
| GitHub repo | `affaan-m/ECC` | Git remote and release URLs | `git remote get-url origin` | `release-url-ledger-2026-05-19.md` | Release owner | Evidence recorded |
| Git tag | `v2.0.0-rc.1` | GitHub releases | `gh release view v2.0.0-rc.1 --repo affaan-m/ECC` | `release not found` | Release owner | Blocked until release approval |
| npm package | `ecc-universal` | `package.json` | `node -p "require('./package.json').name"` | `publication-evidence-2026-05-12.md` | Package owner | Evidence recorded |
| npm version | `2.0.0-rc.1` | `VERSION`, `package.json`, lockfiles | `node -p "require('./package.json').version"` | `publication-evidence-2026-05-12.md` | Package owner | Evidence recorded |
| npm dist-tag | `next` for rc, `latest` only for GA | npm registry | `npm view ecc-universal dist-tags --json` | Current registry only has `latest: 1.10.0`; `next` is pending publish | Package owner | Blocked until publish approval |
| Claude plugin slug | `ecc` / `ecc@ecc` install path | `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | `node tests/hooks/hooks.test.js` | `publication-evidence-2026-05-12.md` | Plugin owner | Evidence recorded |
| Claude plugin manifest | `2.0.0-rc.1`, no unsupported `agents` or explicit `hooks` fields | `.claude-plugin/plugin.json`, `.claude-plugin/PLUGIN_SCHEMA_NOTES.md` | `claude plugin validate .claude-plugin/plugin.json` | `publication-evidence-2026-05-12.md` | Plugin owner | Evidence recorded |
| Codex plugin manifest | `2.0.0-rc.1` with shared skill source | `.codex-plugin/plugin.json` | `node tests/docs/ecc2-release-surface.test.js` | `publication-evidence-2026-05-12.md` | Plugin owner | Evidence recorded |
| Codex repo marketplace | `ecc@2.0.0-rc.1` exposed through `.agents/plugins/marketplace.json` | `.agents/plugins/marketplace.json`, `.codex-plugin/README.md` | `HOME="$(mktemp -d)" codex plugin marketplace add <local-checkout>` | `publication-evidence-2026-05-15.md` | Plugin owner | Repo-marketplace path verified; do not claim official Plugin Directory listing before OpenAI submission evidence |
| OpenCode package | `ecc-universal` plugin module | `.opencode/package.json`, `.opencode/index.ts` | `npm run build:opencode` | `publication-evidence-2026-05-12.md` | Package owner | Evidence recorded |
| Agent metadata | `2.0.0-rc.1` | `agent.yaml`, `.agents/plugins/marketplace.json` | `node tests/scripts/catalog.test.js` | `publication-evidence-2026-05-12.md` | Release owner | Evidence recorded |
| Migration copy | rc.1 upgrade path, not GA claim | `release-notes.md`, `quickstart.md`, `HERMES-SETUP.md` | `npx markdownlint-cli '**/*.md' --ignore node_modules` | `publication-evidence-2026-05-13.md` | Docs owner | Evidence recorded |

## Publication Gates

| Gate | Required evidence | Fresh check | Blocker field | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| GitHub release | Tag exists, release notes use final URLs, assets attached if needed | `gh release view v2.0.0-rc.1 --json tagName,url,isPrerelease` | `Blocker: release not found on 2026-05-12` | Release owner | Pending approval |
| npm package | `npm pack --dry-run` has expected files, version matches, rc goes to `next` | `npm pack --dry-run` and `npm publish --tag next --dry-run` where supported | `Blocker: actual publish requires approval; dry run passed with next tag` | Package owner | Dry-run passed |
| Claude plugin | Manifest validates, marketplace JSON points to public repo, install docs match slug | `claude plugin validate .claude-plugin/plugin.json`; `claude plugin tag .claude-plugin --dry-run`; isolated temp-home install smoke | `Blocker: real tag creation/push requires approval` | Plugin owner | Clean-checkout dry-run and install smoke recorded |
| Codex plugin | Manifest version matches package and docs, repo marketplace points at the plugin root, and OpenAI's current official Plugin Directory status is recorded | `node tests/docs/ecc2-release-surface.test.js`; `node tests/plugin-manifest.test.js`; `codex plugin marketplace add --help`; temp-home `codex plugin marketplace add <local-checkout>` | `Blocker: official Plugin Directory listing requires OpenAI submission/listing evidence` | Plugin owner | Repo-marketplace distribution verified; official directory pending |
| OpenCode package | Build output is regenerated from source and package metadata is current | `npm run build:opencode` | `Blocker: none for local build; public distribution still follows npm/plugin release` | Package owner | Evidence recorded |
| ECC Tools billing reference | Any billing claim links to verified Marketplace/App state | `env -u GITHUB_TOKEN gh repo view ECC-Tools/ECC-Tools --json nameWithOwner,isPrivate,viewerPermission` plus internal `/api/billing/readiness?accountLogin=<marketplace-test-account>` readback | `Blocker: ECC-Tools #73 added announcementGate; live Marketplace test-account readback must return announcementGate.ready === true before payment announcement` | ECC Tools owner | Code gate recorded; live billing readback pending |
| Announcement copy | X, LinkedIn, GitHub release, and longform copy point to live URLs | placeholder-marker scan and `release-url-ledger-2026-05-19.md` | `Blocker: final live release/npm/plugin/billing URLs do not exist yet; live and pending URLs are separated in the May 19 ledger` | Release owner | URL ledger recorded; final URLs pending |
| Privileged workflow hardening | Release and maintenance workflows avoid persisted checkout tokens | `node scripts/ci/validate-workflow-security.js` | `Blocker:` | Release owner | Evidence recorded in post-hardening refresh |

## Required Command Evidence

Record the exact commit SHA and command output before any publication action:

| Evidence | Command | Required result | Recorded output |
| --- | --- | --- | --- |
| Clean release branch | `git status --short --branch` | On intended release commit; no unrelated files | `3304848b`: `## main...origin/main`; repeat from the exact final publication commit before release |
| Preview-pack smoke | `npm run preview-pack:smoke` | Preview pack artifacts, Hermes boundary, final verification command list, and publication blockers pass | `publication-evidence-2026-05-19.md`: ready yes, digest `bc2bf157616e`, 30 artifacts, 5 passed, 0 failed; repeat in the final strict clean-checkout release pass |
| Harness audit | `npm run harness:audit -- --format json` | 70/70 passing | `99e01ded`: 70/70, 0 top actions |
| Adapter scorecard | `npm run harness:adapters -- --check` | PASS | `99e01ded`: PASS, 11 adapters |
| Observability readiness | `npm run observability:ready` | 21/21 passing | `publication-evidence-2026-05-18.md`: 21/21, ready yes |
| Release safety gate | `npm run observability:ready -- --format json` | Release Safety category passing with publication readiness, supply-chain, workflow security, package surface, and release-surface evidence | May 18 evidence keeps release safety passing; repeat the JSON gate from the exact final release commit |
| Supply-chain verification | `npm audit --json`; `npm audit signatures`; `cd ecc2 && cargo audit -q`; Dependabot alerts; GitGuardian Security Checks | 0 vulnerabilities/alerts, registry signatures verified, GitGuardian clean | `publication-evidence-2026-05-19.md` plus CI `26093792219`: GitGuardian and security scan passed; prior May 18 npm registry signatures and IOC scans remain the latest detailed supply-chain evidence |
| Root suite | `node tests/run-all.js` | 0 failures | `3304848b`: local `node tests/run-all.js` passed 2547/2547; PR #1999 CI `26100148726` passed the full OS/runtime/package-manager matrix for `90584b6d` |
| Markdown lint | `npx markdownlint-cli '**/*.md' --ignore node_modules` | 0 failures | CI `26093792219`: markdownlint passed on the growth-pack PR; rerun after any release-copy edits |
| Package surface | `node tests/scripts/npm-publish-surface.test.js` | 0 failures; no Python bytecode in npm tarball | `2/2` passed in May 12 evidence pass |
| Release surface | `node tests/docs/ecc2-release-surface.test.js` | 0 failures | May 19 evidence refresh: 25/25 passed after adding the video suite and partner/sponsor/talk gates |
| Optional Rust surface | `cd ecc2 && cargo test` | 0 failures or explicit deferral | `publication-evidence-2026-05-16.md`: 462/462 passed, existing warnings only |
| Queue baseline | `node scripts/platform-audit.js --json` across trunk, AgentShield, JARVIS, ECC Tools, and ECC website | Under 20 open PRs and under 20 open issues | `3304848b`: platform audit ready, 0 open PRs, 0 open issues, 0 conflicting PRs, and 0 blocking dirty files |
| Discussion baseline | `node scripts/platform-audit.js --json` and `node scripts/discussion-audit.js --json` | No unmanaged active discussion queue and no answerable Q&A missing an accepted answer | `3304848b`: platform audit sampled 58 trunk discussions, 0 needing maintainer touch, 0 answerable discussions missing accepted answer; `docs/architecture/discussion-response-playbook.md` records response templates and security escalation rules |
| Linear roadmap | Linear project and issue readback | Detailed roadmap exists with release, security, AgentShield, ECC Tools, legacy, and observability lanes | May 18 Linear comments include ITO-57 `3fe5b2b7-c4fe-401c-a317-b40d72119cb3` and ITO-44 `fb4a4f33-6c2d-421a-bbdb-63cfad3e3ee4`; earlier evidence records the project and 16 issue lanes |
| Operator readiness dashboard | `npm run operator:dashboard -- --json` | Current queue state mapped to macro-goal deliverables and incomplete gaps | `3304848b`: regenerated May 19 dashboard from current main; platform audit ready true, 0 open PRs, 0 open issues, 0 discussion gaps, 0 dirty files, release video suite current, and publication gates still approval-gated |
| Release URL ledger | `docs/releases/2.0.0-rc.1/release-url-ledger-2026-05-19.md` plus placeholder-marker scan | Live links and approval-gated links are separated before announcement copy is posted | Ledger records public repo/docs/npm/OpenAI Codex documentation URLs and blocks GitHub release/npm/plugin/billing/social URLs until approval-gated checks pass |
| Release name and plugin publication checklist | `docs/releases/2.0.0-rc.1/release-name-plugin-publication-checklist-2026-05-18.md` | Name/package/plugin values are frozen, final-release commands are listed, and Claude/Codex publication paths cite current official docs | Checklist keeps `ECC`, `ecc-universal`, and plugin slug `ecc` for rc.1; no npm rename, npm publish, plugin tag, official listing, billing claim, or announcement before final evidence |

## Do Not Publish If

- `main` has unreviewed release-surface changes after the evidence was recorded.
- `npm view ecc-universal dist-tags --json` contradicts the intended rc/GA tag.
- Claude plugin validation is unavailable or no clean-checkout install smoke
  test is recorded for the intended release commit.
- Release notes or announcement drafts still contain placeholder URLs,
  `TODO`, `TBD`, private workspace paths, or personal operator references.
- Billing, Marketplace, or plugin-submission copy claims a live surface before
  the live URL exists.
- Stale PR salvage work is mid-flight on the same branch.

## Announcement Order

1. Merge the release-version PR.
2. Record the required command evidence from the release commit.
3. Create or verify the GitHub prerelease.
4. Publish npm with the rc dist-tag.
5. Submit or update plugin marketplace surfaces.
6. Regenerate the release URL ledger and update release notes with final live
   URLs.
7. Publish GitHub release copy.
8. Publish X, LinkedIn, and longform copy only after the public URLs work.
