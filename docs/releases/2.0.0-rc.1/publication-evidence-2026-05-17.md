# ECC v2.0.0-rc.1 Publication Evidence - 2026-05-17

This is release-readiness evidence only. It does not create a GitHub release,
npm publication, plugin tag, marketplace submission, or announcement post.

## Source Commit

| Field | Evidence |
| --- | --- |
| Upstream main | `e6c16b40b80b3b323586c9e8341faa87c01a728c` |
| Git remote | `https://github.com/affaan-m/everything-claude-code.git` |
| Evidence scope | Current `main` after the Japanese and Thai localization merge batch, post-merge ja-JP markdown anchor repair, Zed install-target support, Mini Shai-Hulud/TanStack protection recheck, `gh-token-monitor` token-store IOC coverage, AgentShield policy-promotion Action output mirror, ECC-Tools hosted promotion judge audit-trace mirror, ECC-Tools billing announcement preflight mirror, ECC-Tools production Marketplace readback-state mirror, legacy-tail dashboard routing, Linear progress readiness, and the deterministic preview-pack smoke gate |
| Local status caveat | `git status --short --branch` showed `## main...origin/main` plus unrelated untracked `docs/drafts/`; generated evidence files are committed after the source snapshot they describe |

The actual release operator should repeat all publish-facing checks from the
final release commit with a strictly clean checkout before publishing.

## Queue And Discussion State

| Surface | Command | Result |
| --- | --- | --- |
| Trunk PRs | `gh pr list --state open --limit 50 --json number,title` | 0 open PRs |
| Trunk issues | `gh issue list --state open --limit 50 --json number,title` | 0 open issues |
| Platform audit | `node scripts/platform-audit.js --json --allow-untracked docs/drafts/` | Ready; tracked repos report 0 open PRs, 0 open issues, 0 discussion maintainer-touch gaps, 0 answerable Q&A missing accepted answers, and 0 blocking dirty files |
| Operator dashboard | `npm run operator:dashboard -- --markdown --allow-untracked docs/drafts/ --write docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-17.md` | Generated current dashboard for `e6c16b40b80b3b323586c9e8341faa87c01a728c`; dashboard ready true, publication ready false because release, npm, plugin, billing, and announcement gates are approval-gated |

Tracked repositories in the platform audit were:

- `affaan-m/everything-claude-code`
- `affaan-m/agentshield`
- `affaan-m/JARVIS`
- `ECC-Tools/ECC-Tools`
- `ECC-Tools/ECC-website`

## Merge And Triage Batch

