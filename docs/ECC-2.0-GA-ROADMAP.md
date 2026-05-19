# ECC 2.0 GA Roadmap

This roadmap is the durable repo mirror for the active Linear project:

<https://linear.app/itomarkets/project/ecc-platform-roadmap-52b328ee03e1>

Linear issue creation is available again in the Ito Markets workspace. The live
execution truth is split across:

- the Linear project documents, issue lanes, dependencies, and milestones;
- this repo document;
- merged PR evidence;
- handoffs under `~/.cluster-swarm/handoffs/`.

The May 19 release/growth execution map lives at
[`docs/releases/2.0.0/ecc-2-hypergrowth-release-command-center.md`](releases/2.0.0/ecc-2-hypergrowth-release-command-center.md).
It is the operator surface for the final ECC 2.0 repo identity, video suite,
partner/sponsor funnel, consulting/talk funnel, and social launch plan.

## 2026-05-19 Delta

- The public repo identity is now `affaan-m/ECC`; release, package, plugin,
  workflow, and launch-copy surfaces should use that URL for current public
  links.
- The ECC 2.0 release story should lead with the product shape directly:
  harness-native operator system, reusable skills/rules/hooks/MCP conventions,
  `ecc2/` alpha control plane, Hermes as optional operator shell, and ECC Tools
  Pro/Sponsors/consulting as the business surface.
- Copy should avoid presenting this as a repo rename or config-pack migration.
  The release proof should show the system through install flow, cross-harness
  demos, security evidence, hosted product evidence, and the video suite.

## Current Evidence

As of 2026-05-18:

- GitHub queues are clean across `affaan-m/ECC`,
  `affaan-m/agentshield`, `affaan-m/JARVIS`, `ECC-Tools/ECC-Tools`, and
  `ECC-Tools/ECC-website`: the latest `platform-audit` sweep found 0 open PRs,
  0 open issues, 0 discussion maintainer-touch gaps, 0 answerable Q&A missing
  accepted answers, and 0 blocking dirty files when allowing the unrelated
  local `docs/drafts/` directory. The May 18 sync also refreshed
  `scripts/work-items.js sync-github` across all five tracked repos, leaving
  no open or blocked local work items.
- Owner-wide queue cleanup is also inside the requested budget:
  `docs/releases/2.0.0-rc.1/owner-queue-cleanup-2026-05-18.md` records the
  live `gh search` sweep that closed 24 stale dependency-bot PRs and 72 stale
  legacy payments/0EM roadmap issues, then closed the 9 remaining stale,
  generated, conflicting, or test/noise PRs and the 5 remaining legacy,
  outreach, or placeholder issues. The broader `affaan-m` owner namespace is
  now at 0 open PRs and 0 open issues by live `gh search`. Archived repos
  touched during closure were restored to archived state.
- GitHub discussions are current across those tracked repos:
  `affaan-m/ECC` has 58 total discussions and 0 without
  maintainer touch after May 15 maintainer updates on #73 and #1239; AgentShield,
  JARVIS, ECC Tools, and the ECC Tools website have discussions disabled or 0
  total discussions. `docs/architecture/discussion-response-playbook.md` now
  supplies the ITO-59 response categories, public templates, security-escalation
  path, and readback rules for future discussion batches.
- The current Linear roadmap contains 16 issue lanes (`ITO-44` through
  `ITO-59`) and five milestones: Security and Access Baseline, ECC 2.0 Preview
  and Publication, AgentShield Enterprise Iteration, ECC Tools Next-Level
  Platform, and Legacy Audit and Salvage.
- Linear live sync is current for the May 18 merge and supply-chain batch:
  ITO-57 has a final emergency supply-chain refresh comment
  (`3fe5b2b7-c4fe-401c-a317-b40d72119cb3`), and the ECC platform project has
  the latest operator progress comment (`e32e5b7a-287b-4bf4-9ed7-314389a157e1`).
  Linear project status updates are disabled in this workspace, so the project
  comment is the supported external status surface.
- The latest May 18 merge batch on `main` includes PR #1970 workflow-security
  validator bypass fixes, PR #1971 metrics bridge cost-reporting and warning
  de-dup fixes, PR #1972 `uncloud` skill activation structure, PR #1976
  OpenAI/AstraFlow provider response guards, ECC-Tools Wrangler OAuth billing
  readback mirror evidence, the `04d4d819` defensive-deny IOC scanner hardening
  recheck, `7911af4a` release OIDC publishing-scope hardening, `97567a91`
  release workflow line-ending normalization, and release evidence with a
  refreshed operator dashboard.
- `docs/releases/2.0.0-rc.1/publication-evidence-2026-05-18.md` records the
  May 18 queue-zero state, current-head TanStack/Mini Shai-Hulud protection
  recheck, no-lifecycle npm install, npm audit/signature checks, AgentShield
  project `.claude` scan, Linear sync, work-items sync, operator dashboard
  refresh, PR #1976 provider-guard validation, ECC-Tools Wrangler OAuth billing
  readback evidence, defensive-deny IOC scanner coverage, and current-head CI
  success for `97567a91`; a detached clean-worktree preview-pack smoke from
  `680aeff0` passed 5/5 with digest `0ed831dbd0cf`.
- `docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-18.md`
  regenerates the ITO-44 prompt-to-artifact dashboard from live platform audit
  evidence: PR queue, issue queue, discussion queue, local worktree gate,
  dashboard generation, and supply-chain loop are current; publication, plugin,
  billing, AgentShield, ECC Tools, legacy, and Linear/productized sync lanes
  remain the next work.
- `docs/releases/2.0.0-rc.1/publication-evidence-2026-05-17.md` records the
  May 17 queue-zero state, Japanese localization merge, Dependabot TypeScript
  and Node type merges, post-merge ja-JP lint repair, Mini Shai-Hulud/TanStack
  local protection recheck, npm audit/signature checks, current operator
  dashboard, and GitHub CI success for `99dd6ac0`.
- `docs/releases/2.0.0-rc.1/publication-evidence-2026-05-16.md` records the
  queue, discussion, Linear roadmap, ECC Tools access, Mini Shai-Hulud/TanStack
  full-campaign follow-up, scheduled supply-chain watch coverage, no-lifecycle
  CI install hardening, GitHub Actions cache purge, AgentShield #85
  registry-signature verification, AgentShield #86 evidence-pack CI provenance,
  AgentShield #87 plugin-cache runtime-confidence classification, AgentShield
  #88 evidence-pack inspect/readback, AgentShield #89 evidence-pack fleet
  routing, AgentShield #90 fleet review items, AgentShield #91
  checksum-backed policy export, AgentShield #92 checksum-verified policy
  promotion, ECC-Tools #75 billing-gate tightening,
  ECC-Tools #76 AgentShield fleet-summary consumption, ECC-Tools #77 hosted
  finding evidence paths, ECC-Tools #78 harness policy-route linking, PR #1947
  supply-chain protection, and May 16 release-evidence
  refresh.
- `npm run harness:audit -- --format json` reports 70/70 on current `main`.
- `npm run observability:ready` reports 21/21 readiness on current `main`,
  including the GitHub/Linear/handoff/roadmap progress-sync contract.
- GitHub CI run `26017368895` completed successfully for
  `04d4d81938b20ac2bac1f0025145ab77d6a59f5f`, including Validate Components,
  Coverage, Lint, Security Scan, and the full Node/package-manager matrix.
- Supply-Chain Watch run `26009825837` completed successfully for
  `3b7e0ba30a027ffd3319c2f145c63076c296d80a`, including no-lifecycle install,
  npm audit/signature verification, scanner fixtures, advisory-source
  fixtures, IOC/advisory artifact generation, and workflow-security validation.
- PR #1846 merged as `797f283036904128bb1b348ae62019eb9f08cf39` and made
  npm registry signature verification a durable workflow-security gate:
  workflows that run `npm audit` now need `npm audit signatures`.
- PR #1848 merged as `cbecf5689d8d1bd5915e7031697a1d56aac538f2` and added
  `docs/security/supply-chain-incident-response.md`, plus a workflow-security
  validator rule blocking `pull_request_target` workflows from restoring or
  saving shared dependency caches.
- PR #1940 merged as `6951b8d5d29d13cac6b89b461104ad03838553de` and added a
  scheduled supply-chain watch workflow that emits a durable IOC report.
- PR #1941 merged as `f7035b5644ffc857879b71c39353b2141f17c3f0` and hardened
  CI dependency installs against lifecycle-hook compromise by disabling package
  manager lifecycle scripts, removing Actions dependency cache use, and adding
  validator coverage so those patterns cannot be reintroduced silently.
- PR #1850 merged as `248673271455e9dc85b8add2a6ab76107b718639` and removed
  shell access from read-only analyzer agents and zh-CN copies, reducing
  AgentShield high findings on that surface without changing operator agents.
- PR #1851 merged as `209abd403b7eaa968c6d4fa67be82e04b55706d6` and made
  `persist-credentials: false` mandatory for `actions/checkout` in workflows
  with write permissions.
- PR #1860 merged as `c2762dd5691a33aaa7f84a0a4901a5bab7980fc8` and closed
  #1859 by adding the Ruby/Rails language pack surface, install aliases,
  selective-install components, and focused install-manifest executor tests.
- AgentShield PR #78 merged as `1b19a985d6ae1346244089a78806a7d5eaaf270e`
  and hardened the release workflow with `persist-credentials: false` plus
  `npm ci --ignore-scripts` in the write/id-token release path.
- AgentShield PR #79 merged as `86a823c5f2c35ee97e6ecf6f99e9ac301d54119a`
  and moved baseline/watch/remediation fingerprints to a shared hashed
  evidence fingerprint helper. New baselines omit raw finding evidence while
  older raw-evidence baselines remain comparable.
- AgentShield PR #80 merged as `8ed379d1de067b25640ac6273aa4d9f8e6735d43`
  and added prioritized corpus accuracy recommendations to failed corpus gates,
  mapping misses by category, missing rule, and config ID so enterprise
  scanner-regression work has an actionable improvement plan.
- AgentShield PR #81 merged as `6583884e74ba2e896942113e1ce3146230e6fb76`
  and added ordered remediation workflow phases to remediation plans, routing
  safe auto-fixes, manual review, and verification through stable finding
  fingerprints without copying raw evidence.
