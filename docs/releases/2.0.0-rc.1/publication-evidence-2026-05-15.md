# ECC v2.0.0-rc.1 Publication Evidence - 2026-05-15

This is release-readiness evidence only. It does not create a GitHub release,
npm publication, plugin tag, marketplace submission, or announcement post.

## Source Commit

| Field | Evidence |
| --- | --- |
| Upstream main base | `1949d75e18e59a37de269d88b188fc701f5cf122` |
| Evidence branch | `codex/rc1-agentshield-86-evidence` |
| Evidence scope | Current `main` after PR #1932, #1933, #1934, #1935, and #1936; AgentShield #86; and ECC-Tools #75 |
| Git remote | `https://github.com/affaan-m/everything-claude-code.git` |
| Local status caveat | Working tree had the unrelated untracked `docs/drafts/` directory before this docs refresh |

The actual release operator should repeat all publish-facing checks from the
final release commit with a clean checkout before publishing.

## Queue And Discussion State

| Surface | Command | Result |
| --- | --- | --- |
| Trunk PRs/issues | `gh pr list` and `gh issue list` for `affaan-m/everything-claude-code` | 0 open PRs, 0 open issues |
| AgentShield PRs/issues | `gh pr list` and `gh issue list` for `affaan-m/agentshield` | 0 open PRs, 0 open issues |
| JARVIS PRs/issues | `gh pr list` and `gh issue list` for `affaan-m/JARVIS` | 0 open PRs, 0 open issues |
| ECC Tools PRs/issues | `env -u GITHUB_TOKEN gh pr list` and `env -u GITHUB_TOKEN gh issue list` for `ECC-Tools/ECC-Tools` | 0 open PRs, 0 open issues |
| ECC website PRs/issues | `env -u GITHUB_TOKEN gh pr list` and `env -u GITHUB_TOKEN gh issue list` for `ECC-Tools/ECC-website` | 0 open PRs, 0 open issues |
| Trunk discussions | GraphQL discussion count and maintainer-touch sweep | 58 total discussions; 0 without maintainer touch after May 15 maintainer comments |
| Other repo discussions | GraphQL discussion count for AgentShield, JARVIS, ECC Tools, and ECC website | Discussions disabled or 0 total |
| Platform audit | `node scripts/platform-audit.js --json --allow-untracked docs/drafts/` | Ready; open PRs 0/20, open issues 0/20, discussions needing maintainer touch 0, conflicting open PRs 0, blocking dirty files 0 |

The ECC Tools organization is reachable with the configured GitHub host
credential. In this shell, the exported `GITHUB_TOKEN` overrides that credential
and causes false 404/403 failures for `ECC-Tools/*`. Use `env -u GITHUB_TOKEN`
for ECC Tools verification commands until that environment override is cleaned
up.

## Linear Roadmap State

The detailed execution roadmap now lives in Linear project:

<https://linear.app/itomarkets/project/ecc-platform-roadmap-52b328ee03e1>

The project contains 16 issue-level lanes and 5 milestones:

| Milestone | Issues |
| --- | --- |
| Security and Access Baseline | `ITO-44`, `ITO-57`, `ITO-58` |
| ECC 2.0 Preview and Publication | `ITO-45`, `ITO-46`, `ITO-47`, `ITO-56` |
| AgentShield Enterprise Iteration | `ITO-48`, `ITO-49` |
| ECC Tools Next-Level Platform | `ITO-50`, `ITO-51`, `ITO-52`, `ITO-53`, `ITO-54`, `ITO-59` |
| Legacy Audit and Salvage | `ITO-55` |

Project documents added in Linear:

- Roadmap Index and Current Execution Baseline
- Status Update 2026-05-15
- GitHub Queue Snapshot 2026-05-15
- Completion Audit Snapshot 2026-05-15
- Discussion Queue Evidence 2026-05-15
- ECC-Tools Access Evidence 2026-05-15

## Supply-Chain Evidence

