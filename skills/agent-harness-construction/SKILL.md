---
name: agent-harness-construction
description: Design and optimize AI agent action spaces, tool definitions, and observation formatting for higher completion rates. Use when defining or revising an agent's tool set, action space, or observation format.
metadata:
  origin: ECC
---

# Agent Harness Construction

Use this skill when you are improving how an agent plans, calls tools, recovers from errors, and converges on completion.

## Core Model

Agent output quality is constrained by:
1. Action space quality
2. Observation quality
3. Recovery quality
4. Context budget quality

## Action Space Design

1. Use stable, explicit tool names.
2. Keep inputs schema-first and narrow.
3. Return deterministic output shapes.
4. Avoid catch-all tools unless isolation is impossible.

## Granularity Rules

- Use micro-tools for high-risk operations (deploy, migration, permissions).
- Use medium tools for common edit/read/search loops.
- Use macro-tools only when round-trip overhead is the dominant cost.

## Observation Design

Every tool response should include:
- `status`: success|warning|error
- `summary`: one-line result
- `next_actions`: actionable follow-ups
- `artifacts`: file paths / IDs

## Error Recovery Contract

For every error path, include:
- root cause hint
- safe retry instruction
- explicit stop condition

## Context Budgeting

1. Keep system prompt minimal and invariant.
2. Move large guidance into skills loaded on demand.
3. Prefer references to files over inlining long documents.
4. Compact at phase boundaries, not arbitrary token thresholds.

## Architecture Pattern Guidance

- ReAct: best for exploratory tasks with uncertain path.
- Function-calling: best for structured deterministic flows.
- Hybrid (recommended): ReAct planning + typed tool execution.

## Benchmarking

Track:
- completion rate
- retries per task
- pass@1 and pass@3
- cost per successful task

## Verify The Work Product

Define a narrow completion check before the worker starts. Keep queue selection,
session hosting, action selection, and result validation separate so different
tools and models can share the same contract.

ECC's opt-in [verified work-item flow](https://github.com/affaan-m/ECC/blob/main/docs/architecture/verified-work-item-outcomes.md)
registers a deterministic artifact check and records failed and successful
attempts. Start with the `harness-adapter-documentation/v1` validator for adapter
matrix documentation. Repair the artifact after a failed check, then verify it
again. A manual `done` status is not evidence that a validator passed.

From an ECC checkout, set `ECC_SESSION_ID` to an existing session ID in the same
state database, then use a new work-item ID:

```bash
node scripts/work-items.js upsert adapter-docs --title 'Check adapter matrix' \
  --repo-root "$PWD" --verify harness-adapter-documentation/v1 \
  --artifact docs/architecture/harness-adapter-compliance.md
node scripts/work-items.js claim adapter-docs --owner docs-worker --as agent --session-id "$ECC_SESSION_ID"
node scripts/work-items.js verify adapter-docs --json
```

Compact models can eventually choose or repair tool calls through these same
interfaces; the current flow does not train models or automate those repairs.

## Anti-Patterns

- Too many tools with overlapping semantics.
- Opaque tool output with no recovery hints.
- Error-only output without next steps.
- Context overloading with irrelevant references.
