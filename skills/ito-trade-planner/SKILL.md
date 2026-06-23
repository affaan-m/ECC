---
name: ito-trade-planner
description: Build a non-advisory prediction-market trade planning worksheet for Itô or venue workflows. Use to inspect venues, underliers, constraints, order prerequisites, and manual execution steps without placing trades or recommending positions.
metadata:
  origin: ECC
---

# Itô Trade Planner

Use this skill when a user wants a structured worksheet for a prediction-market
idea, basket adjustment, venue comparison, or manual execution plan.

The skill is intentionally non-executing. It produces checklists and parameter
tables the user can review manually.

## Guardrails

- Do not say a trade is good, bad, optimal, or recommended.
- Do not provide investment advice or position sizing advice.
- Do not place, cancel, route, or sign orders.
- Do not request private keys, seed phrases, exchange passwords, or wallet
  credentials.
- Require explicit user approval before any workflow moves from research to
  execution-capable tooling.

## Planning Workflow

1. Restate the user's idea as a neutral hypothesis.
2. Identify markets, venues, underliers, resolution rules, fees, and data
   freshness constraints.
3. If `ITO_API_KEY` is configured and requested, read Itô basket metadata.
4. Build a manual worksheet:
   - market/underlier
   - venue
   - data source
   - current observable price or status
   - resolution rule
   - liquidity caveat
   - open questions
   - manual action link or next review step
5. Run `prediction-market-risk-review` before discussing automation, keys,
   venue auth, or capital constraints.

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

## Output Contract

End every plan with:

```text
This is a planning worksheet, not investment or trading advice. Review venue
rules and make any trading decisions yourself.
```
