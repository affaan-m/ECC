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

Arrange reusable prompt content to improve cache reuse, then measure input cost
and latency. Savings depend on model, platform, cache eligibility, writes,
retention, reuse and output volume. Runtime cache hits and savings for this skill
are **unmeasured**; the examples below validate arithmetic without provider calls.

## When to Activate

Use for repeated API requests that share authorized instructions, tools or
reference material. First identify the exact provider endpoint, model, service
tier and caching mode. Consult its current documentation before selecting rates,
minimum prefix length or retention. Caching does not reduce context-window use.

## How It Works

### Preserve a stable prefix

Keep reusable instructions, tool schemas and examples stable; place changing
questions, timestamps and retrieved results after that content where the API
allows. Respect the provider's serialization order: Claude uses tools, system,
then messages. Matching prefixes need identical content, including tool schemas
and relevant request settings. A changed prefix can prevent reuse from that
point. A dynamic suffix may itself be cached later if reused unchanged.

```text
Reusable prefix: approved tools, instructions, stable examples/reference
Changing suffix: current question, fresh retrieval results, request metadata
```

Choose only relevant context. Padding prompts or broadening access just to meet
an eligibility threshold needs its own cost and quality justification.

### Preserve user and workspace boundaries

Authorize content access before cache lookup or reuse. Scope application-managed
cache handles and accounting keys to the approved user, workspace, provider
account, model and content revision. Share only material explicitly approved for
that scope. A cache key is a routing/accounting hint, not an authorization gate
or a sandbox. Provider cache isolation does not replace application access checks.
Invalidate application references when permissions or content change; follow
provider retention/deletion controls. Avoid logging private prompt contents.
Context selection, capabilities, sandbox enforcement and evidence remain
independent of cache optimization.

## Provider Requirements and Usage Evidence

The linked documentation is authoritative; endpoint and SDK versions can expose
different usage field names. Record that version alongside counters.

| Provider | Requirements to verify | Counters to record |
| --- | --- | --- |
| OpenAI | Model-specific automatic/explicit modes, minimum length, retention and write/read prices; earlier and newer models differ | Responses `usage.input_tokens_details.cached_tokens` and, when present, `cache_write_tokens`; input and output totals. Chat Completions uses `prompt_tokens_details.cached_tokens` |
| Claude | Supported platform, model minimum, `cache_control` support and TTL; cache writes may cost more than ordinary input | `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`; split writes by TTL when rates differ |
| Gemini | Model minimum and API: Interactions supports implicit caching; explicit cache objects require GenerateContent | Interactions `usage.total_cached_tokens`; GenerateContent `usage_metadata` cache/input/output counters plus explicit-cache token count and retained duration |

