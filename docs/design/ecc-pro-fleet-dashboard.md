# ECC Pro: Hosted Multi-Repo Agent Security Posture Dashboard

> Status: draft design for review. Produced 2026-06-21 by an architecture agent grounded
> in the existing ecc-agentshield primitives. Proposes the hosted ECC Pro surface; does not
> implement it. Companion to docs/ECC-PRO-SECURITY-ROADMAP.md (the "next" flagship item).

## 1. Title, Thesis, and Wedge

ECC Pro is a hosted, authenticated, multi-repo "Sentry for agent security" surface built on top of the existing `ecc-agentshield` local CLI primitives. AgentShield already does ~30K npm downloads/month with near-zero monetization. The thesis: the continuous and fleet primitives that make a hosted product valuable already exist as local CLI building blocks (evidence packs with `bundleDigest` integrity, `operatorReadback`/`reviewItems` promotion routing, `fs.watch` drift detection, NDJSON runtime allow/block logging, baseline diffing, and policy promotion gates). The fastest path to MRR is not new science; it is hosting these primitives as authenticated multi-repo and multi-org surfaces and unifying config-scan posture with runtime telemetry over time.

The wedge: Snyk and similar SCA tools are scan-only and have no concept of agent-runtime semantics (no PreToolUse deny decisions, no MCP/hook/agent injection model, no drift-over-time on agent config). Sentry has time-series and alerting but zero security semantics; it does not know what a hardcoded `sk-ant-` key, a `Bash(*)` allow rule, or an `autoApprove` MCP server is. CodeRabbit reviews PR diffs but is point-in-time and has no fleet posture rollup or runtime block-rate trend. ECC Pro is the only surface that charts `score` trend, `drift` history, `blocked-command` rate, and `injection-attempt` rate across a fleet of repos, anchored on a security-specific rule engine (102 rules across secrets/permissions/hooks/mcp/agents) that nobody else has. AgentShield was featured at the Cerebral Valley x Anthropic Claude Code Hackathon (Feb 2026); the hosted surface is the commercial extension of that featured tooling.

## 2. Scope: Free Local-First vs Pro Hosted

The free local-first scanner stays the moat. We never paywall the scanner itself; we monetize hosting, history, and multi-repo aggregation. Local-first capability is also what produces the redacted, integrity-checked artifacts the hosted product ingests, so a strong free tier directly grows the funnel.

Free, zero-account, local-only (unchanged, MIT):
- `agentshield scan` and all 102 rules, `--format terminal|json|markdown|html|sarif`.
- `--fix`, `agentshield init`, `--opus` deep analysis (user supplies their own `ANTHROPIC_API_KEY`).
- `--evidence-pack <dir>`, `evidence-pack verify|inspect|fleet` (local fleet routing stays free).
- `--baseline`, `--save-baseline`, `agentshield baseline write`, `--gate`.
- `agentshield runtime install|status|repair`, local `runtime.ndjson` logging.
- `agentshield policy init|export|promote`, all 6 policy packs (`oss`, `team`, `enterprise`, `regulated`, `high-risk-hooks-mcp`, `ci-enforcement`).
- Local `agentshield watch` (fs.watch drift, terminal/webhook alerts).
- GitHub Action `affaan-m/agentshield@v1` (CI scanning, SARIF upload, baseline gate).
- MiniClaw local server.

Pro, hosted, account-required (the recurring-revenue surface):
- Persisted history: every scan/baseline/drift/runtime event retained and charted over time (free CLI is point-in-time and stateless on the local box).
- Multi-repo and org rollup: cross-repo posture, fleet `operatorReadback` aggregation, org-level score trend.
- Authenticated ingestion endpoints for CI scan results, `runtime.ndjson` streaming, and watch/drift events.
- Hosted dashboard frontend (posture, drift timeline, blocked-command rate, injection-attempt rate, secret-exposure events).
- Hosted alerting and routing: turn `reviewItems` into assignable tickets, deliver to Slack/Linear/GitHub via the ecc-tools GitHub App.
- RBAC, audit log, retention/compliance, SSO (Enterprise).
- Hosted policy promotion gate: org-level promotion approval workflow on top of `policy promote` `reviewItems`.

