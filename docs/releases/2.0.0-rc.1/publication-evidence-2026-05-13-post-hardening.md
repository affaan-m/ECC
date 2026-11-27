# ECC v2.0.0-rc.1 Publication Evidence - 2026-05-13 Post-Hardening

This is release-readiness evidence only. It does not create a GitHub release,
npm publication, plugin tag, marketplace submission, or announcement post.

## Source Commit

| Field | Evidence |
| --- | --- |
| Upstream main base | `209abd403b7eaa968c6d4fa67be82e04b55706d6` |
| Evidence branch | `docs/post-hardening-release-evidence-20260513` |
| Evidence scope | Current `main` after PR #1850 and PR #1851 |
| Git remote | `https://github.com/affaan-m/everything-claude-code.git` |
| Local status caveat | Working tree had the unrelated untracked `docs/drafts/` directory |

The actual release operator should repeat these checks from the final release
commit with a clean checkout before publishing.

## Queue And Release State

| Surface | Command | Result |
| --- | --- | --- |
| GitHub PRs and issues | `gh pr list` / `gh issue list` across trunk, AgentShield, and JARVIS | 0 open PRs and 0 open issues on accessible `affaan-m` repos |
| Trunk discussions | GraphQL discussion count for `affaan-m/everything-claude-code` | 0 open discussions |
| Dependabot alerts | Dependabot alert API for trunk, AgentShield, and JARVIS | 0 open alerts |
| Release state | `gh release view v2.0.0-rc.1` | Still not created; release remains approval-gated |

ECC-Tools organization repo counts were not rechecked through the current
GraphQL token in this pass because the token cannot resolve those org repos.
The prior post-#42 local checkout handoff recorded both ECC-Tools repos at
0 open PRs and 0 open issues.

## Hardening Landed Since Previous Evidence

| PR | Merge commit | Evidence |
| --- | --- | --- |
| #1850 | `248673271455e9dc85b8add2a6ab76107b718639` | Removed `Bash` tool access from read-only analyzer agents and zh-CN copies; AgentShield high findings on that surface dropped 21 -> 18 with no new high findings |
| #1851 | `209abd403b7eaa968c6d4fa67be82e04b55706d6` | Disabled `actions/checkout` credential persistence in write-permission workflows and added a workflow-security validator rule to keep that guard in place |

## Required Command Evidence

| Evidence | Command | Result |
| --- | --- | --- |
| Harness audit | `npm run harness:audit -- --format json` | `overall_score: 70`, `max_score: 70`, no top actions |
| Adapter scorecard | `npm run harness:adapters -- --check` | `Harness Adapter Compliance: PASS`; 11 adapters |
| Observability readiness | `npm run observability:ready -- --format json` | `overall_score: 21`, `max_score: 21`, `ready: true`, no top actions; includes Release Safety 3/3 |
| Workflow security validator | `node scripts/ci/validate-workflow-security.js` | Validated 7 workflow files |
| Workflow validator tests | `node tests/ci/validate-workflow-security.test.js` | Passed 14/14 |
| Release surface | `node tests/docs/ecc2-release-surface.test.js` | Passed 18/18 |
| Package surface | `node tests/scripts/npm-publish-surface.test.js` | Passed 2/2 |
| Root suite | `node tests/run-all.js` | Passed 2381/2381, 0 failed |
| Markdown lint | `npx markdownlint-cli '**/*.md' --ignore node_modules --ignore docs/drafts` | Passed |
| Rust surface | `cd ecc2 && cargo test` | Passed 462/462; warnings only for unused functions/fields |
| GitGuardian Security Checks | GitHub check on post-hardening security PRs | Passed before merge |

## Supply-Chain Evidence

| Surface | Command or check | Result |
| --- | --- | --- |
| Local npm vulnerability audit | `npm audit --json` | 0 vulnerabilities |
| Local npm signature audit | `npm audit signatures` | 241 verified registry signatures and 30 verified attestations |
| Rust advisory audit | `cd ecc2 && cargo audit -q` | Passed silently |
| TanStack / Mini Shai-Hulud IOC check | Grep for affected package namespaces, payload filenames, and known commit marker | No runtime or lockfile dependency on affected packages; no worm IOC matches |
| GitGuardian Security Checks | GitHub check on post-hardening security PRs | Passed before merge |

## External Advisory Mapping

The May 2026 TanStack incident maps to ECC release risk through three workflow
classes:

- `pull_request_target` workflows that execute or checkout untrusted PR code;
- shared dependency caches crossing fork, base, and release workflow trust
  boundaries;
- release jobs with writable tokens or OIDC tokens exposed to subsequent
  process execution.

ECC's current guardrails cover those classes through:

- rejection of untrusted checkout refs in `workflow_run` and
  `pull_request_target` workflows;
- rejection of shared caches in `pull_request_target` and `id-token: write`
  workflows;
- mandatory `npm audit signatures` when workflows run `npm audit`;
- mandatory `npm ci --ignore-scripts` in workflows with write permissions;
- mandatory `persist-credentials: false` on `actions/checkout` in workflows
  with write permissions.

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