- AgentShield PR #82 merged as `51336ba074ad5e9fed2c0aa3237422be22147e76`
  and expanded the built-in attack corpus with an env proxy hijack scenario
  covering proxy/runtime mutation, env-token exfiltration, DNS exfiltration,
  credential-store access, and clipboard access.
- AgentShield PR #87 merged as `26bb44650663816d07180e0d20c1895e431a326c`
  and added installed Claude plugin-cache runtime confidence. Cached plugin
  findings now emit `runtimeConfidence: plugin-cache`, non-secret score impact
  stays at the intended `0.5x`, repository-local non-Claude `plugins/cache`
  paths are not downgraded, and cached hook implementations no longer appear as
  active top-level `hook-code`.
- AgentShield PR #88 merged as `65ed6e2a87545dc99d962b58413f49096a4d70ec`
  and added `agentshield evidence-pack inspect` for downstream consumers.
  Evidence-pack bundles now have compact JSON/text readback for report score,
  finding counts, runtime confidence, policy, baseline, supply-chain, CI
  context, remediation phases, and malformed artifact errors without manually
  opening every bundle file.
- AgentShield PR #89 merged as `521ada9091bb6d818511ab8589ae675b920c106a`
  and added `agentshield evidence-pack fleet <dirs...> [--json]` for
  downstream fleet routing. Multiple verified evidence packs now aggregate into
  ready, security-blocker, policy-review, baseline-regression,
  supply-chain-review, and invalid routes with finding, policy, baseline,
  supply-chain, and remediation totals.
- JARVIS PR #13 merged as `127efabbfb5033ae53d7a53e1546aa3c33d6f962`
  and hardened CI/deploy workflows with npm registry signature verification,
  disabled persisted checkout credentials in write-permission jobs, and pinned
  the Vercel CLI install instead of using `latest`.
- ECC-Tools PR #53 merged as `99018e943d03f024de8c9d278c91f66393d4f1ee`
  and added npm registry signature verification before the existing production
  dependency audit in CI.
- ECC-Tools PR #54 merged as `05df89721f49c1e19d8502c545e26f5694806998`
  and made `/ecc-tools followups sync-linear` track copy-ready PR drafts in
  the Linear/project backlog when `open-pr-drafts` is not used, preserving
  useful stale-PR salvage work without opening extra PR shells.
- ECC-Tools PR #55 merged as `5d8c112cce4794cfa089d5b0ea661ba87a178be1`
  and added analysis-depth readiness to `/ecc-tools analyze` comments,
  separating commit-history-only repos from evidence-backed and deep-ready repos
  using CI/CD, security, harness, reference/eval, AI routing/cost-control, and
  team handoff evidence.
- ECC-Tools PR #56 merged as `5b729c88641eafe80f65364bab3fc74d0270f57b`
  and added the authenticated `/api/analysis/depth-plan` contract that maps
  analysis-depth readiness into concrete hosted jobs for CI diagnostics,
  security evidence review, harness compatibility, reference-set evaluation,
  AI routing/cost review, and team backlog routing.
- ECC-Tools PR #57 merged as `4cc61112a4cc9feec7b07af09321f360e34af6a4`
  and added the first executable hosted analysis job:
  `/api/analysis/jobs/ci-diagnostics` now gates on CI/CD readiness, inspects
  workflow/test-runner/failure-evidence artifacts, returns CI hardening
  findings and next actions, and charges usage only after successful execution.
- ECC-Tools PR #58 merged as `ce09dd8d9b46f65c6b88dc4f48cfb6b6227ae0bf`
  and added the second executable hosted analysis job:
  `/api/analysis/jobs/security-evidence-review` now gates on security-evidence
  readiness, inspects capped AgentShield evidence-pack, policy, baseline,
  SBOM, SARIF, and security-scan artifacts, returns supply-chain evidence
  findings and next actions, and charges usage only after successful execution.
- ECC-Tools PR #59 merged as `505b372dbd8f75f996d9e2ed079effd30cec5ba5`
  and added the third executable hosted analysis job:
  `/api/analysis/jobs/harness-compatibility-audit` now gates on harness-config
  readiness, inspects capped Claude, Codex, OpenCode, MCP, plugin, and
  cross-harness documentation artifacts, excludes local secret-bearing config
  paths from fetches, returns portability findings and next actions, and
  charges usage only after successful execution.
- ECC-Tools PR #60 merged as `b75e0a49ba5672b1ec9a2a4880ddcfa2d07dc557`
  and added the fourth executable hosted analysis job:
  `/api/analysis/jobs/reference-set-evaluation` now gates on reference-evidence
  readiness, evaluates analyzer corpus, RAG/evaluator, PR salvage/review,
  harness, security, and CI failure-mode evidence, excludes obvious
  secret-bearing fixture paths from fetches, returns reference coverage
  findings and next actions, and charges usage only after successful execution.
- ECC-Tools PR #61 merged as `7b01b67cae0b80774b311cb515b7eca0aa038c65`
  and added the fifth executable hosted analysis job:
  `/api/analysis/jobs/ai-routing-cost-review` now gates on AI routing/cost
  readiness, evaluates model routing, token budget, usage-limit, rate-limit,
  billing/entitlement, cost-regression, and cost-policy evidence, excludes
  obvious secret-bearing paths from fetches, returns cost-control findings and
  next actions, and charges usage only after successful execution.
- ECC-Tools PR #62 merged as `781d6733e56f7556edb43fb96bdfb00b1f0a3aa6`
  and added the sixth executable hosted analysis job:
  `/api/analysis/jobs/team-backlog-routing` now gates on team handoff/project
  tracking readiness, evaluates roadmap, runbook, handoff, release-plan,
  issue-template, ownership, project-tracker, backlog, and follow-up evidence,
  excludes obvious secret-bearing paths from fetches, returns team-routing
  findings and next actions, and charges usage only after successful execution.
- ECC-Tools PR #63 merged as `fb9e4c5ceb9ccde50da74c7a69c3fa4bd321fc07`
  and made the hosted execution plan operator-visible on queued PR analysis:
  the queue now publishes a non-blocking `ECC Tools / Hosted Depth Plan`
  check-run on the PR head SHA with ready/blocked hosted executor commands
  and next action text, while keeping check-run publication best-effort so
  bundle generation and analysis comments are not blocked.
- ECC-Tools PR #64 merged as `72020ef94db94840812977ea7ac37e9344036668`
  and added PR-facing hosted job dispatch controls:
  `/ecc-tools analyze --job ...` comments now queue hosted jobs against the
  PR head SHA, execute them through the existing hosted readiness/evidence
  gates, post artifacts/findings/next actions back to the PR, and scope
  idempotency keys by job id so hosted jobs do not collide with bundle
  analysis.
- ECC-Tools PR #65 merged as `bacd4adf6a3a629e8d403865456d15f127baaf4e`
  and added hosted job result history/check-run summaries:
  queued hosted jobs now cache both the latest result and immutable run records
  for completed or blocked runs, then publish a non-blocking per-job check-run
  on the PR head SHA with artifacts, findings, readiness blockers, and next
  actions.
- ECC-Tools PR #66 merged as `4e1db48252d068ea5dcf4308b0bc11b0dfe0c9ce`
  and added a read-only hosted status command:
  `/ecc-tools analyze --job status` now reads the #65 latest-result cache for
  the current PR head and posts a compact completed/blocked/not-run table with
  the next hosted job command, without queueing work or billing usage.
- ECC-Tools PR #67 merged as `f20e6bec2b0bf49e4cc36e08b7285c795973b73d`
  and made the hosted depth-plan check-run status-aware:
  queued PR analysis now reads the #65/#66 latest-result cache when publishing
  `ECC Tools / Hosted Depth Plan`, includes the latest hosted run status in
  the plan table, and recommends the next unrun ready job before reruns.
- ECC-Tools PR #68 merged as `2cde524b5ef8f34ab7bb1af973248fe4be4359f8`
  and added deterministic hosted promotion readiness:
  opened/synchronized PRs now publish a non-blocking
  `ECC Tools / Hosted Promotion Readiness` check-run that compares changed
  files against the checked-in evaluator/RAG corpus, warns on missing
  hosted-job promotion evidence, and can be disabled with
  `PR_HOSTED_PROMOTION_READINESS_CHECK_MODE=off`.
- ECC-Tools PR #69 merged as `d0112dac7cef807ae27def41f057682ef0772cce`
  and extended hosted promotion readiness with deterministic output scoring:
  the check now reads cached completed hosted job results for the current PR
  head, scores their artifacts and findings against evaluator/RAG corpus
  expectations, and treats matching hosted artifacts as promotion evidence
  before reporting a gap.
- ECC-Tools PR #70 merged as `7001d805ac981fe220b4575159f469fbea9dbb76`
  and added retrieval planning for hosted promotion:
  the check now emits ranked retrieval candidates from cached hosted artifacts,
  hosted findings, expected evidence paths, and changed source paths, plus a
  model prompt seed that tells the later hosted judge not to promote from
  changed paths alone.
- ECC-Tools PR #71 merged as `d41e59ff00fe1bd0b0c96386e56bc5269d7b9c15`
  and added the first model-backed hosted promotion judge contract:
  the check now emits a provider-neutral `hosted-promotion-judge.v1` request
  contract and fails closed unless hosted retrieval evidence, entitlement,
  remaining budget, and provider configuration are present. It still does not
  make live model calls.
- ECC-Tools PR #72 merged as `973bc51e5436dd279ae5a890cce9811485eef0b5`
  and executes the hosted promotion model judge behind explicit gates:
  `PR_HOSTED_PROMOTION_MODEL_JUDGE_MODE=execute` now calls the configured
  provider only after hosted retrieval evidence, entitlement, budget, provider,
  and executor gates pass; the check remains non-blocking, strict-JSON-only,
  and rejects uncited or non-hosted model output without echoing raw responses.
- ECC-Tools commit `05d4e8296e37ba72e471beaa23ea4c81eb2aa31f`
  adds operator-readable audit traces to hosted promotion model judging:
  check-runs now render a deterministic request fingerprint and
  allowed-citation count alongside the accepted decision, without exposing raw
  provider output.
- ECC-Tools PR #73 merged as `7d0538c9354e18adbfc72ef00d858949a817fa48`
  and added a fail-closed native-payments announcement gate to
  `/api/billing/readiness`: public payment claims now require
  `announcementGate.ready === true` from a Marketplace-managed test account
  before launch copy can move past release review.