| Surface | Evidence |
| --- | --- |
| PR #1921 | Merged supply-chain IOC expansion for Mini Shai-Hulud/TanStack follow-up |
| Node IPC follow-up / PR #1924 | Added May 14 `node-ipc` malicious-version, hash, DNS, and runtime IOC coverage |
| PR #1926 | Added `platform:audit` and `security-ioc-scan` command surfaces plus release workflow IOC gates |
| PR #1932 | Added `scripts/platform-audit.js` JSON/Markdown/file-output modes so queue, discussion, roadmap, and release evidence can be captured as a durable artifact instead of terminal-only output |
| PR #1933 | Expanded home-scan IOC coverage to Claude `settings.local.json`, `.claude/hooks/hooks.json`, and user-level VS Code / Code Insiders `tasks.json` across macOS, Linux, and Windows |
| PR #1934 | Switched ordinary CI dependency caches to restore-only `actions/cache/restore` usage so test jobs do not save mutable dependency state back into shared caches |
| PR #1935 | Stabilized `ecc2` current-directory-mutating tests with a test-only serialized current-dir guard, preserving the Rust release-surface gate under parallel test execution |
| PR #1940 | Added `.github/workflows/supply-chain-watch.yml`, scheduled every 6 hours, so the TanStack/Mini Shai-Hulud/node-ipc IOC scan and npm signature/audit checks produce a durable `supply-chain-ioc-report.json` artifact |
| PR #1941 | Removed GitHub Actions dependency cache use from CI test workflows, disabled package-manager lifecycle scripts for npm/pnpm/Yarn/Bun installs, purged existing Actions caches, and added validator tests that reject unsafe install/cache patterns |
| AgentShield PR #83 | Merged Mini Shai-Hulud IOC coverage for TanStack, Mistral, OpenSearch, Guardrails, UiPath, Squawk, Claude Code / VS Code persistence, and dead-man switch artifacts |
| AgentShield PR #84 | Merged the broader Mini Shai-Hulud full-campaign affected-package table, including additional `@cap-js`, `@draftlab`, `@tallyui`, `intercom-client`, `lightning`, and related package/version IOCs |
| AgentShield PR #85 | Added GitHub Action supply-chain verification, gating, and evidence packs so AgentShield's enterprise scanner release path has a verified registry-signature surface |
| AgentShield PR #86 | Added `ci-context.json` to AgentShield evidence packs with whitelisted GitHub Actions workflow, commit, run, and runtime provenance while keeping arbitrary environment variables and tokens out of the bundle |
| ECC-Tools PR #75 | Tightened the native GitHub payments announcement gate so public billing claims remain blocked until live Marketplace-managed test-account readback is ready |
| Trunk merge commits | `f04702bdac132662c8496e817bcd850c86e2b854`, `ee85e1482e3d6322ddb2706392ea0fc97469bd26`, `13585f1092c92fa3f20ffe0d756e40c5720b0de5`, `553d507ea63bc252e815a924c0d2baea961351a1`, `c0bac4d6ced7f78a5464c6e3fd8cfbb43515a9d5`, `c2c54e7c0b84a213848b9ab3dfeb3ae16fb9844d`, `6b8a49a6eed11cc7df19d8b1f2add085b37cf466`, `1949d75e18e59a37de269d88b188fc701f5cf122`, `6951b8d5d29d13cac6b89b461104ad03838553de`, `f7035b5644ffc857879b71c39353b2141f17c3f0` |
| AgentShield merge commits | `f899b27ba3fa60ec7e0dca41cc2dadcb1a1fb75d`, `d1aa5313afd915d0b7296e57aabaeb979b1ea93b`, `908d8f3a52a6a65b21e737339b56906603eb1345`, `69a5e25b675b77666d0c96abc22639a5ba883403` |
| ECC-Tools merge commits | `6d00d67043e92cadc80f160bfe947115bfef33b1` |
| Local IOC tests | `node tests/ci/scan-supply-chain-iocs.test.js` passed 15/15 |
| Unicode safety | `node scripts/ci/check-unicode-safety.js` passed |
| IOC scan | `node scripts/ci/scan-supply-chain-iocs.js --root <ECC-workspace> --home` passed with 229 files inspected after the no-lifecycle install refresh |
| npm registry verification | `npm audit signatures` verified 241 registry signatures and 30 attestations; `npm audit --audit-level=high` found 0 vulnerabilities |
| Actions cache purge | `gh cache delete --all --succeed-on-no-caches` completed and `gh cache list --limit 20` returned no caches |
| Rust release-surface gate | `cd ecc2 && cargo test` passed 462/462 with the existing 14 dead-code/unused warnings |
| Root suite | `node tests/run-all.js` passed 2442/2442, 0 failed |
| Repo sweeps | Targeted persistence path checks found no active `gh-token-monitor`, `pgsql-monitor`, `transformers.pyz`, or `pgmonitor.py` artifacts |