The hard line: anything that runs against local files and produces a redacted artifact stays free. Anything that stores, aggregates, charts, or routes across repos/time/people is Pro. We never require an account to find a vulnerability; we require one to track a fleet of them over time.

## 3. Architecture

The hosted backend is a thin, stateless ingestion and query layer over the existing artifact shapes. The CLI/Action/App remain the producers; the backend never re-implements scanning. It receives already-redacted artifacts (the CLI redacts paths/usernames/emails/tokens by default in `createRedactor`/`buildReplacements`) and persists summaries plus time-series rollups.

Component diagram (ASCII):

```
  PRODUCERS (free, local-first, already redacted)
  +-----------------------+   +------------------------+   +-------------------------+
  | GitHub Action          |   | agentshield watch       |   | runtime PreToolUse hook |
  | (CI scan + evidence    |   | (fs.watch, diffBaseline,|   | (evaluateToolCall ->    |
  |  pack, SARIF, baseline)|   |  DriftResult, webhook)  |   |  runtime.ndjson)        |
  +-----------+-----------+   +-----------+------------+   +-----------+-------------+
              |                            |                            |
              | POST evidence-pack         | POST drift event           | POST/stream ndjson batch
              | summary + manifest digest  | (DriftResult)              | (RuntimeLogEntry[])
              v                            v                            v
  +-----------------------------------------------------------------------------------+
  | INGESTION GATEWAY (stateless, authenticated)                                       |
  |  - API token auth + org/repo identity resolution                                   |
  |  - schema validation (Zod, reuse SecurityReport / DriftResult / RuntimeLogEntry)   |
  |  - bundleDigest re-verification, idempotency on digest                             |
  |  - reject-if-not-redacted guard (manifest.redacted must be true for hosted)        |
  +-----------------------------------+-----------------------------------------------+
                                      |
                 +--------------------+--------------------+
                 v                                         v
  +-----------------------------+              +-------------------------------+
  | PRIMARY STORE (Postgres)     |              | TIME-SERIES ROLLUP STORE       |
  |  org, repo, scan, baseline,  |              |  score_trend, drift_history,   |
  |  finding, runtime_event,     |  rollup job  |  blocked_cmd_rate,             |
  |  drift_event, policy_eval,   |------------->|  injection_rate, secret_events |
  |  evidence_pack, review_item  |              |  (Postgres time buckets or     |
  +--------------+--------------+              |   ClickHouse for high-volume    |
                 |                              |   runtime ndjson)               |
                 |                              +---------------+----------------+
                 |                                              |
                 v                                              v
  +-----------------------------------------------------------------------------------+
  | QUERY API (authenticated, RBAC-filtered, multi-tenant isolated by org_id)          |
  +-----------------------------------+-----------------------------------------------+
                                      |
                                      v
  +-----------------------------+        +-------------------------------------------+
  | DASHBOARD FRONTEND (Next.js) |        | ROUTING/ALERTS (ecc-tools GitHub App,      |
  |  posture, trends, drift, fleet|        |  Slack/Linear) from reviewItems + tickets  |
  +-----------------------------+        +-------------------------------------------+
```

Ingestion sources and their existing producers:
- CI scan results: GitHub Action already emits the full `SecurityReport` JSON, SARIF, and an evidence pack with `manifest.json` (`bundleDigest`, per-artifact `sha256`/`bytes`) plus `ci-context.json` (`EvidencePackGitHubContext`: `repository`, `sha`, `runId`, `workflow`, `ref`, `actor`). The Action gets a new optional input `ecc-pro-ingest-url` + token; on success it POSTs the inspected pack summary (`EvidencePackInspectionResult`) and the manifest digest.
- Runtime telemetry: the PreToolUse hook (`evaluateToolCall` -> `logEvalResult`) writes `RuntimeLogEntry` lines to `.agentshield/runtime.ndjson`. A small `agentshield runtime ship` command (Pro) tails and batch-POSTs new NDJSON lines.
- Watch/drift events: `startWatcher` already computes `DriftResult` and calls `dispatchAlert`. We add a `webhook` alert target that points at the hosted ingest endpoint; the existing `formatWebhookPayload` carries `newFindings`, `resolvedFindings`, `scoreDelta`, `isRegression`, `hasCritical`.