- ECC-Tools commit `91a441b92342b842832ac28b018ee46f0c4a906f`
  adds `npm run billing:announcement-gate -- --preflight` so operators can
  verify the Marketplace test account, internal API token presence, and
  billing-readiness endpoint before making the privileged readback call.
- ECC-Tools commit `eb6941290b2fa70db01a51084e9e79a160238468`
  recorded the first live production readback state: Cloudflare Worker secret
  names include `INTERNAL_API_SECRET`, but no Marketplace-managed account could
  pass the announcement gate yet.
- ECC-Tools commit `95d0bec69dbcf364ed084e983a40d0a94d443d16`
  adds repeatable aggregate production KV readback with
  `npm run billing:kv-readback`: the latest API-authenticated run found 253
  `account-billing:*` records and 253 `billing-state:*` records, but 0
  Marketplace-managed Pro `billing-state:*` records, so native-payments copy
  remains blocked until `--require-ready` and the official internal
  announcement gate pass.
- ECC-Tools commit `285967807ea7b5eb3146bc984fb2229db67d4290`
  requires GitHub Marketplace webhook provenance on Pro billing-state records
  before native-payments announcement readiness can pass. The CI run
  `26013559229` succeeded for the pushed head.
- ECC-Tools commit `42653f9140c232961280d961ed76a6142433cfa1`
  adds `npm run billing:kv-readback -- --wrangler` so operators can run the
  aggregate production KV readback through an authenticated Wrangler OAuth
  session instead of requiring a separate Cloudflare API token/global key. CI
  run `26016223013` succeeded, and the latest live readback found 253
  `account-billing:*` records and 253 `billing-state:*` records with 194
  marketplace/free states, 59 Stripe/pro states, 0 Marketplace Pro states, 0
  ready-like Marketplace Pro states, and 0 parse failures. Native-payments
  copy remains blocked until a real Marketplace-managed Pro webhook creates
  billing-state provenance and `--require-ready` plus the official internal
  announcement gate pass.
- ECC-Tools commit `632e059e51b6e1297ba118807c8b5b2adbac74ce`
  adds target account billing readback with `npm run billing:kv-readback -- --account <github-login> --require-ready`.
  The report redacts the account login and raw KV keys, emits only a stable
  fingerprint plus sanitized readiness booleans, and now requires both
  `account-billing:<login>` and `billing-state:<login>` before a target
  Marketplace Pro test account can pass the native-payments announcement
  readback gate. CI run `26018941515` succeeded. The 2026-05-18 live recheck
  split out Linear ITO-61 for the target-account blocker.
- ECC-Tools commit `d5f60db` adds sanitized Marketplace-source provenance
  counts to `npm run billing:kv-readback`, including
  `marketplaceSourceRecords`, `marketplaceSourceWithWebhookEvidence`,
  `marketplaceSourceWithoutWebhookEvidence`, `byMarketplacePlanName`, and
  `byMarketplaceEventAction`. The 2026-05-18 live Wrangler OAuth readback now
  works and found 256 account-billing records, 256 billing-state records, 197
  Marketplace-source records, 59 Stripe-source records, 53 Pro records, 0
  Marketplace Pro records, 4 Marketplace webhook-provenance records, all
  `Open Source` purchases, and 193 Marketplace-source records without webhook
  provenance. Native-payments copy remains blocked by Linear ITO-61 until a
  real Marketplace-managed Pro webhook creates target account provenance and
  `billing:kv-readback -- --wrangler --wrangler-bin ./node_modules/.bin/wrangler --account <github-login> --require-ready`
  plus the official internal announcement gate pass.
- ECC-Tools commit `13cd3fc` normalizes billing-state key casing so
  Marketplace webhook writes and announcement readbacks agree on GitHub login
  case; current-head CI `26037611421` passed. The code-side readback hardening
  remains green, but it does not create live Marketplace Pro state.
- ECC-Tools commit `69ca535` surfaces hosted team-learning feedback controls:
  harness compatibility and team-backlog routing now show retention days,
  deletion route/SLA, and opt-out route before adaptive recommendations are
  routed into team-owned queues. Linear ITO-52 is Done with CI `26054455434`.
- ECC-Tools commit `e56fc1a` updates the lockfile for
  `brace-expansion@5.0.6` and fixed Dependabot alert 44 for CVE-2026-45149;
  GitHub API reported `state: fixed` at `2026-05-18T19:10:15Z` and current-head
  CI `26054671308` passed.
- The latest ITO-61 readback retry narrowed the blocker: Wrangler OAuth now
  works, the safe aggregate readback has 0 parse failures and still reports 0
  Marketplace Pro records, and `billing:announcement-gate -- --preflight` is
  missing the target Marketplace account plus `INTERNAL_API_SECRET`.
  Native-payments copy remains blocked until the target Pro readback and live
  announcement gate pass. Linear comment
  `6904e4fb-bec7-4787-90e2-759f077a628c` records the redacted readback counts.
- Handoff `ecc-supply-chain-audit-20260513-0645.md` under
  `~/.cluster-swarm/handoffs/`
  records the May 13 supply-chain sweep: no active lockfile/manifest hit for
  TanStack/Mini Shai-Hulud indicators; npm audit/signature checks clean across
  active npm lockfiles; `cargo audit` clean for `ecc2`; trunk `pip-audit`
  clean; JARVIS backend pinned-graph Python audit clean under the supported
  Python 3.12 target.
- PR #1861 validation refreshed `node scripts/harness-audit.js --format json`
  at 70/70 and `npm run observability:ready` at 21/21.
- PR #1862 updated this roadmap after the JARVIS backend Python audit was
  re-run against the supported Python 3.12 pinned graph.
- `docs/architecture/harness-adapter-compliance.md` maps Claude Code, Codex,
  OpenCode, Cursor, Gemini, Zed-adjacent, dmux, Orca, Superset, Ghast, and
  terminal-only support to install paths, verification commands, and risk
  notes.
- `npm run harness:adapters -- --check` validates that the public adapter
  matrix still matches the source data in
  `scripts/lib/harness-adapter-compliance.js`.
- `docs/releases/2.0.0-rc.1/publication-readiness.md` gates GitHub release,
  npm dist-tag, Claude plugin, Codex plugin, OpenCode package, billing, and
  announcement publication on fresh evidence fields.
- `docs/releases/2.0.0-rc.1/naming-and-publication-matrix.md` records the
  rc.1 naming decision: ship as Everything Claude Code (ECC), keep
  `ecc-universal` for npm, keep `ecc` for Claude/Codex plugin slugs, and defer
  any broader repo/package rename until after the release pipeline is proven.
- `docs/releases/2.0.0-rc.1/publication-evidence-2026-05-12.md` records the
  dry-run publication evidence pass: npm pack/publish dry-runs, temp install
  smoke, Claude plugin validation/tag preflight, Codex marketplace CLI shape,
  OpenCode build, and the remaining approval-gated release blockers.
- `docs/releases/2.0.0-rc.1/publication-evidence-2026-05-13.md` records the
  release-readiness evidence refresh: 70/70 harness audit, adapter compliance
  PASS, 16/16 observability readiness, 2376/2376 root Node tests, markdownlint,
  release-surface and npm publish-surface tests, and 462/462 `ecc2` Rust tests.
- `docs/releases/2.0.0-rc.1/publication-evidence-2026-05-13-post-hardening.md`
  records the post-hardening release-readiness refresh after PR #1850 and
  PR #1851: 70/70 harness audit, adapter compliance PASS, 18/18 observability
  readiness, 2380/2380 root Node tests, markdownlint, release-surface and
  npm publish-surface tests, 462/462 `ecc2` Rust tests, npm audit/signature
  checks, Rust advisory audit, and TanStack/Mini Shai-Hulud IOC checks.
- A detached clean worktree at
  `bfacf37715b39655cbc2c48f12f2a35c67cb0253` verified Claude plugin tag
  dry-run without `--force`, local marketplace discovery, temp-home local
  install, enabled plugin listing, and clean uninstall for `ecc@ecc`
  `2.0.0-rc.1`.
- `docs/architecture/evaluator-rag-prototype.md` and
  `examples/evaluator-rag-prototype/` define the first read-only
  self-improving harness prototype: scenario specs, traces, reports,
  candidate playbooks, verifier results, accepted maintainer-salvage,
  billing-readiness, CI-failure-diagnosis, and harness-config-quality
  candidates, plus the AgentShield policy-exception scenario and rejected
  unsafe candidates.
- The npm package surface now excludes Python bytecode/cache artifacts through
  package `files` negation rules and a publish-surface regression test.
- `docs/legacy-artifact-inventory.md` records that no `_legacy-documents-*`
  directories exist in the current checkout, inventories the two sibling
  workspace-level `_legacy-documents-*` repos as sanitized extraction sources,
  and classifies `legacy-command-shims/` as an opt-in archive/no-action
  surface.
- `docs/stale-pr-salvage-ledger.md` records stale PR salvage outcomes,
  skipped PRs, superseded work, and the remaining #1687, #1609, #1563, #1564,
  and #1565 translator/manual review tail now attached to Linear ITO-55.
- AgentShield PR #53 reduced two context-rule false positives and closed the
  remaining AgentShield issues.
- AgentShield PR #55 added GitHub Action organization-policy enforcement with
  `policy` / `fail-on-policy` inputs, `policy-status` /
  `policy-violations` outputs, job-summary evidence, and policy violation
  annotations.
- AgentShield PR #56 added SARIF/code-scanning output for organization-policy
  violations as `agentshield-policy/*` results.
- AgentShield PR #57 added OSS, team, enterprise, regulated,
  high-risk-hooks/MCP, and CI-enforcement policy-pack presets plus
  `agentshield policy init --pack`.
- AgentShield PR #58 added MCP package provenance fields and report-level
  counts for npm vs git, pinned vs unpinned, known-good, and registry-backed
  supply-chain evidence.
- AgentShield PR #59 added self-contained HTML executive summaries with risk
  posture, critical/high priority findings, category exposure, README/API
  docs, built-CLI smoke validation, and 1,704-test coverage.
- AgentShield PR #60 added category-level built-in corpus benchmark output,
  a `readyForRegressionGate` signal, terminal `--corpus` category coverage,
  README/API docs, built-CLI smoke validation, and 1,705-test coverage.
