---
name: ai-engineering-ch10-end-to-end
description: Use when shipping AI to production.
---
# End-to-End AI Application (Huyen Ch 10)

## Architecture
```
User → Gateway → Auth/RateLimit → Router
    → [RAG / Agent / Direct] → Model
    → Guardrails → Response
    → Logging/Monitoring
```

## Monitoring
- Latency: p50, p95, p99
- Cost: tokens, $/1k req
- Quality: eval scores, satisfaction
- Safety: refusal rate, injections
- Drift: embedding shift

## Feedback Loop
```
Implicit: regen, copy, edit, dwell
Explicit: thumbs, correction, rating
Pipeline: Collect → Annotate → Golden Set
  → Retrain prompt/FT → Eval → Deploy
```

## Guardrails
- Input: PII, injection, topic filter
- Output: schema, fact-check, tone, refusal
- Execution: tool allowlist, sandbox, timeout

## Gradual Rollout
```
Canary (1%) → Shadow (10%) → Ramp (25/50/100%)
```

## When to Use
- Shipping AI feature
- Setting up observability
- Feedback-driven improvement
