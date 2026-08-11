---
name: ito-market-intelligence
description: Research prediction-market events, venues, underliers, liquidity, and news context for Itô basket workflows. Use for read-only market intelligence, API-gated Itô exploration, and source-grounded prediction-market briefings without investment advice or live trading.
---

# Itô Market Intelligence

Use this skill when a user wants prediction-market context, event discovery,
venue comparison, basket theme exploration, or an Itô API-backed market brief.

Use public sources by default. Any Itô-backed data call requires the user to
explicitly request Itô data and requires a scoped `ITO_API_KEY`. Never print,
persist, or ask the user to paste a key into chat.

## Guardrails

- Do not provide investment, legal, tax, or trading advice.
- Do not place, cancel, route, or simulate live orders.
- Do not infer the user's financial situation unless they provide it.
- Treat Polymarket, Kalshi, Itô, X, Exa, GitHub, and web data as source inputs,
  not as truth by themselves.
- Separate facts, market-implied signals, and your interpretation.
- Never claim a price, volume, liquidity value, timestamp, venue rule, or news
  event that is absent from a cited response or source.
- Treat every remote response as a snapshot. Show its retrieval time, source
  URL, and source-provided update time when available. Call data stale or
  unknown rather than silently treating it as current.

## Workflow

1. Clarify the market theme, venue, geography, and time horizon.
2. Gather public market data from venue docs/APIs or source-grounded research.
   Cite the exact source URL next to each material claim and distinguish the
   publication/update time from the retrieval time.
3. If the user explicitly asks for Itô data, run the bundled read-only client:

   ```bash
   node scripts/ito-market-intelligence.js --json search-markets --platform all --limit 25
   ```

   The client reads `ITO_API_KEY` from the environment, sends it only to the
   configured Itô HTTPS origin, never logs it, and permits only documented GET
   endpoints. Do not run it merely because a key exists.
4. Normalize event, underlier, liquidity, fee, resolution, and data-latency
   differences across venues.
5. Produce a decision brief:
   - market/event summary
   - available venues and underliers
   - liquidity and data-quality caveats
   - relevant news/source context
   - open questions before any user action

## Authentication and recovery

- Market-data API keys are separate from the Itô compute CLI's device login.
  Do not run `ito login`, `ecc ito login`, or open a browser for this skill:
  those credentials are not a documented substitute for a `baskets:read` or
  `markets:read` API key. Return control to the originating agent after stating
  the missing scope and operator-driven access requirement.
- On `AUTH_MISSING`, request a scoped key through the user's established Itô
  access channel without collecting it in chat. On `AUTH_REJECTED`, say the key
  may be expired, revoked, or missing the required read scope.
- On `RATE_LIMITED`, respect `retry_after_seconds`; do not loop automatically.
  On `TIMEOUT` or `UPSTREAM_ERROR`, preserve prior cited facts, label the live
  snapshot unavailable, and offer a bounded retry. Never replace failed live
  data with invented values.
- `ITO_MARKET_API_URL` may override the API origin for deterministic local
  tests. In normal use keep the default `https://itomarkets.com/api/v1`.

## Useful Skill Chains

- Use `deep-research` or `exa-search` for source discovery.
- Use `x-api` for public social signal discovery when X access is configured.
- Use `market-research` for market sizing, competitors, or business use cases.
- Use `prediction-market-risk-review` before any workflow touches user capital,
  portfolio data, or execution-capable credentials.

## Output Contract

Default to a compact brief containing `retrieved_at`, source links,
source-provided timestamps, freshness caveats, facts, market-implied signals,
interpretation, and actionable open questions. End with:

```text
This is market intelligence, not investment or trading advice.
```

If access is missing, say:

```text
Itô live basket/API data requires gated access. Request an ITO_API_KEY before
using Itô-backed reads.
```