Storage choice: Postgres (Supabase) for the relational entities and most rollups; ClickHouse only if runtime NDJSON volume per org makes per-row retention in Postgres uneconomical (runtime events are append-only and high-cardinality, which is the ClickHouse sweet spot). Default MVP is Postgres-only.

## 4. API Contract

All endpoints are authenticated with an org-scoped API token (header `Authorization: Bearer eccp_...`). Request/response shapes reuse the real field names from the CLI so the producers do not need a translation layer. Ingestion is idempotent keyed on `bundleDigest` (scans) or `(repo_id, timestamp, tool, decision)` hash (runtime).

### 4.1 Ingest a scan / evidence pack summary

`POST /v1/ingest/scan`

The body is the existing `EvidencePackInspectionResult` plus the `ci-context` summary. The backend never asks for raw evidence; it consumes the already-computed inspection summary so it can re-derive the same rollups the local `evidence-pack inspect` produces.

Request:
```json
{
  "repository": "acme/agent-platform",
  "bundleDigest": "sha256:9f2c...e1",
  "expectedBundleDigest": "sha256:9f2c...e1",
  "generatedAt": "2026-06-21T17:42:00.000Z",
  "redacted": true,
  "report": {
    "score": { "grade": "C", "numericScore": 66 },
    "findings": { "total": 29, "critical": 1, "high": 7, "medium": 8, "low": 10, "info": 3 },
    "runtimeConfidence": { "active-runtime": 11, "template-example": 14, "project-local-optional": 4 }
  },
  "policy": { "status": "failed", "policyPack": "enterprise", "violations": 3 },
  "baseline": { "status": "regressed", "newFindings": 4, "resolvedFindings": 1, "scoreDelta": -8 },
  "supplyChain": { "totalPackages": 22, "riskyPackages": 2, "criticalCount": 0, "highCount": 1 },
  "ciContext": {
    "provider": "github-actions",
    "repository": "acme/agent-platform",
    "workflow": "security.yml",
    "runId": "1182334455",
    "sha": "4c1d9ab"
  },
  "remediation": { "totalFindings": 29, "autoFixable": 2, "manualReview": 7 }
}
```

Response:
```json
{
  "ok": true,
  "scanId": "scan_01J...",
  "repoId": "repo_01H...",
  "ingestedAt": "2026-06-21T17:42:03.114Z",
  "deduped": false,
  "rollupsUpdated": ["score_trend", "drift_history", "secret_exposure_events"]
}
```

Server-side guards: reject with `422` if `redacted !== true` (hosted tenants must never store unredacted bundles), and reject with `409 deduped` echo if `bundleDigest` already ingested for that repo. If `expectedBundleDigest` is present and differs from `bundleDigest`, mark `integrity: "mismatch"` on the stored scan.

### 4.2 Ingest runtime telemetry batch

`POST /v1/ingest/runtime`

Body is an array of the existing `RuntimeLogEntry` shape from `src/runtime/types.ts`.

Request:
```json
{
  "repository": "acme/agent-platform",
  "sessionId": "sess_4f8a",
  "entries": [
    { "timestamp": "2026-06-21T17:50:01.002Z", "tool": "Bash", "decision": "block", "reason": "Input matches denied pattern \"rm -rf\"", "durationMs": 2 },
    { "timestamp": "2026-06-21T17:50:02.114Z", "tool": "Read", "decision": "allow", "durationMs": 1 }
  ]
}
```

Response:
```json
{ "ok": true, "accepted": 2, "blocked": 1, "allowed": 1, "rollupsUpdated": ["blocked_command_rate"] }
```

Note: `RuntimeLogEntry` already carries no raw input payload (only `tool`, `decision`, `reason`, `durationMs`), so runtime ingestion is safe-by-construction. We keep it that way; the hosted API must not add a raw-input field.

