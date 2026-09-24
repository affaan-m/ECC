---
name: recsys-pipeline-architect
description: Design composable recommendation, ranking, and feed pipelines using the six-stage Source→Hydrator→Filter→Scorer→Selector→SideEffect framework popularized by xAI's open-sourced For You algorithm. Use this skill whenever the user is building any system that picks "the top K items for a (user, context)" — social feeds, content CMSs, RAG rerankers, task prioritizers, notification triage, search reranking, ad ranking.
origin: community
---

# recsys-pipeline-architect

A spec-and-scaffold skill for building composable recommendation, ranking, and feed pipelines. It encodes the **six-stage pattern** — Source → Hydrator → Filter → Scorer → Selector → SideEffect — popularized by xAI's open-sourced [For You algorithm](https://github.com/xai-org/x-algorithm) (Apache 2.0). This skill is an independent reimplementation of the pattern (MIT) — no code copied from the original.

Upstream: <https://github.com/mturac/recsys-pipeline-architect>

## When to Use

- User wants to build any system that picks "the top K items for a user/context"
- User asks "how should I rank X" or describes a feed/personalization problem
- User has a scoring function and needs the pipeline plumbing around it
- User wants to migrate from a single relevance score to multi-action prediction with tunable weights
- User is wrapping an LLM/ML scorer and needs filters, hydrators, side-effects, and a runnable scaffold in their stack (TypeScript / Go / Python)
- Triggers: "recommendation system", "feed algorithm", "ranking pipeline", "for you feed", "candidate pipeline", "content recommender", "pipeline architecture for recsys", "RAG retrieval reranker"

## When NOT to Use

- Model architecture work (transformer design, two-tower retrieval, embedding training) — this skill is plumbing *around* the model, not the model itself
- Pure ML training pipelines — the scoring function is the user's responsibility
- Operating a deployed pipeline (monitoring, autoscaling) — out of scope

## The six-stage framework

| # | Stage | Job | Parallel? |
|---|---|---|---|
| 1 | **Source** | Fetch candidates from one or more origins | Yes — multiple sources run in parallel |
| 2 | **Hydrator** | Enrich each candidate with metadata needed for filtering and scoring | Yes — independent hydrators run in parallel |
| 3 | **Filter** | Drop candidates that should never be shown (blocked, expired, duplicate, ineligible) | Sequential — each filter sees fewer items |
| 4 | **Scorer** | Assign each surviving candidate one or more scores | Sequential — later scorers see earlier scores |
| 5 | **Selector** | Sort by final score, return top K | Single op |
| 6 | **SideEffect** | Cache served IDs, log impressions, emit events, update counters | Async — must never block the response |

### Why this exact order

- Sources before hydration: know what candidates exist before paying to enrich them
- Hydration before filtering: many filters need metadata the source did not provide
- Filtering before scoring: scoring is the expensive stage; drop the ineligible first
- Scorer chain (not single scorer): real systems compose ML scoring + diversity reranking + business rules
- Selector after scoring: keeps scoring deterministic and cacheable
- SideEffects last and async: side effects must never block the user response

## Workflow when invoked

Walk the user through these eight steps:

1. **Clarify the use case** (one round, three questions): items being ranked? input context? language/runtime?
2. **Identify the candidate sources**: usually in-network (followed/owned/subscribed) + out-of-network (ML retrieval / trending / similar-to-liked)
3. **List required hydrations**: for each filter and scorer, what data does it need that the source did not provide?
4. **List the filters**: duplicate, self, age, block/mute, previously-served, eligibility. Order matters — cheap before expensive.
5. **Design the scorer chain**: primary (ML) → combiner (multi-action with weights) → diversity → business rules
6. **Selector**: sort descending by final score, take top K (or stratified mix for in-network/out-of-network)
7. **SideEffects**: cache served IDs, emit impression events, update counters, log analytics — all fire-and-forget
8. **Generate the scaffold** in the user's stack

## Key trade-offs to surface (don't default silently)

### 1. Single score vs multi-action prediction

- **Single score**: train one model to predict relevance. To change behavior → retrain.
- **Multi-action**: predict `P(action)` for many actions (read, like, share, skip, report), combine with weights at serving time. To change behavior → change weights. No retraining.

The X For You system uses multi-action with both positive and negative weights. Recommend multi-action when the user expects to tune frequently.

### 2. Candidate isolation in scoring

- **Isolated**: each candidate scored independently. Deterministic, cacheable.
- **Joint**: candidates attend to each other during scoring (e.g., transformer over batch). More expressive but non-deterministic across batches.

Default to isolation. Joint only when there's a specific reason (e.g., explicit batch-aware diversity).

### 3. Online vs offline

- **Request-time (online)**: pipeline runs on each request. Latency budget: 100–300ms. Default.
- **Pre-computed (offline batch)**: pipeline runs periodically, results cached. Lower latency, lower freshness.
- **Hybrid**: candidate retrieval offline, ranking online.

## Hard rules

1. **Do not invent benchmark numbers.** "How much faster?" → "depends on workload, run it yourself."
2. **Attribution discipline.** When the pattern is referenced, attribute as "popularized by xAI's open-sourced For You algorithm" / `github.com/xai-org/x-algorithm` (Apache 2.0).
3. **No trademark use.** Do not name the user's artifact "X-like" or use "For You" branding. Pattern is free; brand is not. Suggested naming: "candidate pipeline", "feed pipeline", "ranking pipeline", "recsys pipeline".
4. **Surface trade-offs.** Multi-action vs single, isolation vs joint, online vs offline — never default silently.
5. **The generated scaffold must run.** No pseudocode passing as code.
6. **Filter order matters.** Cheap before expensive. Universal before user-specific.
7. **Side effects never block.** Wrap in fire-and-forget patterns (goroutines / promises without await / asyncio tasks).

## Anti-Patterns

- Scoring before filtering (wastes compute on candidates that will be dropped anyway)
- Synchronous side effects (cache writes / impression emits blocking the response)
- A single "relevance" score when the product needs to tune for multiple objectives (engagement vs safety vs diversity vs ads)
- Joint scoring as default (non-deterministic, harder to cache, doesn't compose with reranking stages)
- Generating pseudocode "for illustration" — the scaffold must actually run

## Upstream contents

The upstream repository at <https://github.com/mturac/recsys-pipeline-architect> ships:

- Full `SKILL.md` with the complete 8-step workflow
- 5 load-on-demand reference docs: interfaces in 4 languages (TS/Go/Python/Rust), multi-action scoring pattern, candidate isolation, filter cookbook (12 patterns), scorer cookbook (weighted sum, MMR, diversity penalty, position debiasing)
- 3 runnable example scaffolds, every one green on its test suite:
  - Strapi v5 plugin (TypeScript / Jest — 3/3 pass)
  - Zentra-compatible pipeline (Go with generics — 3/3 pass)
  - PMAI task prioritizer (Python / FastAPI / pytest — 3/3 pass)
- v0.1.0 release tagged
- MIT license; pattern attributed to xAI X For You algorithm (Apache 2.0)

Install via skills.sh: `npx skills add mturac/recsys-pipeline-architect`