- AgentShield PR #61 cleared the remaining Dependabot security/bugfix PR with
  a lockfile-only `postcss` 8.5.6 -> 8.5.14 bump after local typecheck, full
  tests, lint, build, and remote self-scan/action verification.
- AgentShield PR #62 added organization-policy exception lifecycle audit
  evidence: active, expiring-soon, and expired exception counts; owner, ticket,
  scope, expiry, and days-until-expiry reporting; terminal output and GitHub
  Action job-summary evidence; README docs; rebuilt action bundles; and
  1,708-test validation.
- AgentShield PR #63 exposed baseline drift in the GitHub Action with
  `baseline` / `save-baseline` inputs, baseline drift outputs, job-summary
  evidence, regression annotations, README/API docs, rebuilt action bundles,
  and green remote action/self-scan/Node verification.
- AgentShield PR #64 added the first-class `agentshield baseline write`
  CLI command with severity filtering, JSON metadata output, README/API docs,
  rebuilt CLI bundle, local TDD coverage, and green remote action/self-scan/Node
  verification.
- AgentShield PR #65 pinned workflow actions for release/security CI hardening.
- AgentShield PR #66 disabled cache use in the release publish job so release
  publication does not depend on mutable restored build state.
- AgentShield PR #67 added the first portable enterprise evidence-pack bundle:
  `agentshield scan --evidence-pack <dir>` writes deterministic manifest,
  README, JSON, HTML, SARIF, policy-evaluation, baseline-comparison, and
  supply-chain artifacts with default redaction and `not-run` markers for
  optional policy/baseline evidence.
- AgentShield PR #68 hardened evidence-pack redaction for enterprise credential
  families including GitHub fine-grained PATs, GitLab PATs, npm tokens, Linear
  API keys, Stripe keys, Google API keys, Hugging Face tokens, Vercel tokens,
  AWS access key IDs, and JWT-shaped credentials.
- AgentShield PR #69 added the deterministic harness adapter registry. Scan
  reports now surface local marker evidence for Claude Code, OpenCode, Codex,
  Gemini, dmux, generic terminal agents, and project-local templates in JSON,
  markdown, terminal, and HTML outputs.
- AgentShield PDF-export decision: defer a native PDF writer for now. The
  self-contained HTML executive report remains the exportable buyer artifact
  and can be printed to PDF when needed; native PDF generation should wait for
  explicit enterprise/compliance demand or a print-fidelity gap in the HTML
  report.
- `docs/architecture/agentshield-enterprise-research-roadmap.md` identifies
  the next AgentShield enterprise signal: move from scanner/report/policy gate
  to a team control plane with baseline drift, evidence packs, multi-harness
  adapters, corpus accuracy gates, remediation routing, threat intelligence,
  and ECC-Tools/GitHub App integration.
- ECC PR #1778 recovered the useful stale #1413 network/homelab architect-agent
  concepts.
- ECC-Tools PR #26 added cost/token-risk predictive follow-ups for AI routing,
  Claude/model calls, usage limits, quota, and analysis-budget changes that lack
  budget, quota, rate-limit, or cost validation evidence.
- ECC-Tools PR #27 added the non-blocking `ECC Tools / PR Risk Taxonomy`
  check-run for Security Evidence, Harness Drift, Install Manifest Integrity,
  CI/CD Recommendation, Cost/Token Risk, and Agent Config Review buckets.
- ECC-Tools PR #28 added billing readiness audit checks for plan limits,
  entitlements, Marketplace plan shape, subscription source, seats, and
  overage metering.
- ECC-Tools PR #29 added deterministic Reference Set Validation signals for
  analyzer, skill, agent, command, and harness-guidance changes that lack eval,
  golden trace, benchmark, or reference-set evidence.
- ECC-Tools PR #30 capped follow-up generation to three new GitHub issues and
  one draft PR per run, then emits the remaining deterministic findings as a
  project sync backlog for Linear/status tracking without flooding trackers.
- ECC-Tools PR #31 added review follow-up signals to analysis completion
  comments for outstanding change requests, unresolved or outdated review
  threads, and review activity without an explicit approval.
- ECC-Tools PR #32 added CI failure-mode predictive follow-ups for workflow
  and test-runner changes that lack failure fixtures, captured logs,
  troubleshooting notes, dry-run evidence, or regression coverage.
- ECC-Tools PR #33 added harness-config quality predictive follow-ups for MCP,
  plugin, agent, hook, command, and harness config changes that lack harness
  audit, adapter matrix, cross-harness docs, or compatibility regression
  evidence.
- ECC-Tools PR #34 added skill-quality predictive follow-ups and a Skill
  Quality PR-risk bucket for skill, agent, command, and rule guidance changes
  that lack examples, validation, eval, or reference evidence.
- ECC-Tools PR #35 added RAG/evaluator predictive follow-ups and a
  RAG/Evaluator Evidence PR-risk bucket for retrieval, embedding, ranking, and
  evaluator changes that lack reference-set comparison, golden trace,
  benchmark, fixture, or eval-run evidence.
- ECC-Tools PR #36 added deep-analyzer predictive follow-ups, a Deep Analyzer
  Evidence PR-risk bucket, and a Linear-ready project sync backlog table for
  deferred follow-up work.
- ECC-Tools PR #37 added a maintained analyzer corpus fixture, corpus validation
  tests, and co-located analyzer reference-set evidence recognition for future
  predictive follow-ups and PR-risk taxonomy checks.
- ECC-Tools PR #38 added PR review/stale-salvage predictive follow-ups, a
  PR Review/Salvage Evidence taxonomy bucket, and maintained corpus fixtures
  for stale-closure salvage, reviewer-thread, and reopen-flow evidence.
- ECC-Tools PR #39 added opt-in native Linear GraphQL sync for deferred
  follow-up backlog items, preserving GitHub object caps while creating or
  reusing Linear issues when `LINEAR_API_KEY` and `LINEAR_TEAM_ID` are
  configured.
- ECC-Tools PR #40 added a checked-in evaluator/RAG corpus contract covering
  stale-PR salvage, billing readiness, CI failure diagnosis, harness config
  quality, AgentShield policy exceptions, skill-quality evidence,
  deep-analyzer evidence, and RAG/evaluator comparison evidence, with each
  scenario exercising missing-evidence and evidence-backed diffs.
- ECC-Tools PR #41 hardened supply-chain dependencies.
- ECC-Tools PR #42 added AgentShield evidence-pack gap prediction and routed
  missing policy/baseline/allowlist/suppression/supply-chain evidence into the
  PR-risk taxonomy, follow-up drafts, and Linear-ready backlog table.
- ECC-Tools PR #43 recognized the concrete AgentShield #67 evidence-pack
  artifact contract so canonical bundle files now satisfy the taxonomy and
  generated follow-up PRs point maintainers at
  `agentshield scan --evidence-pack <dir>`.
- ECC-Tools PR #55 added the first hosted/deeper-analysis readiness signal:
  analysis comments now classify a repo as commit-history-only,
  evidence-backed, or deep-ready before routing work into CI, AgentShield,
  harness, reference-set, RAG/evaluator, AI-routing, cost-control, and
  Linear/project-tracking lanes.
- ECC-Tools PR #56 turned that signal into a hosted execution-plan contract:
  `/api/analysis/depth-plan` returns ready/blocked jobs and next action text
  without charging analysis usage or creating bundle PRs.
- ECC-Tools PR #57 implemented the first job-specific hosted executor:
  `/api/analysis/jobs/ci-diagnostics` reuses the depth-readiness gate, internal
  API auth, installation ownership, repo-access billing checks, capped workflow
  file reads, and usage accounting to return concrete CI hardening findings.
- ECC-Tools PR #58 implemented the second job-specific hosted executor:
  `/api/analysis/jobs/security-evidence-review` applies the same hosted gates
  to AgentShield evidence-pack, policy, baseline, SBOM, SARIF, and security
  scanner artifacts.
- ECC-Tools PR #59 implemented the third job-specific hosted executor:
  `/api/analysis/jobs/harness-compatibility-audit` applies the same hosted
  gates to Claude, Codex, OpenCode, MCP, plugin, and cross-harness evidence
  while avoiding local secret-bearing harness config fetches.
- ECC-Tools PR #60 implemented the fourth job-specific hosted executor:
  `/api/analysis/jobs/reference-set-evaluation` applies the same hosted gates
  to analyzer corpus, RAG/evaluator, PR salvage, harness, security, and CI
  failure-mode reference evidence while avoiding obvious secret-bearing fixture
  fetches.
- ECC-Tools PR #61 implemented the fifth job-specific hosted executor:
  `/api/analysis/jobs/ai-routing-cost-review` applies the same hosted gates to
  model-routing, token-budget, usage-limit, rate-limit, billing/entitlement,
  cost-regression, and cost-policy evidence while avoiding obvious
  secret-bearing path fetches.
- ECC-Tools PR #62 implemented the sixth job-specific hosted executor:
  `/api/analysis/jobs/team-backlog-routing` applies the same hosted gates to
  roadmap, runbook, handoff, release-plan, issue-template, ownership,
  project-tracker, backlog, and follow-up evidence while avoiding obvious
  secret-bearing path fetches.
- ECC-Tools PR #63 publishes the hosted depth-plan check-run after queued PR
  analysis completes, making the six hosted executor commands visible on the
  PR head SHA without turning the check into a merge blocker.
- ECC-Tools PR #64 wires those commands into the queue: maintainers can comment
  `/ecc-tools analyze --job ci-diagnostics`, `security-evidence`,
  `harness-compatibility`, `reference-set-evaluation`, `ai-routing-cost`, or
  `team-backlog` on a PR and receive hosted job results in a PR comment.
- ECC-Tools PR #65 persists completed and blocked hosted job results to the
  analysis cache for 30 days and publishes non-blocking `ECC Tools / Hosted
  Job: ...` check-runs so maintainers can scan hosted outcomes from the PR
  checks surface instead of rereading older comments.
- ECC-Tools PR #66 exposes the cached results from PR comments with
  `/ecc-tools analyze --job status`, summarizing completed, blocked, and
  not-yet-run hosted jobs for the PR head and recommending the next hosted job
  command.
- ECC-Tools PR #67 feeds those cached results back into the hosted depth-plan
  check-run so queued analysis recommends the next unrun ready hosted job from
  cache state instead of repeating the static readiness order.
