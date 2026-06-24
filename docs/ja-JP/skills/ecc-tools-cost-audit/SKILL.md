---
name: ecc-tools-cost-audit
description: ECC ツール、エージェント、スキル、および実装のコスト監査を実施します。プロンプト入力トークンを分析して、計算効率を定量化します。
origin: ECC
---

# ECC Tools Cost Audit

Use this skill when the user suspects the ECC Tools GitHub App is burning cost, over-creating PRs, bypassing usage limits, or routing free users into premium analysis paths.

This is a focused operator workflow for the sibling [ECC-Tools](../../ECC-Tools) repo. It is not a generic billing skill and it is not a repo-wide code review pass.

## Skill Stack

Pull these ECC-native skills into the workflow when relevant:

- `autonomous-loops` for bounded multi-step audits that cross webhooks, queues, billing, and retries
- `agentic-engineering` for tracing the request path into discrete, provable units
- `customer-billing-ops` when repo behavior and customer-impact math must be separated cleanly
- `search-first` before inventing helpers or re-implementing repo-local utilities
- `security-review` when auth, usage gates, entitlements, or secrets are touched
- `verification-loop` for proving rerun safety and exact post-fix state
- `tdd-workflow` when the fix needs regression coverage in the worker, router, or billing paths

## When To Use

- user says ECC Tools burn rate, PR recursion, over-created PRs, usage-limit bypass, or premium-model leakage
- the task is in the sibling `ECC-Tools` repo and depends on webhook handlers, queue workers, usage reservation, PR creation logic, or paid-gate enforcement
- a customer report says the app created too many PRs, billed incorrectly, or analyzed code without producing a usable result

## Scope Guardrails

- work in the sibling `ECC-Tools` repo, not in `everything-claude-code`
- start read-only unless the user clearly asked for a fix
- do not mutate unrelated billing, checkout, or UI flows while tracing analysis burn
- treat app-generated branches and app-generated PRs as red-flag recursion paths until proved otherwise
- separate three things explicitly:
  - repo-side burn root cause
  - customer-facing billing impact
  - product or entitlement gaps that need backlog follow-up

## Workflow

### 1. Freeze repo scope

- switch into the sibling `ECC-Tools` repo
- check branch and local diff first
- identify the exact surface under audit:
  - webhook router
  - queue producer
  - queue consumer
  - PR creation path
  - usage reservation / billing path
  - model routing path

### 2. Trace ingress before theorizing

- inspect `src/index.*` or the main entrypoint first
- map every enqueue path before suggesting a fix
- confirm which GitHub events share a queue type
- confirm whether push, pull_request, synchronize, comment, or manual re-run events can converge on the same expensive path

### 3. Trace the worker and side effects

- inspect the queue consumer or scheduled worker that handles analysis
- confirm whether a queued analysis always ends in:
  - PR creation
  - branch creation
  - file updates
  - premium model calls
  - usage increments
- if analysis can spend tokens and then fail before output is persisted, classify it as burn-with-broken-output

### 4. Audit the high-signal burn paths

#### PR multiplication

- inspect PR helpers and branch naming
- check dedupe, synchronize-event handling, and existing-PR reuse
- if app-generated branches can re-enter analysis, treat that as a priority-0 recursion risk

#### Quota bypass

- inspect where quota is checked versus where usage is reserved or incremented
- if quota is checked before enqueue but usage is charged only inside the worker, treat concurrent front-door passes as a real race

#### Premium-model leakage

- inspect model selection, tier branching, and provider routing
- verify whether free or capped users can still hit premium analyzers when premium keys are present

#### Retry burn

- inspect retry loops, duplicate queue jobs, and deterministic failure reruns
- if the same non-transient error can spend analysis repeatedly, fix that before quality improvements

### 5. Fix in burn order

If the user asked for code changes, prioritize fixes in this order:

1. stop automatic PR multiplication
2. stop quota bypass
3. stop premium leakage
4. stop duplicate-job fanout and pointless retries
5. close rerun/update safety gaps

Keep the pass bounded to one to three direct fixes unless the same root cause clearly spans multiple files.

### 6. Verify with the smallest proving steps

- rerun only the targeted tests or integration slices that cover the changed path
- verify whether the burn path is now:
  - blocked
  - deduped
  - downgraded to cheaper analysis
  - or rejected early
- state the final status exactly:
  - changed locally
  - verified locally
  - pushed
  - deployed
  - still blocked

## High-Signal Failure Patterns

### 1. One queue type for all triggers

If pushes, PR syncs, and manual audits all enqueue the same job and the worker always creates a PR, analysis equals PR spam.

### 2. Post-enqueue usage reservation

If usage is checked at the front door but only incremented in the worker, concurrent requests can all pass the gate and exceed quota.

### 3. Free tier on premium path

If free queued jobs can still route into Anthropic or another premium provider when keys exist, that is real spend leakage even if the user never sees the premium result.

### 4. App-generated branches re-enter the webhook

If `pull_request.synchronize`, branch pushes, or comment-triggered runs fire on app-owned branches, the app can recursively analyze its own output.

### 5. Expensive work before persistence safety

If the system can spend tokens and then fail on PR creation, file update, or branch collision, it is burning cost without shipping value.

## Pitfalls

- do not begin with broad repo wandering; settle webhook -> queue -> worker first
- do not mix customer billing inference with code-backed product truth
- do not fix lower-value quality issues before the highest-burn path is contained
- do not claim burn is fixed until the narrow proving step was rerun
- do not push or deploy unless the user asked
- do not touch unrelated repo-local changes if they are already in progress

## Verification

- root causes cite exact file paths and code areas
- fixes are ordered by burn impact, not code neatness
- proving commands are named
- final status distinguishes local change, verification, push, and deployment
