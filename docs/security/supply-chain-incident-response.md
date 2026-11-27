# Supply-Chain Incident Response

This playbook is the ECC operator runbook for npm, GitHub Actions, and
cross-ecosystem package-registry incidents. It is intentionally conservative:
registry signatures, provenance, and trusted publishing are useful signals, but
they do not prove that the workflow executed the intended code path.

## Current External Trigger

As of 2026-05-15, the active incident class is the May 2026 TanStack npm
supply-chain compromise and broader Mini Shai-Hulud campaign. ECC keeps the
same IOC sweep for the related npm/PyPI waves because these incidents target
package install/publish paths, AI developer-tool configs, and developer
credentials:

- TanStack reported 84 malicious versions across 42 `@tanstack/*` packages,
  published on 2026-05-11 between 19:20 and 19:26 UTC.
- GitHub advisory `GHSA-g7cv-rxg3-hmpx` / `CVE-2026-45321` describes
  install-time malware that harvests cloud credentials, GitHub tokens, npm
  credentials, Vault tokens, Kubernetes tokens, and SSH private keys.
- Follow-on reporting from StepSecurity, Socket, Aikido, and Wiz describes the
  same campaign expanding into packages associated with Mistral AI, UiPath,
  OpenSearch, Guardrails AI, Squawk, and other npm/PyPI packages.
- Socket's 2026-05-14 `node-ipc` report describes a separate active npm
  compromise affecting `node-ipc` versions `9.1.6`, `9.2.3`, and `12.0.1`,
  with historical malicious `node-ipc` versions also blocked by ECC because
  they carried destructive or unauthorized file-writing behavior.
- The live IOC set includes persistence through Claude Code
  `.claude/settings.json`, VS Code `.vscode/tasks.json`, Zed
  `.zed/tasks.json`, and OS-level `gh-token-monitor` LaunchAgent/systemd
  services. Some variants add
  `~/.config/gh-token-monitor/token` plus a dead-man-switch token description
  `IfYouRevokeThisTokenItWillWipeTheComputerOfTheOwner`, malicious workflow
  files such as `.github/workflows/codeql_analysis.yml`, and Python runtime
  payloads such as `transformers.pyz` / `pgmonitor.py`. Remove those
  persistence hooks before rotating a stolen GitHub token.
- The scanner also watches for late-reporting markers: `router_init.js`
  SHA-256 prefix/suffix `ab4fcada...8601266c`, `tanstack_runner.js`
  SHA-256 prefix/suffix `2ec78d55...6be27fc96`,
  `opensearch_init.js`, `vite_setup.mjs`, campaign salt `svksjrhjkcejg`,
  Session protocol strings, `claude@users.noreply.github.com` dead-drop
  commits, `dependabout/` branch names, and `OhNoWhatsGoingOnWithGitHub`.
- The `node-ipc` sweep watches for `node-ipc.cjs` payload hash
  `96097e06...d9034144`, tarball hashes for the malicious `9.1.6`, `9.2.3`,
  and `12.0.1` artifacts, `sh.azurestaticprovider.net`, `bt.node.js`,
  `37.16.75.69`, DNS exfil labels `xh` / `xd` / `xf` where present in
  artifacts, `__ntw`, `__ntRun`, `/nt-` temp archives, and archive entries such
  as `uname.txt`, `envs.txt`, and `fixtures/_paths.txt`.
- The attack chain combined `pull_request_target`, GitHub Actions cache
  poisoning across a fork/base trust boundary, and OIDC token extraction from a
  GitHub Actions runner.
- npm trusted publishing/provenance can confirm a package came from a bound CI
  identity. It cannot by itself prove that the CI cache, lifecycle scripts, or
  publish path were safe.

Primary references:

- <https://tanstack.com/blog/npm-supply-chain-compromise-postmortem>
- <https://github.com/advisories/GHSA-g7cv-rxg3-hmpx>
- <https://tanstack.com/blog/incident-followup>
- <https://www.wiz.io/blog/mini-shai-hulud-strikes-again-tanstack-more-npm-packages-compromised>
- <https://socket.dev/blog/node-ipc-package-compromised>
- <https://docs.npmjs.com/trusted-publishers/>
- <https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem>

## ECC Exposure Check

Run this before a release candidate, after a broad dependency bump, and after
any package-registry incident.

```bash
npm run security:ioc-scan
node scripts/ci/scan-supply-chain-iocs.js --home
npm ci --ignore-scripts
npm audit signatures
npm audit --audit-level=high
node scripts/ci/supply-chain-advisory-sources.js --json
node scripts/ci/validate-workflow-security.js
node tests/scripts/npm-publish-surface.test.js
node tests/run-all.js
```

If a search hit appears only in documentation examples, note it in the release
evidence but do not rotate credentials for a docs-only reference.

## Durable Watch Workflow