- ECC-Tools PR #68 adds the first evaluator-backed hosted promotion gate:
  opened/synchronized PRs get a non-blocking Hosted Promotion Readiness
  check-run that turns the evaluator/RAG corpus into warnings when changed
  files match fixture scenarios without their expected evidence artifacts.
- ECC-Tools PR #69 extends that gate to score cached completed hosted job
  outputs for the current PR head, so hosted artifacts can satisfy corpus
  evidence expectations before the check reports a promotion gap.
- ECC-Tools PR #76 consumes AgentShield PR #89 fleet output in hosted security
  review: `agentshield-evidence/fleet-summary.json` is now classified as
  `evidence-pack-fleet`, invalid packs and security-blocker routes become
  high-severity hosted findings, and policy, baseline, and supply-chain routes
  produce owner-ready review findings.
- ECC-Tools PR #77 merged as `31fd883b3f0cee135aee4839b01d34855b7867f6`
  and adds an `Evidence` column to hosted job PR comments and check-run
  details, surfacing up to three source evidence paths for each finding so
  AgentShield fleet-derived findings point operators back to the exact bundle
  artifact.
- ECC-Tools PR #78 merged as `0d4eb949aa56f56da88e6654273a22ffb95983a1`
  and links AgentShield fleet routes into hosted harness compatibility review:
  fleet summaries are collected as harness evidence, target paths are mapped to
  Claude, Codex, OpenCode, MCP, plugin, and cross-harness owners, and routed
  findings carry source evidence paths for operator review.
- AgentShield PR #90 merged as `6d1c57c92000541d65a3b6bc366f0322d7d0dacc`
  and adds durable fleet `reviewItems`: `agentshield evidence-pack fleet --json`
  now returns owner-ready review items with route, severity, repository/target
  context, source evidence paths, reason, and recommendation; the text CLI
  prints the same routed follow-up list for operators.
- AgentShield PR #91 merged as `73e1e3586dc4513a462e39c9799f75eea104e110`
  and adds durable policy pack export: `agentshield policy export` writes one
  JSON policy per selected pack plus a checksum-backed `manifest.json`, with
  pack selection, owners, name prefixes, and JSON output for branch-protection
  review or downstream policy promotion.
- AgentShield PR #92 merged as `e7e259dc6212b63a8e03a253ca6b8c1e3c2abff7`
  and adds the protected promotion gate for those bundles:
  `agentshield policy promote` verifies the export manifest and selected
  policy SHA-256 digest, rejects tampered policy JSON, requires explicit pack
  selection for multi-pack manifests, and supports dry-run JSON review before
  writing the active `.agentshield/policy.json`.
- AgentShield main commit `87aec47fb55d04ea28d494852d4f664c268c5601`
  extends policy promotion with durable `reviewItems` for manifest digest
  evidence, policy-owner approval, protected rollout PR handoff, and runtime
  smoke testing. Local validation passed `npm run typecheck`, `npm run lint`,
  and `npm test`; GitHub Actions run `25985170621` completed successfully
  across Node 18, 20, and 22 plus self-scan examples, and the sibling
  AgentShield Self-Scan/Test GitHub Action runs also completed successfully.
- AgentShield main commit `28d08c7f9961eaa54804b26e6352d23b64ae2776`
  adds package-manager hardening drift detection for `.npmrc`, `.pnpmrc`,
  `.yarnrc`, `.yarnrc.yml`, `pnpm-workspace.yaml`, and
  `pnpm-workspace.yml`, including plaintext registry credential detection,
  explicit lifecycle-script enablement, and missing or weak release-age
  cooldown findings. Local validation passed focused rule/scanner tests,
  `npm run typecheck`, `npm run lint`, `npm run build`, full
  `npm test -- --run`, and `git diff --check`; GitHub Actions run
  `25986170958` completed successfully, and the sibling AgentShield Self-Scan
  and Test GitHub Action runs passed.
- AgentShield main commit `659f569190f85f6f0808353e096d66c0a6d7817e`
  updates all workflow action pins to current SHA-pinned
  `actions/checkout@v6.0.2` and `actions/setup-node@v6.4.0`; GitHub Actions
  run `25986221319` completed successfully and the prior Node 20 action-runtime
  deprecation annotation was gone from the final CI watch output.
- AgentShield main commit `ee585cd` corrects package-manager hardening
  guidance after local verification showed npm `10.9.4` rejects
  `min-release-age`: npm configs are now scanned for lifecycle/token drift and
  unsupported release-age keys, while enforceable cooldown findings stay on
  pnpm `minimumReleaseAge` / `minimum-release-age` and Yarn
  `npmMinimalAgeGate`. Local validation passed package-manager/scanner tests,
  `npm run typecheck`, `npm run lint`, `npm run build`, and
  `git diff --check`; GitHub Actions run `25986719058`, Test GitHub Action run
  `25986719054`, and AgentShield Self-Scan run `25986719066` completed
  successfully.
- AgentShield main commit `1124535345d7040242ecd3803f65bcd4dcaf6ec2`
  exposes package-manager hardening through the GitHub Action so CI/hosted
  consumers can route registry credential, lifecycle-script, and release-age
  gate drift separately from generic finding counts. Local validation passed
  focused action tests, `npm run typecheck`, `npm run lint`, `npm run build`,
  full `npm test`, and `git diff --check`; GitHub Actions CI run
  `25994354007`, Test GitHub Action run `25994354011`, and AgentShield
  Self-Scan run `25994354026` completed successfully.
- ECC PR #1803 landed the contributor Quarkus handling branch after maintainer
  cleanup, current-`main` alignment, full local validation, and preservation of
  the author's removal of incomplete ja-JP and zh-CN Quarkus translations.
- ECC PR #1812 salvaged useful Django reviewer, Django build resolver, and
  Django Celery guidance from stale PR #1310 through a maintainer-owned branch
  with source credit, catalog sync, and full local/remote validation.
- ECC PR #1813 expanded the stale PR salvage ledger with source-to-salvage
  mappings for #1325, #1414, #1478, #1504, and #1603, confirming those useful
  stale contributions were already preserved through later maintainer PRs.
- ECC PR #1815 salvaged the useful stale #1304 cost-tracking and #1232
  skill-scout work into current command/skill conventions with current catalog
  sync and full local/remote validation.
- ECC PR #1816 salvaged the useful stale #1659 frontend design guidance into
  canonical ECC skill layout while preserving the guardrail that the official
  Anthropic `frontend-design` skill remains externally sourced.
- ECC PR #1817 salvaged the useful stale #1658 code-reviewer false-positive
  guardrails, adding proof gates for HIGH/CRITICAL findings, common
  false-positive exclusions, and a regression test.
- ECC PR #1818 recorded the May 12 stale-salvage gap pass, classifying already
  present work, skipped work, and translator/manual-review leftovers.

## Operating Rules

- Keep public PRs and issues below 20, with zero as the preferred release-lane
  target.
- Maintain 70/70 harness audit and 21/21 observability readiness after every
  GA-readiness batch.
- Do not publish release or social announcements until the GitHub release,
  npm/package state, billing state, and plugin submission surfaces are verified
  with fresh evidence.
- Do not treat closed stale PRs as discarded. Pair each cleanup batch with a
  salvage pass: inspect the closed diffs, port useful compatible work on
  maintainer-owned branches, and credit the source PR.
- Do not create new Linear issues until the active issue limit is cleared.

## Prompt-To-Artifact Execution Checklist

This table keeps the long operator prompt tied to concrete artifacts. A status
is not complete unless the evidence column exists and has been freshly verified.

