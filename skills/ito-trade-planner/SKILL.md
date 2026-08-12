---
name: ito-trade-planner
description: Build a non-advisory prediction-market trade planning worksheet for Itô or venue workflows. Use to inspect venues, underliers, constraints, order prerequisites, and manual execution steps without placing trades or recommending positions.
metadata:
  origin: ECC
---

# Itô Trade Planner

Use this skill when a user wants a structured worksheet for a prediction-market
idea, basket adjustment, venue comparison, or manual execution plan.

The skill is intentionally non-executing. It produces indicative, non-executable
checklists and parameter tables the user can review manually.

## Guardrails

- Do not say a trade is good, bad, optimal, or recommended.
- Do not provide investment advice or position sizing advice.
- Do not place, cancel, route, or sign orders.
- Do not request private keys, seed phrases, exchange passwords, or wallet
  credentials.
- Require a separate workflow and explicit user approval before moving from
  research to execution-capable tooling. This approval does not authorize this
  skill to execute anything.
- If execution is requested, stop after the worksheet without invoking, calling,
  or opening an execution-capable tool or venue.

## Read-Only API And Authentication Boundary

The canonical developer surface is `https://itomarkets.com/api/v1`. Use only
authenticated `GET` endpoints requiring `baskets:read` or `markets:read`, either
with HTTPS and `Authorization: Bearer $ITO_API_KEY` or the official
`ito-markets` Python SDK. Trading is not part of this API.

On first use, check for an already configured key with exactly `baskets:read` and
`markets:read` without printing it. Least-privilege public keys use the `bkt_*`
form and are operator-issued; the dashboard's **Settings -> Keys & credentials**
flow issues a broader `ito_*` automation key. Do not create or rotate that broader
key merely to unblock this skill. If a scoped key is unavailable, report the
read-only API route as blocked and continue with clearly labeled public or user-
supplied inputs. Key issuance creates persistent access and needs confirmation in
the controlling harness. After the user or operator stores the one-time value
securely, return control to the originating agent and run one minimal
`GET /baskets` auth probe. This API does not use device authorization or device
login; do not invent a verification-code handoff.

The `ecc ito` bridge is a separate compute-procurement surface. Do not use
`ecc ito login`, `ecc ito find`, or its MCP tools for prediction-market data or
trade planning. Never print, log, persist, or place `ITO_API_KEY` in arguments,
reports, screenshots, tracked files, or chat. Retrieve only the minimum field at
runtime and keep it in process memory.

Mark API observations indicative. Use `GET /baskets`,
`GET /baskets/{basket_id}`, `GET /baskets/{basket_id}/price`,
`GET /baskets/{basket_id}/underlyers`, `GET /markets/search`, and
`GET /markets/{market_id}` as needed. Do not use write or backtest submission
endpoints for a trade-planning worksheet.

## Planning Workflow

1. Restate the user's idea as a neutral hypothesis.
2. Identify markets, venues, underliers, resolution rules, fees, and data
   freshness constraints.
3. If the user requested live Itô data, make the smallest authenticated read and
   record the endpoint URL and `retrieved_at` timestamp. Never infer a live price
   from stale, missing, or inaccessible data; use `unknown`.
4. Collect constraints without inventing values: jurisdiction/account
   eligibility, venue, market identifier, side (if the user supplied one),
   limit, time-in-force, maximum spend, fees, liquidity/slippage boundary,
   resolution rule, and decision deadline. Missing constraints remain `unknown`.
5. Run `prediction-market-risk-review` before discussing automation, keys,
   venue auth, capital constraints, or a manual action link.
6. Build a manual worksheet:
   - market/underlier
   - venue
   - data source
   - current observable price or status
   - resolution rule
   - liquidity caveat
   - open questions
   - manual action link or next review step
7. If the user asks to continue toward execution, list the unresolved gates and
   request separate explicit confirmation in the future execution-capable
   workflow. Do not treat confirmation given during planning as an order.

## Recovery And Failure States

- On `401`, set `plan_status: blocked` and ask the user to inspect or replace the
  key in Settings. On `403`, report the missing read scope; never request a write
  scope for this skill. Redact any credential-like text.
- On `429`, honor `Retry-After` once within the user's time budget. Do not loop or
  exceed the documented read budget of 120 requests per minute.
- On timeout or ambiguous transport failure, set affected values to `unknown`.
  Retry at most once for a read; never turn a read failure into a write.
- On expired or revoked access, stop, redact server details that could contain
  credentials, and direct the user to Settings. Never weaken scopes or reuse
  cached secrets.
- Public and private sources must be labeled separately. Do not present cached
  or fixture data as live behavior.

## Allowed Language

Use:

- "manual planning worksheet"
- "questions to answer before acting"
- "observable venue data"
- "risk and constraint review"

Avoid:

- "you should buy/sell"
- "best trade"
- "guaranteed"
- "risk-free"
- "optimal size"

## Structured Output Contract

Return this shape in Markdown or YAML. Preserve `unknown` rather than guessing.

```yaml
plan_status: ready_for_manual_review | blocked
mode: indicative_non_executable
hypothesis: "neutral restatement"
markets:
  - market: "identifier or unknown"
    venue: "venue or unknown"
    observable_status: "value or unknown"
    source_url: "source URL or unknown"
    retrieved_at: "ISO-8601 timestamp or unknown"
    resolution_rule: "summary or unknown"
    liquidity_caveat: "text or unknown"
constraints:
  jurisdiction_eligibility: "confirmed | unconfirmed | unknown"
  limit: "user supplied value or unknown"
  maximum_spend: "user supplied value or unknown"
  fees: "value or unknown"
  decision_deadline: "value or unknown"
data_freshness: "timestamp and caveats"
risk_review:
  status: pass | warn | fail | not_run
  findings: []
blocked_actions:
  - "order placement, cancellation, routing, signing, and submission"
next_safe_step: "one non-executing review action"
```

End every plan with exactly:

```text
This is a planning worksheet, not investment or trading advice. Review venue
rules and make any trading decisions yourself.
```
