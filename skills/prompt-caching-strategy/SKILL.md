---
name: prompt-caching-strategy
description: >-
  Optimize LLM prompt caching hit rate to reduce API costs and improve latency.
  Analyzes prompt structure, identifies cacheable vs non-cacheable content,
  and recommends restructuring to maximize cache reuse.
  TRIGGER when: user says "prompt cache", "cache hit rate", "reduce LLM cost",
  "optimize token usage", "cheaper LLM calls", or asks about prompt caching
  strategies for OpenAI/Anthropic/other providers.
  DO NOT TRIGGER when: user just wants to optimize a single prompt's quality
  (use prompt-optimizer instead), or asks about general caching infrastructure.
metadata:
  origin: community
  author: cyberspace-cs
  version: "1.0.0"
---

# Prompt Caching Strategy

Optimize your LLM application's prompt caching hit rate to cut costs by 50-90%
and reduce latency.

## Core Principles

### What is Prompt Caching

Providers (OpenAI, Anthropic, Google) cache prefixes of prompts. If the
beginning of your prompt matches a previous call, the provider reuses the
cached computation instead of re-processing it. This means:
- **Cheaper**: cached tokens cost 50-90% less
- **Faster**: cached prefixes skip processing time

### The Golden Rule

> **Cacheable content goes FIRST. Variable content goes LAST.**

The cache matches from the start of the prompt. Any change in the middle
invalidates the entire cache from that point onward.

## Prompt Structure for Maximum Cache Hit

### Optimal Ordering

```
1. System prompt (static)          ← cacheable
2. Tool definitions (static)      ← cacheable
3. Few-shot examples (stable)      ← cacheable
4. User context (slowly changing) ← partially cacheable
5. Current user input (dynamic)   ← NOT cacheable
```

### Anti-Pattern: Bad Ordering

```
❌ System prompt at the end
❌ User input before tool definitions
❌ Timestamp or random ID early in the prompt
❌ Changing examples every call
```

## What to Cache vs What Not to Cache

### High-Value Cache Content

| Content Type | Cache Worth | Notes |
| --- | --- | --- |
| System instructions | ⭐⭐⭐⭐⭐ | Always keep first |
| Tool/function definitions | ⭐⭐⭐⭐⭐ | Static, large, high reuse |
| Few-shot examples | ⭐⭐⭐⭐ | Keep stable, don't vary |
| Preamble / preamble text | ⭐⭐⭐⭐ | Brand voice, rules, constraints |
| Retrieval context (same session) | ⭐⭐⭐ | Cache per session, not global |

### Low-Value / Anti-Cache Content

| Content Type | Why Not Cache |
| --- | --- |
| Timestamps / dates | Changes every call, invalidates cache |
| Random IDs / nonces | Same issue |
| User-specific variable data | Changes per user |
| Real-time search results | Changes per query |
| Very short prompts | Overhead exceeds savings |

## Optimization Checklist

Before shipping your LLM application, run through this:

- [ ] **System prompt is at the very start** — nothing variable before it
- [ ] **Tool definitions are static** — not regenerated per call
- [ ] **Few-shot examples are stable** — not randomly selected
- [ ] **No timestamps/IDs early in the prompt** — move them to the end
- [ ] **Dynamic content is at the end** — user input, current context
- [ ] **Prompt length > 1024 tokens** — below this, caching overhead may not be worth it
- [ ] **High call frequency** — caching saves more when you call the same prompt many times
- [ ] **Provider supports caching** — OpenAI/Anthropic/Google all do, but check specifics

## Provider-Specific Notes

### OpenAI
- Caches the prefix automatically (no explicit API call needed)
- Minimum cacheable prefix: ~1024 tokens
- Cached tokens cost 50% less
- Cache TTL: ~5-10 minutes (auto-evicted)

### Anthropic
- Explicit caching with `cache_control` breakpoints
- You control exactly what gets cached
- Minimum cacheable prefix: ~1024 tokens
- Cached tokens cost 90% less (!!)
- Cache TTL: 5 minutes (default), extendable

### Google Gemini
- Automatic prefix caching
- Similar economics to OpenAI
- Check docs for current pricing details

## Cost Savings Calculator

Estimate your potential savings:

```
Current monthly cost: $X
Average prompt length: Y tokens
Cache hit rate after optimization: Z%
Cached token discount: D% (e.g., 50% for OpenAI, 90% for Anthropic)

Estimated monthly savings = $X × (Y / total_tokens) × Z% × D%
```

Example:
- $1000/month bill, 60% of tokens are cacheable prefix
- After optimization: 80% cache hit rate, 90% discount (Anthropic)
- Savings = $1000 × 60% × 80% × 90% = **$432/month saved**

## When NOT to Use Caching

Caching is not always worth it:
- **Very short prompts** (< 1000 tokens): overhead > savings
- **One-off calls**: cache never gets reused
- **Rapidly changing content**: cache miss rate too high
- **Low traffic apps**: total dollar savings too small to matter

## Relationship to Other Skills

- **prompt-optimizer**: Optimizes prompt quality/clarity. Use this first to get
  a good prompt, then use this skill to optimize its cacheability.
- **context-budget**: Analyzes how much context your session uses. Use that to
  find bloat; use this skill to make the remaining context cheaper.
