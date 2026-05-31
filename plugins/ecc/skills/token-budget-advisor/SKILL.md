---
name: token-budget-advisor
description: >-
  Offers the user an informed choice about how much response depth to
  consume before answering. Use this skill when the user explicitly
  wants to control response length, depth, or token budget.
  TRIGGER when: "token budget", "token count", "token usage", "token limit",
  "response length", "answer depth", "short version", "brief answer",
  "detailed answer", "exhaustive answer", "respuesta corta vs larga",
  "cuántos tokens", "ahorrar tokens", "responde al 50%", "dame la versión
  corta", "quiero controlar cuánto usas", or clear variants where the
  user is explicitly asking to control answer size or depth.
  DO NOT TRIGGER when: user has already specified a level in the current
  session (maintain it), the request is clearly a one-word answer, or
  "token" refers to auth/session/payment tokens rather than response size.
origin: community
---

# Token Budget Advisor (TBA)

Intercept the response flow to offer the user a choice about response depth **before** Claude answers.

## When to Use

- User wants to control how long or detailed a response is
- User mentions tokens, budget, depth, or response length
- User says "short version", "tldr", "brief", "al 25%", "exhaustive", etc.
- Any time the user wants to choose depth/detail level upfront

**Do not trigger** when: user already set a level this session (maintain it silently), or the answer is trivially one line.

## How It Works

### Step 1 — Estimate input tokens

Use the repository's canonical context-budget heuristics to estimate the prompt's token count mentally.

Use the same calibration guidance as [context-budget](../context-budget/SKILL.md):

- prose: `words × 1.3`
- code-heavy or mixed/code blocks: `chars / 4`

For mixed content, use the dominant content type and keep the estimate heuristic.

### Step 2 — Estimate response size by complexity

Classify the prompt, then apply the multiplier range to get the full response window:

| Complexity   | Multiplier range | Example prompts                                      |
|--------------|------------------|------------------------------------------------------|
| Simple       | 3× – 8×          | "What is X?", yes/no, single fact                   |
| Medium       | 8× – 20×         | "How does X work?"                                  |
| Medium-High  | 10× – 25×        | Code request with context                           |
| Complex      | 15× – 40×        | Multi-part analysis, comparisons, architecture      |
| Creative     | 10× – 30×        | Stories, essays, narrative writing                  |

Response window = `input_tokens × mult_min` to `input_tokens × mult_max` (but don’t exceed your model’s configured output-token limit).

### Step 3 — Present depth options

Present this block **before** answering, using the actual estimated numbers:

```
Analyzing your prompt...

Input: ~[N] tokens  |  Type: [type]  |  Complexity: [level]  |  Language: [lang]

Choose your depth level:

[1] Essential   (25%)  ->  ~[tokens]   Direct answer only, no preamble
[2] Moderate    (50%)  ->  ~[tokens]   Answer + context + 1 example
[3] Detailed    (75%)  ->  ~[tokens]   Full answer with alternatives
[4] Exhaustive (100%)  ->  ~[tokens]   Everything, no limits

Which level? (1-4 or say "25% depth", "50% depth", "75% depth", "100% depth")

Precision: heuristic estimate ~85-90% accuracy (±15%).
```

Level token estimates (within the response window):
- 25%  → `min + (max - min) × 0.25`
- 50%  → `min + (max - min) × 0.50`
- 75%  → `min + (max - min) × 0.75`
- 100% → `max`

### Step 4 — Respond at the chosen level

| Level            | Target length       | Include                                             | Omit                                              |
|------------------|---------------------|-----------------------------------------------------|---------------------------------------------------|
| 25% Essential    | 2-4 sentences max   | Direct answer, key conclusion                       | Context, examples, nuance, alternatives           |
| 50% Moderate     | 1-3 paragraphs      | Answer + necessary context + 1 example              | Deep analysis, edge cases, references             |
| 75% Detailed     | Structured response | Multiple examples, pros/cons, alternatives          | Extreme edge cases, exhaustive references         |
| 100% Exhaustive  | No restriction      | Everything — full analysis, all code, all perspectives | Nothing                                        |

## Shortcuts — skip the question

If the user already signals a level, respond at that level immediately without asking:

| What they say                                      | Level |
|----------------------------------------------------|-------|
| "1" / "25% depth" / "short version" / "brief answer" / "tldr"  | 25%   |
| "2" / "50% depth" / "moderate depth" / "balanced answer"        | 50%   |
| "3" / "75% depth" / "detailed answer" / "thorough answer"       | 75%   |
| "4" / "100% depth" / "exhaustive answer" / "full deep dive"     | 100%  |

If the user set a level earlier in the session, **maintain it silently** for subsequent responses unless they change it.

## Precision note

This skill uses heuristic estimation — no real tokenizer. Accuracy ~85-90%, variance ±15%. Always show the disclaimer.

## Examples

### Triggers

- "Give me the short version first."
- "How many tokens will your answer use?"
- "Respond at 50% depth."
- "I want the exhaustive answer, not the summary."
- "Dame la version corta y luego la detallada."

### Does Not Trigger

- "What is a JWT token?"
- "The checkout flow uses a payment token."
- "Is this normal?"
- "Complete the refactor."
- Follow-up questions after the user already chose a depth for the session

## Source

Standalone skill from [TBA — Token Budget Advisor for Claude Code](https://github.com/Xabilimon1/Token-Budget-Advisor-Claude-Code-).
Original project also ships a Python estimator script, but this repository keeps the skill self-contained and heuristic-only.