ECC also runs `.github/workflows/supply-chain-watch.yml` every six hours and on
manual dispatch. The workflow is read-only, disables checkout credential
persistence, installs with `npm ci --ignore-scripts`, verifies npm registry
signatures, runs the IOC scanner fixtures, runs
`scripts/ci/supply-chain-advisory-sources.js --refresh --json`, emits
`supply-chain-ioc-report.json` and `supply-chain-advisory-sources.json`, and
re-validates GitHub Actions hardening rules.

Treat a failed scheduled watch as a release blocker until an operator confirms
whether the failure is a newly reported advisory, a stale scanner fixture, a
registry-signature issue, or a workflow hardening regression. If the scanner
needs new indicators, update `scripts/ci/scan-supply-chain-iocs.js`, add fixture
coverage in `tests/ci/scan-supply-chain-iocs.test.js`, refresh this runbook, and
attach the latest JSON artifact to the release evidence.

The advisory-source artifact is the ITO-57 status payload. It records the
trusted source registry, live URL refresh warnings, and a Linear-ready summary.
Refresh source coverage through `npm run security:advisory-sources -- --json`
before changing IOC coverage, and attach the artifact to the next Linear project
status update after each significant merge batch.

## Immediate Response

If ECC or a maintainer machine installed a known-bad package version:

1. Stop the host from publishing or deploying.
2. Preserve evidence before cleanup:
   - package manager command history;
   - `package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock`;
   - CI run URLs and runner logs;
   - npm package versions and tarball integrity hashes;
   - outbound network logs where available.
3. Treat the install host as compromised if lifecycle scripts may have run.
4. Remove persistence hooks before token revocation:
   - `~/.claude/settings.json` `SessionStart` hooks and adjacent
     `router_runtime.js` / `setup.mjs` payload files;
   - `.vscode/tasks.json` folder-open tasks and adjacent payload files;
   - `~/Library/LaunchAgents/com.user.gh-token-monitor.plist`;
   - `~/.config/systemd/user/gh-token-monitor.service`;
   - `~/.config/systemd/user/pgsql-monitor.service`;
   - `~/.config/gh-token-monitor/token`;
   - `~/.local/bin/gh-token-monitor.sh`;
   - `~/.local/bin/pgmonitor.py`;
   - `/tmp/transformers.pyz`, `/tmp/pgmonitor.py`, and their
     `/private/tmp/` equivalents on macOS.
5. Rotate every credential reachable by the process:
   - npm automation tokens and maintainer tokens;
   - GitHub PATs, fine-grained tokens, deploy keys, and Actions secrets;
   - cloud credentials, Vault tokens, Kubernetes service-account tokens, SSH
     keys, and local `.npmrc` tokens;
   - any MCP, plugin, or harness credentials available in environment variables
     or user-scope config.
6. Purge GitHub Actions dependency caches for affected repositories.
7. Reinstall from a clean environment with lifecycle scripts disabled first:
   `npm ci --ignore-scripts`, `pnpm install --ignore-scripts`,
   `yarn install --mode=skip-build`, or `bun install --ignore-scripts`.
8. Re-enable lifecycle scripts only after the dependency tree and package
   versions are pinned to known-clean releases.

## GitHub Actions Rules

ECC enforces these rules through `scripts/ci/validate-workflow-security.js`:

- privileged workflows must not checkout untrusted PR refs;
- all workflow dependency installs must disable lifecycle scripts;
- workflows must not restore or save shared GitHub Actions dependency caches
  during active supply-chain hardening;
- workflows with `id-token: write` must not restore or save shared dependency
  caches;
- workflows that run `npm audit` must also run `npm audit signatures`;
- `pull_request_target` workflows must not restore or save shared dependency
  caches.

Treat any violation as a release blocker.

## Publication Rules

Before tagging or publishing ECC:

1. Verify there is no unexpected dependency on packages in the active advisory.
2. Use a clean checkout or throwaway worktree for release commands.
3. Do not mix PR/test caches with publish jobs.
4. Keep `id-token: write` limited to release workflows that do not use shared
   dependency caches.
5. Prefer trusted publishing/provenance where supported, while still requiring
   local package-surface tests and registry-signature verification.
6. Confirm npm dist-tag, GitHub release, Claude plugin, Codex plugin, and
   OpenCode package state in the publication-readiness evidence document.

## When To Escalate

Escalate to a maintainer security review before any release or merge if:

- a dependency lockfile references a package named in an active advisory;
- `node scripts/ci/scan-supply-chain-iocs.js --home` finds Claude Code,
  VS Code, Zed, or OS-level persistence indicators;
- a workflow combines `pull_request_target` with dependency installation,
  cache restore/save, PR-head checkout, or write permissions;
- a release workflow combines `id-token: write` with shared cache usage;
- a publish workflow uses a long-lived npm token without a documented reason;
- AgentShield, GitGuardian, Dependabot, npm audit, or registry-signature checks
  disagree.