The May 15 IOC expansion added coverage for OpenSearch/Mistral/Guardrails/
UiPath/Squawk-style campaign variants, `opensearch_init.js`, `vite_setup.mjs`,
dead-drop/session protocol strings, and AI-tooling persistence surfaces without
committing full high-entropy indicators that trip secret scanners.
The May 15 node-ipc follow-up blocks `node-ipc@9.1.6`, `9.2.3`, `10.1.1`,
`10.1.2`, `11.0.0`, `11.1.0`, and `12.0.1`, plus the `node-ipc.cjs` payload
hash, malicious tarball hashes, DNS exfil domains, and runtime markers reported
by Socket.
AgentShield PR #83 adds the matching scanner-side enterprise coverage:
version-pinned package detections, `.claude` / `.vscode` automation-surface
discovery, `gh-token-monitor` LaunchAgent/systemd/local-bin artifact detection,
network/payload IOCs, built action/CLI bundles, 1758/1758 local tests, and
green GitHub Actions verification before merge.
AgentShield PR #84 closes the later full-campaign package-table gap by adding
the extra affected npm package scopes and unscoped packages reported in the
current Wiz table, rebuilding `dist/action.js` and `dist/index.js`, and passing
1758/1758 local tests plus the full AgentShield GitHub Actions matrix before
merge.
AgentShield PR #85 and trunk PRs #1934, #1940, and #1941 extend the response
from IOC detection into release-path hardening: AgentShield now records
registry-signature evidence for its action surface, trunk has a scheduled IOC
watch workflow, and trunk CI no longer uses dependency caches or package-manager
lifecycle scripts in the test install matrix during active supply-chain
hardening.
AgentShield PR #86 completes the next evidence-pack provenance slice:
`agentshield scan --evidence-pack <dir>` now writes `ci-context.json`, includes
that artifact in the signed bundle digest, documents it in the bundle README,
and verifies that token-bearing environment variables such as `GITHUB_TOKEN`
are not copied into long-lived security-review artifacts. The PR passed local
build, typecheck, lint, 1764/1764 tests, and the full GitHub Actions matrix
across Node 18, 20, and 22 before merge.
PR #1933 closes the practical workstation persistence gap for the documented
Claude Code and VS Code automation paths, including user-level config files that
survive package uninstall.

## Preview Pack State

`preview-pack-manifest.md` now assembles the rc.1 preview-pack boundary:

- release notes, quickstart, launch checklist, publication readiness, naming
  matrix, and May 15 evidence;
- `docs/HERMES-SETUP.md` and `skills/hermes-imports/SKILL.md` as the public
  Hermes-specialized surface;
- cross-harness, harness-adapter, observability, and progress-sync docs;
- X, LinkedIn, article, Telegram, and demo collateral that must receive final
  live URLs after release/package/plugin publication;
- explicit blockers for GitHub release, npm `next` publish, Claude plugin,
  Codex plugin, ECC Tools billing/product-readiness, and announcements.

The preview pack is assembled for final clean-checkout gating, but it is still
not a publication action.

## Codex Marketplace Evidence

OpenAI's current Codex plugin docs now distinguish repo/personal marketplace
distribution from the official Plugin Directory. Repo marketplaces live at
`.agents/plugins/marketplace.json`; `codex plugin marketplace add <source>`
can add GitHub shorthand, Git URLs, SSH URLs, or local marketplace roots.
Official Plugin Directory publishing and self-serve management are documented
as coming soon:

- <https://developers.openai.com/codex/plugins/build#add-a-marketplace-from-the-cli>
- <https://developers.openai.com/codex/plugins/build#how-codex-uses-marketplaces>
- <https://developers.openai.com/codex/plugins/build#publish-official-public-plugins>

| Surface | Evidence |
| --- | --- |
| CLI shape | `codex plugin marketplace add --help` supports GitHub shorthand, Git URLs, SSH URLs, local marketplace roots, `--ref`, and Git-only `--sparse` |
| Repo marketplace | `.agents/plugins/marketplace.json` exposes `ecc@2.0.0-rc.1` with `source.path: "./"` from the marketplace root |
| Local add smoke | `HOME="$(mktemp -d)" codex plugin marketplace add <local-checkout>` added marketplace `ecc` and recorded the installed marketplace root as `<local-checkout>` without touching the real Codex config |
| README alignment | `.codex-plugin/README.md` now uses `codex plugin marketplace add`, not the stale `codex plugin install` command |
| Public-directory status | The supported Codex distribution path for rc.1 is repo-marketplace/manual install; official Plugin Directory submission remains blocked on OpenAI self-serve publishing availability |

## Current Publication Blockers

- GitHub prerelease `v2.0.0-rc.1` is still not created in this pass.
- npm `ecc-universal@2.0.0-rc.1` is still not published to the `next` dist-tag.
- Claude plugin tag and marketplace propagation remain approval-gated.
- Codex plugin repo-marketplace distribution is verified for rc.1, but official
  Plugin Directory publishing is still blocked on OpenAI's coming-soon
  self-serve publishing surface.
- ECC Tools PR #73 added a fail-closed `/api/billing/readiness`
  `announcementGate` for native GitHub payments claims, and ECC Tools PR #74
  added `npm run billing:announcement-gate` as the operator verifier, but the
  live Marketplace-managed test-account readback still must return
  `announcementGate.ready === true` before any public payment announcement.
- Release notes, X, LinkedIn, and longform copy still need final live URLs after
  release/package/plugin URLs exist.

## Result

The queue, discussion, Linear roadmap, and supply-chain evidence are fresher
than the May 13 publication evidence. They improve readiness, but they do not
replace the final clean-checkout publish pass required by
`publication-readiness.md`.