| Item | Result |
| --- | --- |
| Issue #1957 | Closed with maintainer guidance after confirming README and hooks docs already document supported manual hook installation |
| Issue #1958 | Closed in the earlier queue batch after the supply-chain IOC scan and protection pass |
| PR #1962 | Closed instead of merged because ESLint 10 requires a newer Node engine range than the current Node 18 support contract |
| PR #1961 | Merged TypeScript 6.0.3 as `344a9bdf9c45c7589dedd3c66a8a2ebf2cbf2e5b`; maintainer patch added Node types to `.opencode/tsconfig.json`; full GitHub Actions matrix passed |
| PR #1963 | Merged `@types/node` 25.8.0 as `b66ae3fbe070ef1fd2b610b4011f1345b4d75875`; maintainer patch synced the npm lockfile; full GitHub Actions matrix passed |
| PR #1953 | Merged Japanese localization as `9495b109e2c5fc5b1044ddfa1e2179f9d4aa86be`; maintainer patches fixed localized security/sponsorship links, translated the stale cubic-reported frontmatter items, confirmed `docs/zh-CN` to `docs/ja-JP` parity has 0 missing files, and approved after CodeRabbit, GitGuardian, and cubic passed |
| Post-merge trunk fix | Pushed `afe0ae8d725f7773147dc4aa7943a45846853a0d` to remove broken intra-file anchors from `docs/ja-JP/skills/autonomous-loops/SKILL.md`; this restored root lint on `main` after PR #1953 |
| Issue #1951 | Closed automatically as completed when PR #1953 merged |
| Zed adapter commit | Pushed `2371a3cf0543365c1c18e84eba786b1abcb28941` to add project-local Zed support through the selective install target, README Zed guidance, and `.zed/settings.json` planning coverage |
| Zed Windows CI fix | Pushed `744f4169972fd81618c3114ea1ca5ffb85ef4c82` to normalize the Zed install-plan source-path assertion across Windows path separators |
| Discussion #1896 | Added a maintainer update confirming Zed support on `main`, documenting the dry-run command, and clarifying that BYOK/OpenRouter secrets stay in Zed/local user settings rather than ECC-managed project files |
| PR #1967 | Merged Thai localization as `6b282aaa4389e9411e86bfe09d8f4de8018dcf8e` after applying the two maintainer cleanup comments, validating markdownlint and language-switcher coverage, and approving after CodeRabbit, GitGuardian, Greptile, and cubic passed on current head |
| Supply-chain token-store scanner slice | Pushed `36d390aa7d733d458963a203b91998d3aec477b2` to detect the Mini Shai-Hulud `~/.config/gh-token-monitor/token` dead-man-switch token store, update the incident-response runbook, and add fixture coverage; local sweeps stayed clean and GitHub Actions `26003629550` passed |
| Legacy-tail dashboard slice | Pushed `f397216aee5a0ca7d168726d3cc41eb47f728b37` and dashboard regeneration commits to keep localization-tail evidence attached to ITO-55 and prevent stale legacy work from being treated as release-current |
| Linear progress readiness slice | Pushed `355c4f128183aa7f7ce9da9485af07d257d67f69` and dashboard regeneration commit `1a384dc5dbd24a3be725e1b26c169bddb6c850b6` to require refreshed Linear progress evidence after significant merge batches |
| Preview-pack smoke slice | Pushed `3215e655eff70b9fea5382ce5996666a1f48d1af` to add `npm run preview-pack:smoke`, covering preview-pack artifacts, Hermes import boundaries, verification commands, and approval-gated publication blockers; lint and dashboard follow-up commits landed through `27dc2918a24a50b8dd5e23dba2aa6a05bd17c0d7` |
| AgentShield hardening-output slice | Pushed AgentShield `1124535345d7040242ecd3803f65bcd4dcaf6ec2` to expose package-manager hardening status/count outputs and redacted GitHub Action job-summary evidence for registry credentials, lifecycle-script drift, and release-age gate drift |
| AgentShield policy-promotion Action slice | Pushed AgentShield `1593925dca025632dd8a6454509fce3fe7517cdf` to expose policy-promotion status/count/digest outputs plus GitHub Action job-summary review items for owner approval, protected rollout, and runtime smoke; the same Action job marks runtime smoke verified when it scans with the promoted policy |
| ECC-Tools policy-promotion telemetry slice | Pushed ECC-Tools `86589517b11b95f1b0216ae7737563fb67ee1604` to route AgentShield policy-promotion Action outputs into hosted security review findings and Hosted Promotion Readiness scoring |
| ECC-Tools policy-promotion operator UX slice | Pushed ECC-Tools `16c537fd385458c438ff32fb4211079b2f8ea1c4` to render policy-promotion Action output status, pack, review item count, remaining action count, and digest in hosted security job comments and check-runs |
| ECC-Tools hosted promotion judge audit trace slice | Pushed ECC-Tools `05d4e8296e37ba72e471beaa23ea4c81eb2aa31f` to render hosted promotion judge request fingerprints and allowed-citation audit traces without exposing raw provider output |
| ECC-Tools billing announcement preflight slice | Pushed ECC-Tools `91a441b92342b842832ac28b018ee46f0c4a906f` to add `npm run billing:announcement-gate -- --preflight` for safe Marketplace readback input and endpoint verification before privileged API calls |
| ECC-Tools production Marketplace readback-state slice | Pushed ECC-Tools `eb6941290b2fa70db01a51084e9e79a160238468` to record that production Cloudflare secret names include `INTERNAL_API_SECRET`, but production KV currently has no `account-billing:*` or `billing-state:*` records |

## Release Gate Commands