| Prompt requirement | Required artifact or gate | Current evidence | Status |
| --- | --- | --- | --- |
| Keep public PRs below 20 | Repo-family PR recheck | 0 open PRs across `ECC`, AgentShield, JARVIS, `ECC-Tools/ECC-Tools`, and `ECC-Tools/ECC-website` on 2026-05-18 after merging PR #1976 and refreshing platform audit evidence | Complete |
| Keep public issues below 20 | Repo-family issue recheck | 0 open issues across `ECC`, AgentShield, JARVIS, `ECC-Tools/ECC-Tools`, and `ECC-Tools/ECC-website` on 2026-05-18 after the live platform audit refresh | Complete |
| Manage repository discussions | Repo-family discussion recheck plus response playbook | Platform audit reports 0 discussion maintainer-touch gaps and 0 answerable Q&A missing accepted answers; trunk still has 58 total discussions; `docs/architecture/discussion-response-playbook.md` distinguishes support, maintainer coordination, stale/concluded, release, informational, and security-sensitive response paths | Complete |
| Manage PR discussions | PR review/comment closure plus merge/close state | ECC #1976 merged after maintainer follow-up validation; no open tracked PRs remain | Complete |
| Salvage useful stale work | `docs/stale-pr-salvage-ledger.md` plus `docs/legacy-artifact-inventory.md` | Ledger records salvaged, superseded, skipped, and manual-review tails; #1815-#1818 added cost tracking, skill scout, frontend design guidance, code-reviewer false-positive guardrails, and the May 12 gap pass; #1687, #1609, #1563, #1564, and #1565 localization tails are attached to Linear ITO-55 for language-owner review and no automatic import remains release-blocking | Complete; repeat legacy scan before release |
| ECC 2.0 preview pack ready | Release docs, quickstart, publication readiness, release notes | `docs/releases/2.0.0-rc.1/` and readiness docs are in-tree; May 18 evidence records queue-zero state, #1970/#1971/#1972/#1976 merge batch, supply-chain recheck, defensive-deny IOC scanner hardening, npm no-lifecycle install/audit/signature gates, Linear sync, refreshed operator dashboard, provider-guard validation, ECC-Tools Wrangler OAuth billing readback evidence, successful current-head CI on `04d4d819`, and detached clean-worktree preview-pack smoke digest `59bbf2630a44` | Needs final release approval |
| Hermes specialized skills included safely | Hermes setup/import docs and sanitized skill surface | Hermes setup and import playbook are public; secrets stay local | Needs final release review |
| Naming and rename readiness | Naming matrix across package/plugin/docs/social surfaces | `docs/releases/2.0.0-rc.1/naming-and-publication-matrix.md` records current package, repo, Claude plugin, Codex plugin, OpenCode, and npm availability evidence | Complete for rc.1; post-rc rename remains future work |
| Claude and Codex plugin publication | Contact/submission path with required artifacts and status | Publication readiness, naming matrix, and May 12 dry-run evidence document plugin validation, clean-checkout Claude tag/install smoke, and Codex marketplace CLI shape | Needs explicit approval for real tag/push and marketplace submission |
| Articles, tweets, and announcements | X thread, LinkedIn copy, GitHub release copy, push checklist | Draft launch collateral exists under rc.1 release docs | Needs URL-backed refresh |
| AgentShield enterprise iteration | Policy gates, SARIF, packs, provenance, corpus, HTML reports, exception lifecycle audit, baseline drift Action/CLI surfaces, evidence-pack redaction, harness adapter registry, enterprise research roadmap, supply-chain hardened release path, CI-safe baseline fingerprints, corpus accuracy recommendations, remediation workflow phases, env proxy hijack corpus coverage, Mini Shai-Hulud full-campaign package IOCs, CI-provenance evidence packs, plugin-cache runtime-confidence triage, evidence-pack consumer readback, fleet-level evidence-pack routing, fleet review items, fleet review ticket payloads, checksum-backed policy export, checksum-verified policy promotion, policy promotion review items, package-manager hardening drift detection, npm age-gate guidance correction, workflow action-runtime pin refresh, package-manager hardening Action outputs, policy-promotion Action outputs, ECC-Tools hosted consumption of promotion Action outputs, ECC-Tools operator-visible promotion output values, and ECC-Tools hosted promotion judge audit traces | PRs #53, #55-#64, #67-#69, and #78-#92 landed with test evidence, ECC-Tools #76 consumes the fleet-summary output in hosted security review, #77 surfaces source evidence paths in hosted finding output, and #78 links fleet routes to harness owner review; AgentShield #91 adds `agentshield policy export` bundles for branch-protection review and downstream promotion; AgentShield #92 adds `agentshield policy promote` with digest verification, tamper rejection, explicit pack selection, dry-run review, and JSON output before writing active policy; AgentShield commit `87aec47` adds `reviewItems` for digest evidence, owner review, protected rollout PR handoff, and runtime smoke testing with green local and remote CI; AgentShield commit `28d08c7` adds package-manager hardening drift detection for plaintext registry credentials, lifecycle-script enablement, and weak pnpm/Yarn release-age cooldowns with green local and remote CI; AgentShield commit `659f569` refreshes all workflow action runtime pins to SHA-pinned checkout v6.0.2 and setup-node v6.4.0 with green remote CI and no remaining action-runtime deprecation annotation; AgentShield commit `ee585cd` corrects npm release-age guidance by flagging unsupported npm age keys and keeping enforceable cooldown findings on pnpm/Yarn with green local and remote CI; AgentShield commit `1124535` exposes package-manager hardening status/count outputs and a redacted job-summary section for registry credentials, lifecycle scripts, and release-age gates with green local and remote CI; AgentShield commit `1593925` exposes policy-promotion status/count/digest outputs plus job-summary review items for owner approval, protected rollout, and runtime smoke, and marks runtime smoke verified when the same Action job scans with the promoted policy; AgentShield commit `840952a` adds Linear/operator-ready fleet review ticket payloads and expands current Mini Shai-Hulud IOC breadcrumbs with green local and remote CI; ECC-Tools commit `8658951` routes those policy-promotion Action outputs into hosted security review findings and Hosted Promotion Readiness scoring; ECC-Tools commit `16c537f` renders policy-promotion status, pack, review item count, action-required count, and digest in hosted security job comments/check-runs; ECC-Tools commit `05d4e82` renders hosted promotion judge request fingerprints and allowed-citation counts without raw provider output; native PDF export deferred in favor of self-contained HTML plus print-to-PDF until explicit enterprise demand appears; `docs/architecture/agentshield-enterprise-research-roadmap.md` now has baseline drift, evidence-pack bundle, redaction, adapter-registry, supply-chain hardening, hashed baseline fingerprints, corpus accuracy recommendation, remediation workflow, env proxy hijack corpus, Mini Shai-Hulud full-campaign package-table, `ci-context.json` provenance, `plugin-cache` confidence, `evidence-pack inspect` readback, `evidence-pack fleet` routing, fleet `reviewItems`, fleet review ticket payloads, policy export, policy promotion, policy promotion `reviewItems`, package-manager hardening Action outputs, policy-promotion Action outputs, hosted consumption of promotion Action outputs, operator-visible promotion output values, and hosted promotion judge audit traces landed | Next workflow automation should deepen live operator approval/readback after Marketplace/payment gates |
| ECC Tools next-level app | Billing audit, PR checks, deep analyzer, sync backlog, evaluator/RAG corpus, analysis-depth readiness, hosted execution planning, hosted CI diagnostics, hosted security evidence review, hosted harness compatibility audit, hosted reference-set evaluation, hosted AI routing/cost review, hosted team backlog routing, hosted depth-plan check-run, PR-comment hosted job dispatch, hosted job result history/check-runs, hosted result status command, status-aware depth-plan recommendations, hosted promotion readiness, hosted promotion output scoring, hosted promotion retrieval planning, hosted promotion judge contract, gated hosted promotion judge execution, hosted promotion judge audit trace, payment-announcement readiness, billing announcement preflight, aggregate production billing KV readback, Marketplace webhook provenance, target-account billing readback, Marketplace-source provenance counts, AgentShield fleet-summary hosted routing, hosted finding evidence paths, harness-route policy linking, policy-promotion Action-output hosted telemetry, and operator-visible promotion output values | PRs #26-#43 plus #53-#78 landed with test evidence, including AgentShield evidence-pack gap routing, canonical bundle recognition, supply-chain signature gates, PR draft follow-up Linear tracking, evidence-backed/deep-ready repository classification, the `/api/analysis/depth-plan` hosted job plan, `/api/analysis/jobs/ci-diagnostics`, `/api/analysis/jobs/security-evidence-review`, `/api/analysis/jobs/harness-compatibility-audit`, `/api/analysis/jobs/reference-set-evaluation`, `/api/analysis/jobs/ai-routing-cost-review`, `/api/analysis/jobs/team-backlog-routing`, the `ECC Tools / Hosted Depth Plan` check-run, `/ecc-tools analyze --job ...` PR-comment dispatch, non-blocking per-hosted-job result check-runs backed by 30-day result cache records, `/ecc-tools analyze --job status` cache lookup, cache-aware next-job recommendations in the depth-plan check-run, the `ECC Tools / Hosted Promotion Readiness` corpus-backed PR check-run, deterministic hosted-output scoring against cached completed job artifacts/findings, ranked retrieval/model-prompt planning, the fail-closed `hosted-promotion-judge.v1` request contract, opt-in live model-judge execution behind hosted evidence, entitlement, budget, provider, executor, strict JSON, and citation gates, hosted promotion judge request fingerprints plus allowed-citation audit trails, a fail-closed `/api/billing/readiness` `announcementGate` for native GitHub payments claims, `npm run billing:announcement-gate` plus `--preflight` as the non-secret operator verifier, hosted security findings for AgentShield fleet summaries, an `Evidence` column in hosted finding comments/check-runs, hosted harness findings that route AgentShield fleet target paths to harness owners, ECC-Tools commit `8658951` routing AgentShield policy-promotion Action outputs into hosted security review and promotion-readiness scoring, ECC-Tools commit `16c537f` rendering policy-promotion status/pack/count/digest values directly in hosted security job comments/check-runs, ECC-Tools commit `05d4e82` rendering model-judge audit traces without exposing raw provider output, ECC-Tools commit `91a441b` adding the safe billing announcement preflight path, ECC-Tools commit `eb69412` recording the initial production readback state, ECC-Tools commit `95d0bec` adding `npm run billing:kv-readback` with aggregate account-billing and billing-state records but 0 Marketplace Pro billing-state records, ECC-Tools commit `2859678` requiring webhook-derived Marketplace provenance before announcement readiness, ECC-Tools commit `42653f9` adding Wrangler OAuth readback, ECC-Tools commit `632e059` adding sanitized target-account readback that requires both target key families before `--require-ready` can pass, and ECC-Tools commit `d5f60db` adding sanitized Marketplace plan/action provenance counts; the latest 2026-05-18 live Wrangler OAuth recheck found 256 account-billing records, 256 billing-state records, 197 Marketplace-source records, 4 Marketplace webhook-provenance records, all `Open Source`, and 0 Marketplace Pro records, then updated Linear ITO-61 with the data/provisioning blocker | Next work is create or verify Marketplace-managed Pro target billing-state with webhook provenance, configure target account plus `INTERNAL_API_SECRET`, then run `billing:kv-readback -- --wrangler --wrangler-bin ./node_modules/.bin/wrangler --account <github-login> --require-ready`, followed by the live announcement gate |
| GitGuardian/Dependabot/CodeRabbit-style checks | Non-blocking taxonomy, deterministic follow-up checks, and local supply-chain gates | ECC-Tools risk taxonomy check plus follow-up signals landed, including Skill Quality, Deep Analyzer Evidence, Analyzer Corpus Evidence, RAG/Evaluator Evidence, PR Review/Salvage Evidence, and AgentShield evidence-pack evidence; #1846 added npm registry signature gates; #1848 added the supply-chain incident-response playbook and `pull_request_target` cache-poisoning validator guard; #1851 added the privileged checkout credential-persistence guard; AgentShield #78, JARVIS #13, and ECC-Tools #53 applied the same hardening outside trunk | Current supply-chain gate complete; deeper hosted review features remain future |
| Harness-agnostic learning system | Audit, adapter matrix, observability, traces, promotion loop | Audit/adapters/observability gates plus `docs/architecture/evaluator-rag-prototype.md`, `examples/evaluator-rag-prototype/`, and ECC-Tools PR #40 define read-only stale-salvage, billing-readiness, CI-failure-diagnosis, harness-config-quality, AgentShield policy-exception, skill-quality evidence, deep-analyzer evidence, and RAG/evaluator comparison scenarios with trace, report, playbook, verifier, and predictive-check artifacts; ECC-Tools PRs #68-#72 now turn that corpus into a deterministic PR check-run gate with cached hosted-output scoring, ranked retrieval candidates, a model prompt seed, a fail-closed hosted model-judge request contract, and opt-in live model execution behind strict hosted-evidence gates | Deterministic hosted PR check, cached output scoring, retrieval planning, judge contract, and gated model execution integrated |
| Linear roadmap is detailed | Linear project status plus repo mirror | Repo mirror exists; issue creation was retried on 2026-05-12 and remains blocked by the workspace free issue limit; the May 18 sync adds queue-zero/work-items state, #1970/#1971/#1972/#1976 merge evidence, ITO-57 current-head supply-chain refresh comment `0b9931b9-1556-4ebc-a70c-f3635557625d`, ITO-57 defensive-deny scanner recheck reply `6fa15367-d994-4e53-ade3-9462477e1100`, ECC platform progress comment `e32e5b7a-287b-4bf4-9ed7-314389a157e1`, and generated `operator:dashboard` prompt-to-artifact audit for recurring status updates | Needs recurring status updates after each significant merge batch |
| Flow separation and progress tracking | Flow lanes with owner artifacts and update cadence | This roadmap defines lanes below and `docs/architecture/progress-sync-contract.md` makes GitHub/Linear/handoff/roadmap sync part of the readiness gate | Active |
| Realtime Linear sync | Project comments while issue/status capacity is blocked; issues later | ECC-Tools #39 implements opt-in Linear API sync for deferred follow-up backlog items, and ECC-Tools #54 adds copy-ready PR drafts to that backlog when draft PR shells are not opened; `docs/architecture/progress-sync-contract.md` defines the local file-backed realtime boundary while issue capacity is blocked; May 18 live connector comments were posted to ITO-57 and the ECC platform project after project status updates returned disabled | Needs workspace capacity/config rollout for productized issue sync |
| Observability for self-use | Local readiness gate, traces, status snapshots, HUD/status contract, risk ledger, progress-sync contract | `npm run observability:ready` reports 21/21 | Complete for local gate |
| Proper release and notifications | Release tag, npm publish state, plugin state, social posts | Publication readiness gate exists with May 12 dry-run and May 13 readiness evidence | Not complete; approval/live URLs required |