### 4.3 Ingest a drift event

`POST /v1/ingest/drift`

Body is the existing `DriftResult` from `src/watch/types.ts` (already what `formatWebhookPayload` emits).

Request:
```json
{
  "repository": "acme/agent-platform",
  "timestamp": "2026-06-21T18:01:10.000Z",
  "newFindings": [ { "id": "secrets-hardcoded-anthropic", "severity": "critical", "category": "secrets", "title": "Hardcoded Anthropic API key", "file": "<target-path>/CLAUDE.md" } ],
  "resolvedFindings": [],
  "scoreDelta": -25,
  "previousScore": 66,
  "currentScore": 41,
  "isRegression": true,
  "hasCritical": true
}
```

Response:
```json
{ "ok": true, "driftEventId": "drift_01J...", "alertRouted": true }
```

### 4.4 Query: org fleet rollup

`GET /v1/org/{orgId}/fleet`

Response reuses the `EvidencePackFleetInspectionResult` `operatorReadback` shape so the dashboard and the existing `evidence-pack fleet` consumers share one contract:
```json
{
  "ok": false,
  "requiresAttention": true,
  "summary": { "totalPacks": 12, "verifiedPacks": 11, "invalidPacks": 1, "critical": 2, "high": 9, "policyFailures": 3, "baselineRegressions": 2, "riskyPackages": 5 },
  "operatorReadback": {
    "status": "blocked",
    "ready": false,
    "requiresApproval": true,
    "digest": "sha256:aa17...",
    "reviewItemCount": 5,
    "blockingItemCount": 2,
    "ownerCount": 3,
    "owners": ["acme/agent-platform security owner"],
    "routesRequiringApproval": ["policy-review", "security-blocker"],
    "approvalIds": ["agsr_2b1c8f0d9e7a4c11"],
    "nextAction": "Route review items to listed owners and attach approval before promotion."
  }
}
```

### 4.5 Query: per-repo posture and trend

`GET /v1/repo/{repoId}/posture?from=...&to=...&bucket=day`
Returns `score_trend`, latest `EvidencePackInspectionResult`, latest `DriftResult`, and runtime rollups for the window.

### 4.6 Query: review items (routing)

`GET /v1/repo/{repoId}/review-items`
Returns the existing `EvidencePackFleetReviewItem[]` (route, severity, priority, `approvalId`, `owner`, `evidencePaths`, `beforeState`, `afterState`, `reversibleAction`, `actions`, `recommendation`, and the Linear-friendly `ticket.externalId`). These map one-to-one to assignable hosted tickets; no new schema needed.

## 5. Data Model

Persisted relational entities (Postgres). All carry `org_id` for tenant isolation; all timestamps are ISO-8601 UTC.

