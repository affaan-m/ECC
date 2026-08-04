# ECC v2.0.0-rc.1 Publication Evidence - 2026-05-13

This is release-readiness evidence only. It does not create a GitHub release,
npm publication, plugin tag, marketplace submission, or announcement post.

## Source Commit

| Field | Evidence |
| --- | --- |
| Upstream main base | `797f283036904128bb1b348ae62019eb9f08cf39` |
| Evidence branch | `docs/release-readiness-20260513` |
| Evidence scope | Current `main` after PR #1846 plus markdownlint-only zh-CN CLAUDE list-marker normalization |
| Git remote | `https://github.com/affaan-m/everything-claude-code.git` |
| Local status caveat | Working tree had the unrelated untracked `docs/drafts/` directory |

The actual release operator should repeat these checks from the final release
commit with a clean checkout before publishing.

## Queue And Release State

| Surface | Command | Result |
| --- | --- | --- |
| GitHub PRs and issues | `gh pr list` / `gh issue list` across trunk, AgentShield, JARVIS, ECC-Tools, ECC-website | 0 open PRs and 0 open issues across tracked repos |
| Trunk discussions | GraphQL discussion sweep for `affaan-m/everything-claude-code` | Latest 100 discussions were closed; no open discussion backlog found |
| npm audit signature gate | PR #1846 | Merged as `797f283`; workflows that run `npm audit` now need `npm audit signatures` |

## Required Command Evidence

| Evidence | Command | Result |
| --- | --- | --- |
| Harness audit | `npm run harness:audit -- --format json` | `overall_score: 70`, `max_score: 70`, no top actions |
| Adapter scorecard | `npm run harness:adapters -- --check` | `Harness Adapter Compliance: PASS`; 11 adapters |
| Observability readiness | `npm run observability:ready -- --format json` | `overall_score: 16`, `max_score: 16`, `ready: true`, no top actions |
| Root suite | `node tests/run-all.js` | `2376` passed, `0` failed |
| Markdown lint | `npx markdownlint-cli '**/*.md' --ignore node_modules` | Passed after normalizing two zh-CN CLAUDE docs from asterisk bullets to dash bullets |
| Package surface | `node tests/scripts/npm-publish-surface.test.js` | Passed `2/2`; package surface still excludes Python bytecode/cache artifacts |
| Release surface | `node tests/docs/ecc2-release-surface.test.js` | Passed `18/18` |
| Rust surface | `cd ecc2 && cargo test` | Passed `462/462`; warnings only for unused functions/fields |

## Security Gate Evidence

| Surface | Command or check | Result |
| --- | --- | --- |
| Local npm signature audit | `npm audit signatures` before PR #1846 | 241 verified registry signatures and 30 verified attestations |
| Local npm vulnerability audit | `npm audit --audit-level=high` before PR #1846 | 0 vulnerabilities |
| Workflow security validator | `node scripts/ci/validate-workflow-security.js` | Validated 7 workflow files |
| Workflow validator tests | `node tests/ci/validate-workflow-security.test.js` | Passed `11/11`, including the new signature-gate cases |
| GitHub CI for #1846 | Current-head PR checks | Full OS/package-manager matrix passed, including `windows-latest / Node 18.x / pnpm` |

## Blockers Still Requiring Approval Or External Action

- Create or verify GitHub prerelease `v2.0.0-rc.1`.
- Publish `ecc-universal@2.0.0-rc.1` with npm dist-tag `next`.
- Create and push the Claude plugin tag only after explicit approval.
- Confirm the live Claude/Codex/OpenCode marketplace submission path or record
  the manual submission owner and status.
- Verify ECC Tools billing/App/Marketplace claims before using them in launch
  copy.
- Refresh announcement copy with live URLs after release and package/plugin
  URLs exist.