## Execution Lanes And Tracking Contract

Until Linear issue capacity is cleared, this document is the durable execution
ledger and Linear receives project status updates only. The sync contract lives
at `docs/architecture/progress-sync-contract.md`. When capacity is available,
each lane below should become a small set of Linear issues linked back to the
repo evidence and merge commits.

| Lane | Source of truth | Next tracked artifact | Update cadence |
| --- | --- | --- | --- |
| Queue hygiene and salvage | GitHub PR/issue state, salvage ledger | Append ledger entries for any future stale closures | Every cleanup batch |
| Release and publication | rc.1 release docs, publication readiness doc | Naming matrix and plugin submission/contact checklist | Before any tag |
| Harness OS core | Audit, adapter matrix, observability docs, `ecc2/` | HUD/session-control acceptance spec | Weekly until GA |
| Evaluation and RAG | Reference-set validation, harness audit, traces, ECC-Tools corpus | Read-only evaluator/RAG prototype plus stale-salvage, billing-readiness, CI-failure-diagnosis, harness-config-quality, AgentShield policy-exception, skill-quality evidence, deep-analyzer evidence, and RAG/evaluator comparison fixtures; ECC-Tools #68 publishes the corpus as a hosted promotion readiness check-run, #69 scores cached hosted job outputs against the same corpus, #70 emits ranked retrieval candidates plus a model prompt seed, #71 adds a fail-closed hosted model-judge request contract, and #72 executes that judge only when explicitly enabled and backed by hosted retrieval citations; ECC-Tools `16c537f` surfaces policy-promotion Action output values in hosted security comments/checks; ECC-Tools `05d4e82` adds hosted model-judge audit traces with request fingerprints and allowed-citation counts | Marketplace Pro billing-state verification with webhook provenance |
| AgentShield enterprise | AgentShield PR evidence and roadmap notes | Fleet routing landed in #89 after evidence-pack inspect/readback shipped in #88; #90 emits fleet `reviewItems`; #91 exports checksum-backed policy bundles; #92 promotes checksum-verified policies from those bundles into active policy files; AgentShield `87aec47` adds policy promotion `reviewItems`; `28d08c7` adds package-manager hardening drift detection; `659f569` refreshes workflow action runtime pins; `ee585cd` corrects unsupported npm release-age guidance and keeps enforceable cooldown findings on pnpm/Yarn; `1124535` exposes package-manager hardening Action outputs for CI/hosted routing; `1593925` exposes policy-promotion Action outputs and runtime-smoke job-summary evidence; `840952a` adds fleet review ticket payloads and current Mini Shai-Hulud IOC breadcrumbs; ECC-Tools #76 consumes fleet summaries, #77 surfaces source evidence paths in hosted findings, #78 links fleet routes to harness owners, ECC-Tools `8658951` consumes policy-promotion Action outputs, and ECC-Tools `16c537f` renders operator-visible output values | Deepen live operator approval/readback after Marketplace/payment gates |
| ECC Tools app | ECC-Tools PR evidence, billing audit, risk taxonomy, evaluator/RAG corpus | ECC-Tools #53 published the supply-chain workflow hardening branch, #54 tracks copy-ready PR drafts in the Linear/project backlog, #55 classifies analysis-depth readiness, #56 exposes the hosted execution plan, #57 executes the first hosted CI diagnostics job, #58 executes the hosted security evidence review job, #59 executes the hosted harness compatibility audit, #60 executes the hosted reference-set evaluation, #61 executes the hosted AI routing/cost review, #62 executes hosted team backlog routing, #63 publishes the hosted depth-plan check-run, #64 dispatches hosted jobs from PR comments, #65 persists hosted result history/check-runs, #66 exposes hosted job status from PR comments, #67 makes depth-plan recommendations cache-aware, #68 publishes hosted promotion readiness from the evaluator/RAG corpus, #69 scores cached hosted job outputs against that corpus, #70 emits ranked retrieval candidates plus a model prompt seed, #71 emits the gated `hosted-promotion-judge.v1` contract without live model calls, #72 adds opt-in live model-judge execution behind hosted-evidence and strict JSON/citation gates, #73 adds a fail-closed native-payments `announcementGate` to billing readiness, #74 adds `npm run billing:announcement-gate` for operator verification, #75 tightens the billing announcement gate for live Marketplace readback, #76 routes AgentShield fleet-summary evidence into hosted security findings, #77 adds source evidence paths to hosted finding output, #78 links AgentShield fleet target paths to hosted harness owner findings, `8658951` routes AgentShield policy-promotion Action outputs into hosted security review and promotion readiness, `16c537f` renders policy-promotion status/pack/count/digest values in hosted security comments/checks, `05d4e82` renders hosted promotion judge request fingerprints plus allowed-citation audit traces, `91a441b` adds billing announcement preflight output for required readback inputs, `eb69412` records the initial production readback state, `95d0bec` adds aggregate `billing:kv-readback` evidence, `2859678` requires Marketplace webhook provenance in billing readiness, `42653f9` adds Wrangler OAuth readback with live aggregate production counts, and `632e059` adds sanitized target-account billing readback for the exact Marketplace test account | Create or verify Marketplace-managed Pro target billing-state with webhook provenance, then live target readback and announcement gate |
| Linear progress | Linear project status updates, `docs/architecture/progress-sync-contract.md`, generated `operator:dashboard` output, and this mirror | Status update with queue/evidence/missing gates | Every significant merge batch |

The project status update should always include:

1. Current public PR and issue counts.
2. Merged evidence since the previous update.
3. Deferred or blocked items with the reason.
4. The next one or two implementation slices.
5. Any release or publication gate that is still not evidence-backed.

## Reference Pressure

The GA roadmap is informed by these reference surfaces:

- `stablyai/orca` and `superset-sh/superset` for worktree-native parallel agent
  UX, review loops, and workspace presets.
- `standardagents/dmux` and `aidenybai/ghast` for terminal/worktree
  multiplexing, session grouping, and lifecycle hooks.
- `jarrodwatts/claude-hud` for always-visible status, tool, agent, todo, and
  context telemetry.
- `stanford-iris-lab/meta-harness` and `greyhaven-ai/autocontext` for
  evaluation-driven harness improvement, traces, playbooks, and promotion
  loops.
- `NousResearch/hermes-agent` for operator shell, gateway, memory, skills, and
  multi-platform command patterns.
- `anthropics/claude-code`, active `sst/opencode` / `anomalyco/opencode`, Zed,
  Codex, Cursor, Gemini, and terminal-only workflows for adapter expectations.

The output of this reference work should be concrete ECC deltas, not a second
strategy memo.

## Milestones

### 1. GA Release, Naming, And Plugin Publication Readiness

Target: 2026-05-24

Acceptance:

- Naming matrix covers product name, npm package, Claude plugin, Codex plugin,
  OpenCode package, marketplace metadata, docs, and migration copy.
- GitHub release, npm dist-tag, plugin publication, and announcement gates are
  mapped to fresh command evidence.
- Release notes, migration guide, known issues, quickstart, X thread, LinkedIn
  post, and GitHub release copy are ready but not posted before release URLs
  exist.
- Plugin publication/contact paths for Claude and Codex are documented with
  owner, required artifacts, and submission status.

### 2. Harness Adapter Compliance Matrix And Scorecard Onramp

Target: 2026-05-31

Acceptance:

- Adapter matrix covers Claude Code, Codex, OpenCode, Cursor, Gemini,
  Zed-adjacent surfaces, dmux, Orca, Superset, Ghast, and terminal-only use.
- Each adapter has supported assets, unsupported surfaces, install path,
  verification command, and risk notes.
- Harness audit remains 70/70 and gains a public onramp that explains how teams
  use the scorecard.
- Reference findings are converted into concrete adapter, observability, or
  operator-surface deltas.

### 3. Local Observability, HUD/Status, And Session Control Plane

Target: 2026-06-07

Acceptance:

- Observability readiness remains 21/21 and is backed by JSONL traces, status
  snapshots, risk ledger, and exportable handoff contracts.
- HUD/status model covers context, tool calls, active agents, todos, checks,
  cost, risk, and queue state.
- Worktree/session controls cover create, resume, status, stop, diff, PR,
  merge queue, and conflict queue.
- Linear/GitHub/handoff sync model is explicit enough for real-time progress
  tracking.

### 4. Self-Improving Harness Evaluation Loop

Target: 2026-06-10

Acceptance:

- Scenario specs, verifier contracts, traces, playbooks, and regression gates
  are documented and at least one read-only prototype exists.
- The loop separates observation, proposal, verification, and promotion.
- Team and individual setups can be scored and improved without blindly
  mutating configs.
