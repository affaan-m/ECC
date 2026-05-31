---
name: agent-architecture-audit
description: Full-stack diagnostic for agent and LLM applications. Audits the 12-layer agent stack for wrapper regression, memory pollution, tool discipline failures, hidden repair loops, and rendering corruption. Produces severity-ranked findings with code-first fixes. Essential for developers building agent applications, autonomous loops, or any LLM-powered feature.
origin: oh-my-agent-check
tools: Read, Write, Edit, Bash, Grep, Glob
---

# Agent Architecture Audit

A diagnostic workflow for agent systems that hide failures behind wrapper layers, stale memory, retry loops, or transport/rendering mutations.

## When to Activate

**MANDATORY for:**
- Releasing any agent or LLM-powered application to production
- Shipping features with tool calling, memory, or multi-step workflows
- Agent behavior degrades after adding wrapper layers
- User reports "the agent is getting worse" or "tools are flaky"
- Same model works in playground but breaks inside your wrapper
- Debugging agent behavior for more than 15 minutes without finding root cause

**Especially critical when:**
- You've added new prompt layers, tool definitions, or memory systems
- Different agents in your system behave inconsistently
- The model was fine yesterday but is hallucinating today
- You suspect hidden repair/retry loops silently mutating responses

**Do not use for:**
- General code debugging — use `agent-introspection-debugging`
- Code review — use language-specific reviewer agents
- Security scanning — use `security-review` or `security-review/scan`
- Agent performance benchmarking — use `agent-eval`
- Writing new features — use the appropriate workflow skill

## The 12-Layer Stack

Every agent system has these layers. Any of them can corrupt the answer:

| # | Layer | What Goes Wrong |
|---|-------|----------------|
| 1 | System prompt | Conflicting instructions, instruction bloat |
| 2 | Session history | Stale context injection from previous turns |
| 3 | Long-term memory | Pollution across sessions, old topics in new conversations |
| 4 | Distillation | Compressed artifacts re-entering as pseudo-facts |
| 5 | Active recall | Redundant re-summary layers wasting context |
| 6 | Tool selection | Wrong tool routing, model skips required tools |
| 7 | Tool execution | Hallucinated execution — claims to call but doesn't |
| 8 | Tool interpretation | Misread or ignored tool output |
| 9 | Answer shaping | Format corruption in final response |
| 10 | Platform rendering | Transport-layer mutation (UI, API, CLI mutates valid answers) |
| 11 | Hidden repair loops | Silent fallback/retry agents running second LLM pass |
| 12 | Persistence | Expired state or cached artifacts reused as live evidence |

## Common Failure Patterns

### 1. Wrapper Regression

The base model produces correct answers, but the wrapper layers make it worse.

**Symptoms:**
- Model works fine in playground or direct API call, breaks in your agent
- Added a new prompt layer, existing behavior degraded
- Agent sounds confident but is confidently wrong
- "It was working before the last update"

### 2. Memory Contamination

Old topics leak into new conversations through history, memory retrieval, or distillation.

**Symptoms:**
- Agent brings up unrelated past topics
- User corrections don't stick (old memory overwrites new)
- Same-session artifacts re-enter as pseudo-facts
- Memory grows without bound, degrading response quality over time

### 3. Tool Discipline Failure

Tools are declared in the prompt but not enforced in code. The model skips them or hallucinates execution.

**Symptoms:**
- "Must use tool X" in prompt, but model answers without calling it
- Tool results look correct but were never actually executed
- Different tools fight over the same responsibility
- Model uses tool when it shouldn't, or skips it when it must

### 4. Rendering/Transport Corruption

The agent's internal answer is correct, but the platform layer mutates it during delivery.

**Symptoms:**
- Logs show correct answer, user sees broken output
- Markdown rendering, JSON parsing, or streaming fragments corrupt valid responses
- Hidden fallback agent quietly replaces the answer before delivery
- Output differs between terminal and UI

### 5. Hidden Agent Layers

Silent repair, retry, summarization, or recall agents run without explicit contracts.

**Symptoms:**
- Output changes between internal generation and user delivery
- "Auto-fix" loops run a second LLM pass the user doesn't know about
- Multiple agents modify the same output without coordination
- Answers get "smoothed" or "corrected" by invisible layers

## Audit Workflow

### Phase 1: Scope

Define what you're auditing:

- **Target system** — what agent application?
- **Entrypoints** — how do users interact with it?
- **Model stack** — which LLM(s) and providers?
- **Symptoms** — what does the user report?
- **Time window** — when did it start?
- **Layers to audit** — which of the 12 layers apply?

### Phase 2: Evidence Collection

Gather evidence from the codebase:

- **Source code** — agent loop, tool router, memory admission, prompt assembly
- **Logs** — historical session traces, tool call records
- **Config** — prompt templates, tool schemas, provider settings
- **Memory files** — SOPs, knowledge bases, session archives

Use `rg` to search for anti-patterns:

```bash
# Tool requirements expressed only in prompt text (not code)
rg "must.*tool|必须.*工具|required.*call" --type md

# Tool execution without validation
rg "tool_call|toolCall|tool_use" --type py --type ts

# Hidden LLM calls outside main agent loop
rg "completion|chat\.create|messages\.create|llm\.invoke"

# Memory admission without user-correction priority
rg "memory.*admit|long.*term.*update|persist.*memory" --type py --type ts

# Fallback loops that run additional LLM calls
rg "fallback|retry.*llm|repair.*prompt|re-?prompt" --type py --type ts

# Silent output mutation
rg "mutate|rewrite.*response|transform.*output|shap" --type py --type ts
```

### Phase 3: Failure Mapping

For each finding, document:

- **Symptom** — what the user sees
- **Mechanism** — how the wrapper causes it
- **Source layer** — which of the 12 layers
- **Root cause** — the deepest cause
- **Evidence** — file:line or log:row reference
- **Confidence** — 0.0 to 1.0

### Phase 4: Fix Strategy

Default fix order (code-first, not prompt-first):

1. **Code-gate tool requirements** — enforce in code, not just prompt text
2. **Remove or narrow hidden repair agents** — make fallback explicit with contracts
3. **Reduce context duplication** — same info through prompt + history + memory + distillation
4. **Tighten memory admission** — user corrections > agent assertions
5. **Tighten distillation triggers** — don't compress what shouldn't be compressed
6. **Reduce rendering mutation** — pass-through, don't transform
7. **Convert to typed JSON envelopes** — structured internal flow, not freeform prose

## Severity Model

| Level | Meaning | Action |
|-------|---------|--------|
| `critical` | Agent can confidently produce wrong operational behavior | Fix before next release |
| `high` | Agent frequently degrades correctness or stability | Fix this sprint |
| `medium` | Correctness usually survives but output is fragile or wasteful | Plan for next cycle |
| `low` | Mostly cosmetic or maintainability issues | Backlog |

## Output Format

Present findings to the user in this order:

1. **Severity-ranked findings** (most critical first)
2. **Architecture diagnosis** (which layer corrupted what, and why)
3. **Ordered fix plan** (code-first, not prompt-first)

Do not lead with compliments or summaries. If the system is broken, say so directly.

## Quick Diagnostic Questions

When auditing an agent system, answer these:

| # | Question | If Yes → |
|---|----------|----------|
| 1 | Can the model skip a required tool and still answer? | Tool not code-gated |
| 2 | Does old conversation content appear in new turns? | Memory contamination |
| 3 | Is the same info in system prompt AND memory AND history? | Context duplication |
| 4 | Does the platform run a second LLM pass before delivery? | Hidden repair loop |
| 5 | Does the output differ between internal generation and user delivery? | Rendering corruption |
| 6 | Are "must use tool X" rules only in prompt text? | Tool discipline failure |
| 7 | Can the agent's own monologue become persistent memory? | Memory poisoning |

## Anti-Patterns to Avoid

- Avoid blaming the model before falsifying wrapper-layer regressions.
- Avoid blaming memory without showing the contamination path.
- Do not let a clean current state erase a dirty historical incident.
- Do not treat markdown prose as a trustworthy internal protocol.
- Do not accept "must use tool" in prompt text when code never enforces it.
- Keep findings direct, evidence-backed, and severity-ranked.

## Report Schema

Audits should produce structured reports following this shape:

```json
{
  "schema_version": "ecc.agent-architecture-audit.report.v1",
  "executive_verdict": {
    "overall_health": "high_risk",
    "primary_failure_mode": "string",
    "most_urgent_fix": "string"
  },
  "scope": {
    "target_name": "string",
    "model_stack": ["string"],
    "layers_to_audit": ["string"]
  },
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "title": "string",
      "mechanism": "string",
      "source_layer": "string",
      "root_cause": "string",
      "evidence_refs": ["file:line"],
      "confidence": 0.0,
      "recommended_fix": "string"
    }
  ],
  "ordered_fix_plan": [
    { "order": 1, "goal": "string", "why_now": "string", "expected_effect": "string" }
  ]
}
```

## Related Skills

- `agent-introspection-debugging` — Debug agent runtime failures (loops, timeouts, state errors)
- `agent-eval` — Benchmark agent performance head-to-head
- `security-review` — Security audit for code and configuration
- `autonomous-agent-harness` — Set up autonomous agent operations
- `agent-harness-construction` — Build agent harnesses from scratch