- `org`: `id`, `name`, `github_org_login`, `plan` (`team` | `enterprise`), `created_at`, `sso_enabled`.
- `repo`: `id`, `org_id`, `full_name` (e.g. `acme/agent-platform`), `github_repo_id` (from `EvidencePackGitHubContext.repositoryId`), `default_provider` (`github-actions` | `local`), `created_at`.
- `scan`: `id`, `repo_id`, `bundle_digest` (unique per repo, idempotency key), `generated_at`, `redacted`, `grade`, `numeric_score`, `score_breakdown` (jsonb: secrets/permissions/hooks/mcp/agents), `total_findings`, `critical/high/medium/low/info`, `provider`, `ci_sha`, `ci_run_id`, `ci_workflow`, `integrity` (`ok` | `mismatch`).
- `finding`: `id`, `scan_id`, `finding_key` (the `Finding.id`, e.g. `mcp-risky-filesystem`), `severity`, `category` (`FindingCategory`), `title`, `file` (already redacted to `<target-path>` form), `runtime_confidence` (`RuntimeConfidence`), `fingerprint` (reuse `fingerprintFinding` so the same finding across scans collapses to one timeline). Never store `evidence` raw for hosted; store only the redacted `file` and `title`.
- `baseline`: `id`, `repo_id`, `baseline_timestamp`, `numeric_score`, `finding_count`, `source_scan_id`. Mirrors `SerializedBaseline` (`version`, `timestamp`, `score`, `findings` with `fingerprint`).
- `baseline_comparison`: `id`, `repo_id`, `scan_id`, `is_regression`, `new_findings_count`, `resolved_findings_count`, `unchanged_count`, `score_delta`, `new_critical_count`, `new_high_count` (the `BaselineComparison` shape).
- `runtime_event`: `id`, `repo_id`, `session_id`, `timestamp`, `tool`, `decision` (`allow` | `block`), `reason`, `duration_ms` (the `RuntimeLogEntry` shape; high-volume, candidate for ClickHouse).
- `drift_event`: `id`, `repo_id`, `timestamp`, `score_delta`, `previous_score`, `current_score`, `is_regression`, `has_critical`, `new_findings` (jsonb summary), `resolved_findings` (jsonb summary) (the `DriftResult` shape).
- `policy_eval`: `id`, `scan_id`, `policy_name`, `policy_pack` (`PolicyPack`), `passed`, `violation_count`, `score`, `min_score`, `exception_summary` (jsonb: `total`/`active`/`expiringSoon`/`expired` from `PolicyExceptionSummary`). Mirrors `PolicyEvaluation`.
- `evidence_pack`: `id`, `scan_id`, `bundle_digest`, `expected_bundle_digest`, `artifact_count`, `verified_artifact_count`, `redacted`, `generated_at`. Mirrors `EvidencePackInspectionResult`.
- `review_item`: `id`, `repo_id`, `approval_id` (the `agsr_...` id), `route` (`EvidencePackFleetRoute`), `severity`, `priority`, `owner`, `recommendation`, `ticket_external_id`, `status` (`open` | `approved` | `dismissed`), `assignee`. Mirrors `EvidencePackFleetReviewItem`.

Time-series rollups to chart (materialized from the entities above, bucketed by hour/day/week):
- `score_trend`: per repo and org-aggregate `numeric_score` and `grade` over time (from `scan.numeric_score`). The headline chart.
- `drift_history`: count and severity of `drift_event` regressions over time, with `score_delta` band. Answers "is this repo's agent posture decaying?".
- `blocked_command_rate`: `runtime_event` where `decision = block` over total, per tool, over time. The "Sentry-style" live signal nobody else has.
- `injection_attempt_rate`: count of blocked runtime events whose `reason` matches injection deny patterns, plus scan findings with `category = injection`, over time.
- `secret_exposure_events`: timeline of `finding` rows with `category = secrets` and `severity = critical` (e.g. `secrets-hardcoded-*`), de-duplicated by `fingerprint`, so a recurring committed key shows as one persistent event until resolved.
- `cross_repo_org_rollup`: org-level fold of `score_trend`, open `review_item` count by `route`, `policyFailures`, and `baselineRegressions` (the `EvidencePackFleetSummary` fields), feeding the `operatorReadback.status` badge at org scope.

## 6. Auth Model

Identity and tenancy:
- Org is the top-level tenant, anchored to a GitHub org login (the ecc-tools GitHub App install scope is the natural onboarding boundary). `repo` rows are children of exactly one `org`; `github_repo_id` from `EvidencePackGitHubContext.repositoryId` is the stable external key.
- Multi-tenant isolation: every row carries `org_id`. On Supabase Postgres, enforce Row Level Security so every query is filtered by the caller's `org_id`; the query API never accepts a client-supplied `org_id` that is not in the caller's token claims. No cross-org joins exist in any query path.

API tokens:
- Org-scoped ingestion tokens (`eccp_...`) are minted per org and optionally per repo. Tokens are hashed at rest (store only a SHA-256 of the token, never the token), shown once on creation. CI uses a repo-scoped token in GitHub Actions secrets; runtime/watch shippers use the same.
- Tokens have a `scope` (`ingest:scan`, `ingest:runtime`, `ingest:drift`, `read`) so a CI token cannot read the dashboard API and a read token cannot write.

