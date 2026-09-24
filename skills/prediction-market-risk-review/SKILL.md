---
name: prediction-market-risk-review
description: Review prediction-market, basket, oracle, and trading-agent workflows for compliance, safety, data-quality, privacy, and execution risk. Use before any workflow handles venue auth, user portfolio data, API keys, or trade planning.
origin: ECC
---

# Prediction Market Risk Review

Use this skill before a prediction-market workflow touches user financial
context, venue authentication, portfolio data, automation, or execution-capable
tools.

## Review Gates

### Advice Boundary

- Confirm the output is informational.
- Remove buy/sell/hold/size recommendations.
- Keep manual user decision points explicit.

### Venue And Regulatory Boundary

- Identify venue terms, geography restrictions, account limits, and API rules.
- Flag betting, derivatives, securities, or commodities ambiguity for legal
  review when relevant.
- Do not bypass venue restrictions or rate limits.

### Data Quality

- Check market liquidity, spread, resolution rules, stale prices, and source
  timestamps.
- Separate public venue data from Itô gated data.
- Do not mix public and private sources without labels.

### Security

- Do not request or store private keys, seed phrases, or passwords.
- Keep `ITO_API_KEY` and venue API keys out of logs and docs.
- Use read-only scopes by default.
- Require circuit breakers, spend limits, dry runs, and human approval before
  any private implementation adds execution.

### Privacy

- Minimize user portfolio, financial, and knowledge-base data.
- Redact private sources in public artifacts.
- Preserve only the fields needed for the review.

## Output Contract

Return:

1. scope reviewed
2. pass/warn/fail findings
3. blocked actions
4. required mitigations
5. safe next step

If any execution-capable step is requested, require a separate implementation
plan and explicit user approval.