| Gate | Command | Result |
| --- | --- | --- |
| Root lint | `npm run lint` | Passed after the ja-JP autonomous-loop anchor repair |
| Root suite | `npm test` | 2487 passed, 0 failed |
| GitHub Actions CI | `gh run view 25989533576 --json status,conclusion,jobs` | Completed successfully with 37/37 jobs green, including Security Scan and all Windows test jobs |
| Harness audit | `node scripts/harness-audit.js --format json` | 70/70, no top actions |
| Observability readiness | `npm run observability:ready -- --format json` | 21/21, ready yes |
| Workflow security | `node scripts/ci/validate-workflow-security.js` | Validated 8 workflow files |
| Supply-chain IOC scan | `node scripts/ci/scan-supply-chain-iocs.js --root ~/GitHub --home --json`; `node scripts/ci/scan-supply-chain-iocs.js --root ~/Documents/GitHub --home --json` | Passed; each workspace sweep inspected 1,879 files with 0 findings, including user-level persistence targets |
| npm audit | `npm audit --audit-level=high` | 0 vulnerabilities |
| npm signatures | `npm audit signatures` across `agentshield`, `everything-claude-code`, `ECC-Tools`, `ECC-website`, and `JARVIS/frontend` | Passed across the primary ECC Node package roots |
| Preview-pack smoke | `npm run preview-pack:smoke` | Passed; ready yes; digest `dfb1ed014607`; 5 checks passed and 0 failed |
| AgentShield enterprise CI output slice | AgentShield local `npm run build`, focused action tests, `npm run typecheck`, `npm run lint`, full `npm test`, and `git diff --check`; GitHub Actions `25994354007`, `25994354011`, `25994354026` | Local gates passed; remote CI, Test GitHub Action, and Self-Scan completed successfully for `1124535` |
| AgentShield policy-promotion Action output slice | AgentShield local `npm run build`, `npx vitest run tests/action-promotion.test.ts tests/action.test.ts`, `npm run typecheck`, `npm run lint`, full `npm test`, and `git diff --check`; GitHub Actions `25995929182`, `25995929190`, `25995929161` | Local gates passed; remote CI, Test GitHub Action, and Self-Scan completed successfully for `1593925` |
| ECC-Tools policy-promotion hosted telemetry slice | ECC-Tools local focused vitest checks for policy-promotion Action-output routing and hosted-promotion readiness, `npm run typecheck`, `npm run lint`, full `npm test`, and `git diff --check`; GitHub Actions `25996758218` | Local gates passed; remote CI completed successfully for `8658951` |
| ECC-Tools policy-promotion operator UX slice | ECC-Tools local focused vitest checks for policy-promotion Action output values in hosted findings/comments/checks, `npm run typecheck`, `npm run lint`, full `npm test`, and `git diff --check`; GitHub Actions `25997300046` | Local gates passed; remote CI completed successfully for `16c537f` |
| ECC-Tools hosted promotion judge audit trace slice | ECC-Tools local focused vitest checks for hosted model-judge audit traces, `npm run typecheck`, `npm run lint`, full `npm test`, and `git diff --check`; GitHub Actions `25997840703` | Local gates passed; remote CI completed successfully for `05d4e82` |
| ECC-Tools billing announcement preflight slice | ECC-Tools local focused vitest preflight tests, `npm run typecheck`, `npm run lint`, full `npm test`, and `git diff --check`; GitHub Actions `25998238507` | Local gates passed; remote CI completed successfully for `91a441b` |
| ECC-Tools production Marketplace readback-state slice | ECC-Tools local `npm test` and `git diff --check`; Cloudflare `wrangler secret list` confirmed `INTERNAL_API_SECRET` exists by name; `wrangler kv key list` for `account-billing:` and `billing-state:` both returned empty lists; GitHub Actions `25998610438` | Local gates passed; remote CI completed successfully for `eb69412`; live announcement remains blocked until Marketplace purchase/webhook records populate KV |
| GitHub queues | `gh pr list`; `gh issue list`; `node scripts/platform-audit.js --json --allow-untracked docs/drafts/` | 0 open PRs, 0 open issues, 0 discussion maintainer-touch gaps, 0 answerable Q&A missing accepted answers, 0 GitHub fetch errors, and platform audit ready across the tracked repo set after generated evidence is committed |
| Operator dashboard | `npm run operator:dashboard -- --markdown --allow-untracked docs/drafts/ --write docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-17.md` | Dashboard generated for `e6c16b40b80b3b323586c9e8341faa87c01a728c` with platform ready true, dashboard ready true, and macro publication gates still incomplete |
| GitHub Actions CI | `gh run watch 26003629550 --repo affaan-m/everything-claude-code --exit-status` | Completed successfully for `36d390aa7d733d458963a203b91998d3aec477b2`, including Validate Components, Lint, Security Scan, Coverage, and the full OS/Node/package-manager matrix |

## Current Publication Blockers

- GitHub prerelease `v2.0.0-rc.1` is still not created in this pass.
- npm `ecc-universal@2.0.0-rc.1` is still not published to the `next`
  dist-tag.
- Claude plugin tag and marketplace propagation remain approval-gated.
- Codex repo-marketplace distribution is verified for rc.1, but official
  Plugin Directory publishing remains blocked on OpenAI's self-serve publishing
  surface.
- ECC Tools billing/native-payments copy remains blocked until a Marketplace
  purchase/webhook path writes production `account-billing:*` and
  `billing-state:*` records, then `npm run billing:announcement-gate --
  --account <github-login>` returns an announcement-ready gate.
- Release notes, X, LinkedIn, GitHub release, and longform copy still need final
  live URLs after release/package/plugin URLs exist.
- The local checkout still has unrelated untracked `docs/drafts/`, so a strict
  clean-checkout release pass remains required before real publication.

## Result

The tracked public PR queue, issue queue, and discussion queue are clean on
May 17, 2026, and current `main` passed the Node, harness, observability,
workflow-security, npm audit/signature, and supply-chain IOC gates listed above.
This improves publication readiness but does not replace the approval-gated
release, package, plugin, billing, and announcement steps in
`publication-readiness.md`.