RBAC tiers (per org):
- `owner`: billing, SSO config, token management, member management, policy promotion approval.
- `admin`: token management, review-item assignment, alert routing config.
- `member`: view all posture, assign review items to self, comment.
- `viewer`: read-only posture and trends (auditor / buyer-review persona).

Prohibited handling (hard requirements, enforced server-side):
- Never store raw secrets. The CLI already redacts paths, usernames, emails, and token-shaped strings by default via `createRedactor`/`buildReplacements` (covers `sk-`, `gh*_`, `github_pat_`, `glpat-`, `npm_`, `AKIA`, JWT `eyJ...`, Slack tokens, emails, etc.). The ingestion gateway must reject any scan payload where `manifest.redacted` / `redacted` is not `true`. Preserve redaction end-to-end; the hosted store only ever holds the `<redacted-token>` / `<target-path>` / `<home>` / `<user>` forms.
- `runtime_event` ingestion accepts only the `RuntimeLogEntry` fields (`tool`, `decision`, `reason`, `durationMs`); it must not accept raw tool `input`. The local `ToolCall.input` stays local.
- Remediation plans and baselines already omit raw evidence and before/after token-shaped strings; preserve that omission in the hosted projection. Findings stored hosted carry redacted `file` + `title` + `fingerprint` only, never raw `evidence`.
- Audit log: every token mint/revoke, review-item state change, and policy promotion approval is appended to an immutable per-org audit trail (defense-in-depth, least-privilege, secure-by-default).

## 7. MVP vs v2 vs v3 (Build Order)

MVP (smallest shippable Pro v1) -- "history + multi-repo posture for CI scans":
1. Org/repo model, GitHub App (ecc-tools) install -> org/repo provisioning, org-scoped ingest tokens with RLS isolation.
2. `POST /v1/ingest/scan` consuming `EvidencePackInspectionResult` + `ci-context`; persist `scan`, `finding`, `evidence_pack`, `policy_eval`, `baseline_comparison`; idempotent on `bundleDigest`; reject-if-not-redacted guard.
3. GitHub Action gets `ecc-pro-ingest-url` + token inputs; on scan it POSTs the inspected summary.
4. Dashboard v1: `score_trend` chart, per-repo finding table (severity + `runtimeConfidence` filter), org fleet table reusing `operatorReadback.status`.
5. Stripe billing, Team plan ($19/seat/mo per the existing ecc-tools Pro listing), per-org token quota.

This is shippable because it only stitches existing artifacts to storage + a chart. No new scanning logic.

v2 -- "runtime telemetry + drift over time + routing":
6. `POST /v1/ingest/runtime` + `agentshield runtime ship` shipper; `runtime_event` store; `blocked_command_rate` and `injection_attempt_rate` charts.
7. `POST /v1/ingest/drift` + `watch` webhook target -> hosted; `drift_history` chart; `secret_exposure_events` timeline.
8. `review_item` ingestion + assignable tickets, alert routing to Slack/Linear/GitHub via ecc-tools App, reusing `approvalId` and `ticket.externalId` for dedupe.

v3 -- "Enterprise governance":
9. Hosted policy promotion gate: org approval workflow on top of `policy promote` `reviewItems`; required approvals before `operatorReadback.ready`.
10. SSO/SAML, custom retention, audit-log export, per-org data residency; ClickHouse migration for runtime events if volume warrants.

## 8. Pricing and Packaging Hooks

- Team ($19/seat/mo, matches the current ecc-tools Pro listing): per-seat billing; included repo cap (e.g. 25 repos); 90-day history retention; scan + drift ingestion; Slack/GitHub routing; standard RBAC (owner/admin/member/viewer).
- Enterprise (per-repo or platform-fee, sales-assisted): metered by `repo` count rather than seats because security platform value scales with fleet size, not headcount; unlimited seats; SSO/SAML; unlimited retention + audit-log export; hosted policy promotion approval gate; `regulated`/`enterprise` policy packs with required-approval enforcement; data residency.