Use [OpenAI's prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
and [pricing](https://developers.openai.com/api/docs/pricing/) for the selected
model. For Chat Completions, check the [usage schema](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
Derive ordinary input from the total minus cached reads and any separately
reported writes; do not count the same tokens twice.

Use [Claude's prompt caching guide](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
for current model/platform limits and TTL rates. Its `input_tokens` counts
ordinary input separately from cache reads and writes. A short prefix can produce
zero cache counters even when marked for caching. Do not assume every Claude
model or hosted platform uses the same minimum or read price.

Use [Gemini's caching guide](https://ai.google.dev/gemini-api/docs/caching),
[GenerateContent caching guide](https://ai.google.dev/gemini-api/docs/generate-content/caching)
and [pricing](https://ai.google.dev/gemini-api/docs/pricing). Explicit-cache
storage is charged by token count and retained duration, separately from reads,
ordinary input and output. Implicit hits are not guaranteed. Verify billing
categories for the chosen endpoint rather than copying another provider's rates.

## Cost Comparison Calculator

Normalize actual usage into nonoverlapping categories and use prices in the same
currency per million tokens. Split write categories when TTL, modality, tier or
model prices differ. Storage uses million-token-hours; other applicable charges
such as tools and grounding need their own lines. Include all warmup, miss,
expiration, refresh and retry requests in the measured period.

```text
baseline = (ordinary + written + read) * ordinary_input_rate / 1e6
           + output * output_rate / 1e6
actual   = ordinary * ordinary_input_rate / 1e6
           + written * cache_write_rate / 1e6
           + read * cache_read_rate / 1e6
           + output * output_rate / 1e6
           + storage_token_hours * storage_rate / 1e6
savings  = baseline - actual
```

This counterfactual holds prompt and output volumes fixed. For explicit-cache
creation, include any separately billed creation input in the write category;
use the endpoint's documented rate. Set nonexistent categories to zero. Compare
actual before/after invoices separately if warmup requests or output differ.
Never apply a cache discount to the total bill or to output tokens.

The executable calculator takes normalized counters, not raw provider responses:

```javascript
function compareCacheCost(usage, rates) {
  const counts = ['uncached', 'written', 'read', 'output', 'storageTokenHours'];
  const prices = ['input', 'write', 'read', 'output', 'storage'];
  for (const [values, keys] of [[usage, counts], [rates, prices]]) {
    for (const key of keys) {
      if (!Number.isFinite(values[key]) || values[key] < 0) {
        throw new Error(`${key} must be a finite nonnegative number`);
      }
    }
  }
  const outputCost = usage.output * rates.output / 1e6;
  const storageCost = usage.storageTokenHours * rates.storage / 1e6;
  const baseline = (usage.uncached + usage.written + usage.read)
    * rates.input / 1e6 + outputCost;
  const actual = (usage.uncached * rates.input + usage.written * rates.write
    + usage.read * rates.read) / 1e6 + outputCost + storageCost;
  return { baseline, actual, savings: baseline - actual, outputCost, storageCost };
}
```

## Examples

These are hypothetical prices and counts, not provider quotes or measured hits.
Ten calls each contain a 10,000-token stable prefix, 2,000-token changing suffix
and 2,000 output tokens. Assume one prefix write and nine full prefix reads.

| Category | Tokens | Example rate per million | Cost |
| --- | ---: | ---: | ---: |
| Ordinary input | 20,000 | $3.00 | $0.0600 |
| Cache write | 10,000 | $3.75 | $0.0375 |
| Cache read | 90,000 | $0.30 | $0.0270 |
| Output | 20,000 | $15.00 | $0.3000 |
| Storage | 0 token-hours | $0.00 | $0.0000 |

Baseline: 120,000 input tokens at $3 plus the same output = **$0.6600**.
With caching: **$0.4245**, savings **$0.2355**. The write premium is included;
the $0.3000 output bill remains unchanged. An output-heavy workload has the same
absolute input savings under these assumptions, a smaller fraction of total cost.

If an explicit cache retains 10,000 tokens for two hours at a hypothetical
$1 per million-token-hour, add **$0.0200** storage. Actual cost becomes
**$0.4445**. Use the selected Gemini endpoint's prices for a real estimate.

For a one-off call, that prefix write costs $0.0375 rather than $0.0300 ordinary
input: **$0.0075 more**, with no read savings. For a 500-token prefix below a
selected model's documented minimum, treat the request as uncached; claiming
future hits without counters would overstate savings. Repeated expiry or changing
prefixes can also turn expected savings into higher cost.

## Verification Workflow

1. Capture eligible prefix size and model/platform requirements from current docs.
2. Run the offline example and edge cases with
   `node tests/skills/prompt-caching-strategy.test.js` in the ECC repository.
3. If provider traffic is authorized, compare matched requests and aggregate
   actual cached-token counts, all input categories, output, storage, latency and
   realized cost by approved user/workspace. Record misses and rewrites too.
4. Report cached reads divided by total input tokens as a token hit rate; report
   request hit rate separately. Keep denominators and sampling period explicit.
5. If no traffic was measured, label hit rate, latency improvement and realized
   savings unmeasured. Offline arithmetic establishes no runtime cache behavior.

## Relationship to Other Skills

- **prompt-optimizer** improves prompt quality before optimizing reuse.
- **context-budget** identifies unnecessary context; caching still consumes it.
- **cost-aware-llm-pipeline** compares caching with routing, retries and other costs.
