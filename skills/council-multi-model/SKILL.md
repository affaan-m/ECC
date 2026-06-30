---
name: council-multi-model
description: Extend the council with one heterogeneous-review node. After the four Claude voices draft a verdict, a non-Claude model (Codex) red-teams the draft to catch the same-source blind spot that Claude-only voices share. Includes a preflight that checks whether the Codex SDK is usable and falls back to the plain council when it is not. Use for ambiguous decisions where you worry several Claude voices could miss the same thing.
metadata:
  origin: ECC
---

# Council - Multi-Model

The `council` skill convenes four advisors for an ambiguous decision, but all four are Claude: the in-context voice plus three Claude subagents. Their errors are therefore **correlated** - a verdict Claude drafts and only Claude voices review can share the same blind spot.

`council-multi-model` adds exactly one node on top of `council`: after the Claude voices produce a verdict **draft**, a **heterogeneous (non-Claude) model** reviews that draft. It does not join the debate; it only red-teams the draft, attacking the self-favoring that happens when a model both writes and judges its own conclusion.

The heterogeneous reviewer is **Codex**, reached through the `openai-codex` SDK, which reuses a local ChatGPT subscription and so spends no API credits. This aligns with the Codex tooling the repository already ships (`scripts/codex`, `orchestrate-codex-worker.sh`). Because not every machine has Codex configured, the skill **preflights** availability and falls back cleanly to the plain Claude-only council when it is absent.

This skill is a thin extension. Run `council` for everything except the new node; this file only describes what is added.

## Who decides (settled by council; do not change)

- **You (the user) decide.** The models only sharpen the disagreement and review the draft; they do **not** emit a machine verdict.
- **No voting** - multi-model errors are correlated, and voting amplifies confidence in a wrong answer.
- **No standing judge** - a large judge model rubber-stamps a "confident but wrong" majority and is often the same source as the debaters.
- **No-consensus is a legal end state** - if it cannot be resolved, label it "no consensus" rather than forcing a verdict.
- **Anti-anchoring** - present the un-collapsed disagreement first, then the draft plus the heterogeneous review, and let the user decide last.

## When to use / when not

Same as `council` (ambiguous decisions, explicit tradeoffs). **Additional trigger:** when you worry that several Claude voices would share the same blind spot - that correlation is what the heterogeneous review exists to break.

Do not use for: code review (use `code-reviewer`), implementation breakdown (`planner`), architecture design (`architect`), or plain factual questions (answer directly).

## Workflow

Steps 1 to 5 are identical to `council`: extract the real question, gather minimal context, form the in-context Architect position first, launch the three Claude voices (Skeptic / Pragmatist / Critic) in parallel with only the question and compact context, then synthesize a verdict **draft** with the bias guardrails. The only change: step 5 produces a **draft**, because it must pass the heterogeneous review below.

### 5.5 Heterogeneous review (the added node)

**First, preflight.** Check whether the Codex SDK is usable before relying on it:

```bash
SKILL="$HOME/.claude/skills/council-multi-model"
# one-time: build the venv if missing
[ -x "$SKILL/.venv/bin/python" ] || bash "$SKILL/scripts/setup.sh"
# is the heterogeneous reviewer actually usable here?
"$SKILL/.venv/bin/python" "$SKILL/scripts/check_codex.py" --probe
```

`check_codex.py` prints `AVAILABLE` (exit 0) when the SDK is installed and ChatGPT auth is present, or `UNAVAILABLE: <reason>` (non-zero) otherwise. If it is **UNAVAILABLE**, skip straight to marking the review **absent** (below) and present the plain Claude-only council - do not block.

**If AVAILABLE**, feed the **step 5 verdict draft** plus the **step 4 raw disagreement** to Codex. Let it **review only**; do not let it enter the debate. Write the review prompt to a file to avoid shell escaping, then call:

```bash
"$SKILL/.venv/bin/python" "$SKILL/scripts/ask_codex.py" \
    --prompt-file /path/to/review_prompt.txt --role heterogeneous-review
```

Review prompt shape (write into `review_prompt.txt`):

```text
You are a heterogeneous reviewer auditing a decision draft produced by
another model (Claude). You do not join the debate; you only find faults.

Original disagreement:
[the key disagreements from the step 4 voices]

Draft under review:
[the step 5 verdict draft]

Answer only:
1. Where does this conclusion not hold? (cite the exact reasoning step)
2. What is missing? (failure modes / edges the draft does not cover)
3. Was the strongest opposing view unfairly suppressed? If so, restate it
   plus the cost if it is correct.
4. One line: would you sign off? If not, say why.
Be direct, no pleasantries.
```

**Guardrails:**

- Quote the heterogeneous review **verbatim**; do not paraphrase it (paraphrase re-contaminates it with the same-source Claude wording the node exists to escape).
- If Codex is unavailable or the call fails (preflight UNAVAILABLE, rate limit, network), label it **"heterogeneous review absent"** and proceed; never pretend a review happened.

### Present for the user's decision (anti-anchored order)

```markdown
## Council - Multi-Model: [decision title]

### Un-collapsed disagreement (read this first)
- Architect / Skeptic / Pragmatist / Critic: 1-2 sentences of position each, plus one reason

### Claude synthesis draft
- [the verdict draft]

### Heterogeneous review (quoted verbatim)
> [the Codex output, unedited - or "heterogeneous review absent" with the reason]

### Over to you
- Consensus: ...
- Strongest dissent: ...
- Did the heterogeneous review sign off: [its pass/fail conclusion, or absent]
- Open items (if any): ...
- You decide: [if unresolved, list 2-3 candidate paths for the user to pick; do not pick for them]
```

## Heavy-decision upgrade (optional, off by default)

If the decision is especially heavy, also add Codex as a **fourth independent voice** in step 4 (double insertion): launch the three Claude voices in parallel and, at the same time, ask Codex for an independent position. By default it only reviews in the node above, to save calls.

## Dependencies and self-check

- `scripts/check_codex.py` - preflight: is the Codex SDK importable and is ChatGPT auth present. Run it first; fall back to the plain council on UNAVAILABLE.
- `scripts/ask_codex.py` - the heterogeneous-review call via the `openai-codex` SDK, reusing the ChatGPT subscription (no API spend). Read-only sandbox: it opines, never edits.
- `scripts/setup.sh` - one-time `.venv` (python3 + openai-codex). The `.venv` is gitignored, not committed.
- The heterogeneous model defaults to Codex. If it cannot be reached, the skill degrades to `council` and marks the review absent.

## Persistence

Same as `council`: persist only when the review materially changed the recommendation. Do not write a running log.

## Related

- `council` - the single-source (Claude-only) four-voice version; this skill's parent.
- `santa-method` - adversarial verification.
