# ECC v2.0.0-rc.1 Publication Evidence - 2026-05-16

This is release-readiness evidence only. It does not create a GitHub release,
npm publication, plugin tag, marketplace submission, or announcement post.

## Source Commit

| Field | Evidence |
| --- | --- |
| Upstream main | `6bced468d76b269243a6f0bd28472853aa78e0e4` |
| Git remote | `https://github.com/affaan-m/everything-claude-code.git` |
| Evidence scope | Current `main` after PR #1944, PR #1945, issue #1946 triage, PR #1947 supply-chain protection, AgentShield PR #87, AgentShield PR #88, AgentShield PR #89, AgentShield PR #90, AgentShield PR #91, AgentShield PR #92, ECC-Tools PR #76, ECC-Tools PR #77, ECC-Tools PR #78, Japanese localization triage, ITO-57 sync, and operator dashboard refresh |
| Local status caveat | `git status --short --branch` showed `## main...origin/main` plus unrelated untracked `docs/drafts/` |

The actual release operator should repeat all publish-facing checks from the
final release commit with a strictly clean checkout before publishing.

## Queue And Discussion State

| Surface | Command | Result |
| --- | --- | --- |
| Trunk PRs | `gh pr list --state open --json number,title,url --limit 20` | 6 open PRs: Dependabot #1959-#1963 plus PR #1953, which remains open with changes requested for Japanese localization parity |
| Trunk issues | `gh issue list --state open --json number,title,url --limit 20` | 3 open issues: #1951 linked to held localization PR, plus #1957 and #1958 awaiting the next queue batch |
| Platform audit | `node scripts/platform-audit.js --json --allow-untracked docs/drafts/` | Ready; open PRs 6, open issues 3, discussion maintainer-touch gaps 0, discussion missing-answer gaps 0, blocking dirty files 0 on a clean checkout; current branch generation sees the mirror edits as local dirty work |
| Operator dashboard | `npm run operator:dashboard -- --json --allow-untracked docs/drafts/` | `dashboardReady: true`, `platformReady: true`, head `6bced468d76b269243a6f0bd28472853aa78e0e4` |

## Merge And Triage Batch

| Item | Result |
| --- | --- |
| PR #1944 | Merged statusline ANSI palette update as `50ac061f9e72d7daa137f1bd08760cf74e9b577d`; targeted `node tests/hooks/ecc-statusline.test.js` and `node scripts/ci/validate-hooks.js` passed before merge |
| PR #1945 | Merged `recsys-pipeline-architect` community skill as `9e973b29fb1a2a0aeb9e6980017b67c3ddb05201`; maintainer patches synced catalog counts and removed emoji blocked by Unicode safety |
| Issue #1946 | Closed as triaged with a corrected maintainer comment; Linear `ITO-60` now tracks GateGuard proactive fact-forcing preflight UX |
| PR #1947 | Merged scheduled supply-chain watch/advisory-source evidence as `4093d1bb7a14db1b4d4ea5bd00f2073baf94bfb0`; trunk now has the TanStack/Mini Shai-Hulud/node-ipc IOC scan plus advisory-source report surfaces wired into scheduled watch evidence |
| AgentShield PR #87 | Merged plugin-cache runtime-confidence classification as `26bb44650663816d07180e0d20c1895e431a326c`; installed Claude plugin cache findings now emit `runtimeConfidence: plugin-cache`, `plugins/cache` only maps to Claude cache under `.claude`, and cached hook implementations are no longer mislabeled as active `hook-code` |
| AgentShield PR #88 | Merged evidence-pack inspect/readback as `65ed6e2a87545dc99d962b58413f49096a4d70ec`; `agentshield evidence-pack inspect` now emits verified JSON/text summaries for report, policy, baseline, supply-chain, CI context, remediation, and malformed artifact errors |
| AgentShield PR #89 | Merged evidence-pack fleet routing as `521ada9091bb6d818511ab8589ae675b920c106a`; `agentshield evidence-pack fleet <dirs...> [--json]` now aggregates multiple verified bundles into ready, security-blocker, policy-review, baseline-regression, supply-chain-review, and invalid routes with finding, policy, baseline, supply-chain, and remediation totals |
| AgentShield PR #90 | Merged fleet review items as `6d1c57c92000541d65a3b6bc366f0322d7d0dacc`; `agentshield evidence-pack fleet --json` now emits `reviewItems` with route, severity, repository/target context, source evidence paths, reason, and owner-ready recommendation, and the text CLI prints a `Review items` block |
| AgentShield PR #91 | Merged checksum-backed policy export as `73e1e3586dc4513a462e39c9799f75eea104e110`; `agentshield policy export` writes one JSON policy file per selected pack plus `manifest.json` with SHA-256 digests, and supports pack selection, repeated owners, name prefixes, and JSON output |
| AgentShield PR #92 | Merged checksum-verified policy promotion as `e7e259dc6212b63a8e03a253ca6b8c1e3c2abff7`; `agentshield policy promote` verifies the export manifest and selected policy digest, rejects tampered JSON, requires explicit pack selection for multi-pack manifests, supports dry-run JSON review, and writes the active policy only after verification |
| ECC-Tools PR #76 | Merged AgentShield fleet-summary consumption as `5bde2328d15f584481fb6334e6960716dbf3e16f`; hosted `security-evidence-review` now recognizes `agentshield-evidence/fleet-summary.json`, classifies it as `evidence-pack-fleet`, routes invalid/security-blocker/policy/baseline/supply-chain fleet outcomes into hosted findings, and fails closed on malformed fleet JSON |
| ECC-Tools PR #77 | Merged hosted finding source-evidence output as `31fd883b3f0cee135aee4839b01d34855b7867f6`; hosted job PR comments and check-run details now include an `Evidence` column with up to three source evidence paths per finding, including AgentShield fleet-derived findings |
| ECC-Tools PR #78 | Merged AgentShield fleet-route harness review as `0d4eb949aa56f56da88e6654273a22ffb95983a1`; hosted `harness-compatibility-audit` now collects fleet summaries, maps route target paths to Claude/Codex/OpenCode/MCP/plugin harness owners, and emits owner-review findings with source evidence paths |
| ITO-57 | Updated with PR #1947 advisory-source evidence, post-merge source refresh, IOC scan, npm audit/signature checks, and OpenAI app update caveat |
| ITO-49 | Updated with AgentShield PR #87, #88, #89, #90, #91, and #92 merge evidence, local test evidence, CI status, live `~/.claude` scan classification counts, local Mini Shai-Hulud protection scan results, and policy promotion validation |
| ITO-50 | Updated with ECC-Tools PR #76, PR #77, and PR #78 merge evidence, hosted security review behavior, hosted finding evidence-path behavior, harness fleet-route owner-review behavior, local test evidence, and remote Verify/Security Audit/Workers build checks |
| ITO-44 | Updated with queue cleanup, dashboard refresh, and remaining macro gaps |

