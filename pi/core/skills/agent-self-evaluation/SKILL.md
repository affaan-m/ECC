---
name: agent-self-evaluation
description: Use after completing any non-trivial task. The agent self-rates its output on 5 axes — accuracy, completeness, clarity, actionability, conciseness — with concrete evidence per criterion. Produces a structured 1-5 scorecard with specific improvement suggestions.
origin: ECC
---

# Agent Self-Evaluation

After completing a complex task, the agent pauses to rate its own output against a structured 5-axis rubric. This is NOT a pass/fail gate — it's a deliberate reflection step that catches omissions, flags overconfidence, and surface areas for improvement before the user has to.

## When to Activate

- After writing code that spans 3+ files or 50+ lines
- After completing a multi-step workflow (implement → test → review)
- After a debugging session that involved 3+ attempts
- After producing a design document, architecture decision, or written analysis
- When the user asks "how good was that?" or "rate yourself"
- At the end of any session Stop hook (if configured — see `references/hook-integration.md`)

## Core Concepts

### The 5 Evaluation Axes

| Axis | Question | What it catches |
|---|---|---|
| **Accuracy** | Are the facts, claims, and outputs correct? | Hallucinations, wrong API names, incorrect syntax, false statements |
| **Completeness** | Did it cover everything the user asked for? | Missed edge cases, unhandled error paths, forgotten requirements, skipped subtasks |
| **Clarity** | Is the explanation understandable and well-structured? | Confusing explanations, jargon without definition, missing context, rambling |
| **Actionability** | Can the user act on the output immediately? | Vague suggestions, missing steps, "you should X" without showing how, no verification path |
| **Conciseness** | Did it use the minimum words/tokens needed? | Redundancy, over-explanation, repeating the user's question verbatim, filler content |

### Scoring Scale

```
5 — Exceptional: no reasonable improvement possible
4 — Good: minor nits only, no substantive gaps
3 — Adequate: meets the request but has a notable weakness on at least one axis
2 — Weak: has a clear gap that affects usability or correctness
1 — Poor: fundamentally misses the request or contains significant errors
```

### The Evidence Rule

Every score below 5 MUST cite specific evidence. A score of 3 cannot just say "could be better" — it must say exactly what is missing or wrong. The mantra: **"Show the gap, don't just name it."**

## Workflow

### Step 1: Collect the Raw Material

Gather what you'll evaluate:

```
- The original user request (read back from conversation)
- Your final response/output (the deliverable)
- Any tool outputs that verify correctness (test results, exit codes, lint output)
- Any user feedback received during the task (corrections, "try again", "that's not right")
```

### Step 2: Score Each Axis Independently

Work through the 5 axes one at a time. For each:

1. Read the axis question
2. Find evidence (or lack of evidence) in the output
3. Assign a score 1-5
4. If score < 5, write a one-sentence improvement note citing the gap

Do NOT average the scores in your head first and then work backwards. Score each axis fresh.

### Step 3: Produce the Evaluation Report

Use the template from `templates/evaluation-report.md`. The report must include:

```
- One-line summary
- 5-axis scorecard (score + evidence per axis)
- Overall score (simple average, rounded to 1 decimal)
- 1-3 specific improvements ranked by impact
- Self-check: "Would the user agree with this assessment?"
```

### Step 4: Apply the Improvement

If any axis scored 3 or below:

1. State what you would do differently
2. If the gap is fixable in < 30 seconds (missing link, unclear phrasing), fix it now
3. If the gap requires rework, flag it explicitly: "This axis scored [reason] because [evidence]. Re-running with [specific fix] would likely raise it to [score]."

## Code Examples

### Example: Good Evaluation (Score 4+)

```
Task: Add retry logic to HTTP client

Scorecard:
  Accuracy:    5 — All API calls correct. Verified: retries use
                  exponential backoff. No hallucinated methods.
  Completeness: 4 — Covered happy path + 3 error cases. Missing:
                  timeout handling for hung connections.
  Clarity:      5 — Code comments explain backoff formula.
                  PR description links to incident that motivated this.
  Actionability:5 — Single merge. No follow-up tasks. Tests pass.
  Conciseness:  4 — 47 lines total. The retry loop could be extracted
                  into a helper to drop ~8 lines.

Overall: 4.6 — One gap (timeout handling). Fix before merging.
```

### Example: Weak Evaluation (Score 2-3)

```
Task: Add retry logic to HTTP client

Scorecard:
  Accuracy:    2 — Used urllib3 which doesn't match our
                  httpx-based codebase. Wrong library.
  Completeness: 3 — Works for GET. POST/PUT not handled (user
                  said "all HTTP requests").
  Clarity:      4 — Code is readable. Good variable names.
  Actionability:2 — "Add tests" mentioned but no test file created.
                  User has to write tests before merging.
  Conciseness:  3 — 120 lines. The retry config is duplicated in
                  3 places instead of one shared RetryConfig object.

Overall: 2.8 — Wrong library used. Needs httpx rewrite.
  Fix accuracy first (switch to httpx), then extend to all
  HTTP methods, then consolidate config.
```

## Anti-Patterns

### "Everything is a 5"

```
FAIL: Accuracy:    5 — All good.
   Completeness: 5 — Everything covered.
   Clarity:      5 — Clear.
```

No evidence cited. This is self-congratulation, not evaluation. A real 5 requires proving there's nothing to improve.

### Over-penalizing for scope creep

```
FAIL: Completeness: 2 — Didn't handle WebSocket connections or
   gRPC streaming (user didn't ask for these)
```

Only evaluate against what the user actually requested, not what you could have additionally built.

### Using the evaluation to re-litigate

```
FAIL: "As I said earlier, this approach is wrong. Score: 1"
```

The evaluation is about the delivered output, not about re-arguing design decisions that were already made. If the approach was wrong, that should have been caught before delivery.

### Mixing personal preference with objective gaps

```
FAIL: "Score: 3. I don't like Python decorators."
```

"Don't like" is not evidence. Cite a concrete readability, testability, or correctness concern, or leave the score at 4+.

## Best Practices

- **Evaluate the output, not the process.** The user cares about what you delivered, not how many iterations you took.
- **One improvement per weak axis.** Don't list 5 things for one axis — pick the highest-impact gap.
- **Tie improvements to user impact.** "Missing error handling means the user's API call will crash silently" beats "add error handling."
- **Be specific about what 'fixed' looks like.** "Re-run with httpx transport configured for retries" beats "fix the library issue."
- **Use tool outputs as evidence.** If tests passed, cite them. If lint is clean, cite it. Don't guess — grep for the proof.
- **If you can't find any gaps, try harder.** A perfect score across all 5 axes is rare. Ask: "If I were the user, what would annoy me about this output?"

## Related Skills

- `agent-eval` — Head-to-head comparison of different coding agents on benchmark tasks
- `verification-loop` — Systematic verification of outputs against expected results
- `security-review` — Security-focused code review checklist