- RAG/reference-set design covers vetted ECC patterns, team history, CI
  failures, diffs, review outcomes, and harness config quality.

### 5. AgentShield Enterprise Security Platform

Target: 2026-06-14

Acceptance:

- Formal policy schema and evaluation output exist for org baselines,
  exceptions, owners, expiration, severity, audit trails, expiring-soon
  visibility, and expired-exception enforcement.
- SARIF/code-scanning output is implemented and tested.
- GitHub Action policy gates expose organization policy status and violation
  counts for branch-protection and CI evidence.
- Policy packs are defined for OSS, team, enterprise, regulated, high-risk
  hooks/MCP, and CI enforcement.
- Supply-chain intelligence covers MCP package provenance and has an extension
  path for npm/pip reputation, CVEs, typosquats, and dependency risk.
- Prompt-injection corpus and regression benchmark are ready for continuous
  rule hardening with category-level coverage and regression-gate output.
- Enterprise reports include JSON plus self-contained HTML executive output
  with risk posture, priority findings, category exposure, and policy-exception
  lifecycle evidence in terminal/CI summaries.
- Native PDF export is not a GA blocker unless an enterprise/compliance
  workflow requires a generated PDF file instead of the self-contained HTML
  report and browser print-to-PDF path.

### 6. ECC Tools Billing, Deep Analysis, PR Checks, And Linear Sync

Target: 2026-06-21

Acceptance:

- Native GitHub Marketplace billing announcement is backed by verified
  implementation and docs.
- Internal billing readiness audit covers plan limits, seats, entitlement
  mapping, Marketplace plan shape, subscription state, overage hooks, and
  failure modes.
- Deep analyzer covers diff patterns, CI/CD workflows, dependency/security
  surface, PR review behavior, failure history, harness config, skill quality,
  dedicated analyzer corpus evidence, co-located analyzer reference sets,
  PR review/stale-salvage evidence, RAG/evaluator comparison, and reference-set
  validation.
- PR check suite taxonomy includes Security Evidence, Harness Drift, Install
  Manifest Integrity, CI/CD Recommendation, Cost/Token Risk, Reference Set
  Validation, Deep Analyzer Evidence, RAG/Evaluator Evidence,
  PR Review/Salvage Evidence, Skill Quality, and Agent Config Review.
- Evaluator/RAG billing readiness fixture
  `examples/evaluator-rag-prototype/billing-marketplace-readiness/` records the
  read-only claim-verification path for Marketplace, App, subscription, seat,
  entitlement, and plan language before launch copy can treat those claims as
  live.
- Cost/token-risk predictive follow-ups flag AI routing, model-call, usage,
  quota, and budget changes when budget evidence is missing.
- Reference-set validation follow-ups flag analyzer, skill, agent, command, and
  harness-guidance changes that lack eval, golden trace, benchmark, or
  maintained reference-set evidence.
- Deep-analyzer follow-ups flag repository, commit, architecture, pattern, and
  analysis-pipeline changes that lack analyzer corpus, snapshot, fixture, or
  benchmark evidence.
- Analyzer corpus evidence includes maintained fixtures and tests for current
  architecture and commit analyzer outputs, plus co-located
  `src/analyzers/{fixtures,goldens,reference-sets,benchmarks,evals}/` evidence
  paths.
- RAG/evaluator follow-ups flag retrieval, embedding, ranking, and evaluator
  changes that lack reference-set comparison, golden trace, benchmark, fixture,
  or eval-run evidence.
- Evaluator/RAG corpus contract mirrors the local prototype scenarios into
  ECC-Tools fixtures and tests for stale-PR salvage, billing readiness,
  CI failure diagnosis, harness config quality, AgentShield policy exceptions,
  skill-quality evidence, deep-analyzer evidence, and RAG/evaluator comparison.
- PR review/stale-salvage follow-ups flag review, triage, stale-closure, and
  pull-request automation changes that lack stale-salvage fixtures,
  reviewer-thread cases, or reopen-flow reference evidence.
- PR analysis comments summarize review follow-up signals for requested
  changes, unresolved or outdated review threads, and missing approvals.
- CI failure-mode predictive follow-ups flag workflow and test-runner changes
  that lack failure fixtures, captured logs, troubleshooting notes, dry-run
  evidence, or regression coverage.
- Harness-config quality predictive follow-ups flag MCP, plugin, agent, hook,
  command, and harness config changes that lack audit, adapter matrix,
  cross-harness doc, or compatibility regression evidence.
- Linear sync maps deferred backlog findings to Linear issues without flooding
  GitHub, creates or reuses exact-title Linear issues when configured, and
  reports skipped sync when credentials or team configuration are absent.
- Linear/project backlog sync includes copy-ready PR drafts when
  `/ecc-tools followups sync-linear` is used without `open-pr-drafts`, so
  stale-PR salvage work remains tracked without opening extra PR shells.
- Follow-up generation caps automatic GitHub object creation and keeps overflow
  findings in a copy-ready project sync backlog.

### 7. Legacy Audit And Stale-Work Salvage Closure

Target: 2026-06-15

Acceptance:

- Legacy directories and orphaned handoffs are inventoried.
- Each useful artifact is marked landed, Linear/project-tracked, salvage
  branch, or archive/no-action.
- Workspace-level legacy repos are mined only through sanitized maintainer
  branches; raw context, secrets, personal paths, local settings, and private
  drafts are never imported wholesale.
- Stale PR salvage policy stays in force: close stale/conflicted PRs first,
  record a salvage ledger item, then port useful compatible content on
  maintainer branches with attribution.
- #1687 localization leftovers are handled only by translator/manual review,
  not blind cherry-pick.

## Next Engineering Slices

1. Continue the AgentShield enterprise control-plane sequence from
   `docs/architecture/agentshield-enterprise-research-roadmap.md`: PR #63
   shipped GitHub Action baseline outputs and job-summary evidence; PR #64
   shipped first-class baseline snapshot creation through
   `agentshield baseline write`; PR #67 shipped the evidence-pack bundle; PR
   #68 hardened evidence-pack redaction; PR #69 shipped the multi-harness
   adapter registry; PR #78 hardened the release workflow for the current
   supply-chain incident class; PR #79 moved baseline/watch/remediation
   fingerprints to hashed evidence and stopped writing raw evidence into new
   baselines; PR #80 added prioritized corpus accuracy recommendations for
   failed regression gates; PR #81 added ordered remediation workflow phases;
   PR #82 expanded corpus coverage for env proxy hijacks and out-of-band
   exfiltration; PRs #83-#85 hardened Mini Shai-Hulud IOC coverage and
   release-path supply-chain verification; PR #86 added whitelisted
   `ci-context.json` workflow, commit, run, and runtime provenance to evidence
   packs; PR #87 classified installed Claude plugin caches separately from
   active top-level runtime config, including cached hook implementations; PR
   #88 added `agentshield evidence-pack inspect` JSON/text readback for
   downstream consumers; PR #89 added `agentshield evidence-pack fleet`
   summary/routing across multiple inspected bundles; ECC-Tools PRs #42/#43 now
   route and recognize evidence packs; ECC-Tools PR #76 consumes fleet
   summaries in hosted security review; ECC-Tools PR #77 surfaces source
   evidence paths in hosted PR comments and check-runs; ECC-Tools PR #78
   links AgentShield fleet target paths into hosted harness owner findings; and
   AgentShield PR #90 emits fleet `reviewItems` with source evidence paths and
   owner-ready recommendations; AgentShield PR #91 exports checksum-backed
   policy bundles for branch-protection review and downstream policy
   promotion; AgentShield PR #92 promotes checksum-verified policy bundles
   into active policy files with dry-run JSON review; AgentShield commit
   `87aec47` adds policy promotion `reviewItems` for digest evidence,
   owner-review, protected-rollout PR handoff, and runtime smoke testing;
   AgentShield commit `28d08c7` adds package-manager hardening drift detection;
   AgentShield commit `659f569` clears the action-runtime deprecation warnings
   with current SHA-pinned v6 actions; AgentShield commit `ee585cd` corrects
   npm release-age guidance so unsupported npm age keys are findings while
   enforceable cooldown findings stay on pnpm/Yarn; AgentShield commit
   `1124535` exposes package-manager hardening Action outputs for registry
   credentials, lifecycle-script drift, and release-age gate drift; and
   AgentShield commit `1593925` exposes policy-promotion Action outputs for
   owner approval, protected rollout, digest evidence, and runtime-smoke
   review items, ECC-Tools commit `8658951` consumes those outputs in hosted
   security review and Hosted Promotion Readiness scoring, and ECC-Tools
   commit `16c537f` renders promotion status, pack, review item count,
   remaining action count, and digest in hosted security comments/check-runs.
   AgentShield commit `840952a` adds Linear/operator-ready fleet review ticket
   payloads and expands current Mini Shai-Hulud IOC breadcrumbs, with green
   local and remote CI. AgentShield commit `4e36aab` hardens CI package installs
   after the expanded Mini Shai-Hulud refresh, with CI, Test GitHub Action,
   Self-Scan, and Dependabot Update workflows green.
   ECC-Tools commit `05d4e82` adds hosted promotion judge audit traces with
   deterministic request fingerprints and allowed-citation counts, without
   exposing raw provider output.
   ECC-Tools commit `91a441b` adds a billing announcement preflight command
   for checking Marketplace readback inputs before privileged API calls.
   ECC-Tools commit `2859678` requires Marketplace webhook provenance in
   billing-state before native-payments announcement readiness can pass.
   ECC-Tools commit `42653f9` adds Wrangler OAuth KV readback and confirms the
   current blocker is not Cloudflare read access; it is the absence of a
   ready-like Marketplace Pro billing-state record with webhook provenance.
   ECC-Tools commit `632e059` adds sanitized target-account readback, so the
   final operator gate should verify the exact Marketplace test account without
   printing its login or raw KV key names.
2. Run `npm run billing:announcement-gate -- --preflight --account
   <github-login>`, then run the same command without `--preflight` against a
   Marketplace-managed test account and require `announcementGate.ready ===
   true` before any native GitHub payments announcement.
3. Enable/configure the merged Linear backlog sync path after workspace issue
   capacity clears or the Linear workspace is upgraded, then verify PR-draft
   salvage items land in the expected project.
4. Use the ECC-Tools evaluator/RAG corpus as the promotion gate before adding
   deeper hosted retrieval, vector storage, or automated check-run promotion.