Gating levers (what flips Team -> Enterprise): runtime telemetry retention window, number of repos under management, SSO requirement, policy-promotion approval workflow, audit-log export, and `routesRequiringApproval` enforcement (Enterprise can require that `operatorReadback.requiresApproval` blocks promotion; Team only surfaces it). Per-seat captures small teams; per-repo captures the platform-team buyer whose value is fleet breadth.

## 9. Risks and Open Questions

Risks:
- Cannibalization: a too-generous hosted free tier could erode the local moat, or a too-aggressive paywall could stall the 30K/mo funnel. Mitigation: never paywall detection; only paywall persistence/aggregation/routing.
- Redaction trust boundary: the hosted product's entire safety story depends on the CLI redactor being complete. A new token format the regex set misses would be ingested unredacted. Mitigation: reject-if-not-redacted is necessary but not sufficient; add a server-side secondary redaction pass over inbound `title`/`file`/`reason` strings as defense-in-depth, and keep `buildReplacements` patterns under test.
- Runtime volume economics: `runtime.ndjson` can be high-cardinality per active agent; Postgres retention could get expensive. Mitigation: pre-aggregate to `blocked_command_rate` rollups on ingest and retain raw `runtime_event` only for the plan's window (ClickHouse for Enterprise).
- Idempotency edge: `bundleDigest` excludes `manifest.json` and `README.md` (`BUNDLE_DIGEST_EXCLUDED_FILES`), so two scans with identical findings but different `generatedAt` produce the same digest. That is correct for dedupe but means we must key the time-series on `generatedAt`/`ci_run_id`, not on digest alone.

Open questions:
- Should drift/runtime ingestion from purely local `watch`/runtime (no CI, `provider: "local"`) be allowed for Pro, given there is no GitHub-verifiable repo identity? Proposal: allow it but tag `provider: local` and require a repo-scoped token bound at mint time to a `full_name`.
- Do we attribute runtime events to a GitHub identity (`ci-context.actor`) for per-developer block-rate, or keep them repo-anonymous for privacy? Leaning repo-anonymous by default with opt-in actor attribution.
- Is org identity strictly GitHub-org-bound, or do we need a GitHub-independent org for GitLab/local-only users in v2? MVP is GitHub-org-bound via the ecc-tools App.
- For the `injection_attempt_rate` chart, do we trust runtime `reason` string matching, or do we need a structured `matchedRule` field shipped from `EvalResult` (which has `matchedRule`) instead of only `RuntimeLogEntry` (which drops it)? Proposal: extend the runtime shipper to include `matchedRule` so injection attribution is structured, not string-parsed.

Relevant grounding files (all absolute):
- `agentshield/src/evidence-pack/index.ts` (`EvidencePackInspectionResult`, `EvidencePackFleetOperatorReadback`, `EvidencePackFleetReviewItem`, `bundleDigest`, `BUNDLE_DIGEST_EXCLUDED_FILES`, `createRedactor`, `buildReplacements`)
- `agentshield/src/runtime/types.ts` (`RuntimeLogEntry`, `EvalResult`, `RuntimePolicy`) and `agentshield/src/runtime/evaluator.ts` (`evaluateToolCall`, `logEvalResult`)
- `agentshield/src/watch/types.ts` (`DriftResult`, `WatchConfig`) and `agentshield/src/watch/index.ts` (`formatWebhookPayload`, `dispatchAlert`)
- `agentshield/src/baseline/types.ts` (`SerializedBaseline`, `SerializedFinding`, `BaselineComparison`) and `agentshield/src/baseline/index.ts` (`fingerprintFinding`)
- `agentshield/src/policy/types.ts` (`PolicyEvaluation`, `PolicyPack`, `PolicyExceptionSummary`)
- `agentshield/src/types.ts` (`Finding`, `RuntimeConfidence`, `FindingCategory`, `SecurityReport`, `SecurityScore`)
- `agentshield/README.md` (GitHub Action inputs/outputs, ecc-tools GitHub App, `ecc-agentshield` npm, ECC Tools Pro $19/seat/mo)