## Release Gate Commands

| Gate | Command | Result |
| --- | --- | --- |
| Root suite | `npm test` | 2469 passed, 0 failed |
| Rust `ecc2` suite | `cd ecc2 && cargo test` | 462 passed, 0 failed; existing dead-code/unused warnings only |
| Release surface | `node tests/docs/ecc2-release-surface.test.js` | 20 passed |
| Harness adapters | `npm run harness:adapters -- --check` | PASS; 11 adapters |
| Harness audit | `npm run harness:audit -- --format json` | 70/70, no top actions |
| Observability readiness | `npm run observability:ready` | 21/21, ready yes |
| Supply-chain IOC scan | `npm run security:ioc-scan` | Passed; 227 files inspected |
| Advisory source refresh | `npm run security:advisory-sources -- --refresh --json` | Ready; 9 active sources; Linear payload still points at `ITO-57` for sync |
| npm audit | `npm audit --audit-level=moderate` | 0 vulnerabilities |
| npm signatures | `npm audit signatures` | 241 verified registry signatures; 30 verified attestations |
| Dashboard renderer | `node tests/scripts/operator-readiness-dashboard.test.js` | 7 passed, 0 failed |

## Current Publication Blockers

- GitHub prerelease `v2.0.0-rc.1` is still not created in this pass.
- npm `ecc-universal@2.0.0-rc.1` is still not published to the `next` dist-tag.
- Claude plugin tag and marketplace propagation remain approval-gated.
- Codex repo-marketplace distribution is verified for rc.1, but official
  Plugin Directory publishing remains blocked on OpenAI's coming-soon
  self-serve publishing surface.
- ECC Tools billing/native-payments copy remains blocked until live
  Marketplace-managed test-account readback returns an announcement-ready gate.
- Release notes, X, LinkedIn, GitHub release, and longform copy still need final
  live URLs after release/package/plugin URLs exist.
- The local checkout still has unrelated untracked `docs/drafts/`, so a strict
  clean-checkout release pass remains required before real publication.

## Result

The public PR queue, issue queue, and discussion queue are clear, and the rc.1
preview pack passed the main Node, Rust, release-surface, harness, observability,
and supply-chain gates on May 16, 2026. This improves publication readiness but
does not replace the approval-gated release, package, plugin, and announcement
steps in `publication-readiness.md`.
