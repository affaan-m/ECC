---
name: council-multi-model
description: Extend the council with a heterogeneous (non-Claude) model in two ways -- (A) reviewing an existing draft/plan/PR to catch the same-source blind spot Claude-only voices share, or (B) proposing independently in parallel (Mixture-of-Agents style) when there is no existing draft yet, then aggregating without collapsing disagreement. For the heaviest decisions the two chain: propose+aggregate first, judge the aggregation second. Includes a preflight that checks whether the Codex SDK is usable and falls back to the plain council when it is not. Use for ambiguous decisions where you worry several Claude voices could miss the same thing, or where you want independent parallel answers instead of one drafted-then-reviewed.
metadata:
  origin: ECC
---

# Council - Multi-Model

The `council` skill convenes four advisors for an ambiguous decision, but all four are Claude: the in-context voice plus three Claude subagents. Their errors are therefore **correlated** - a verdict Claude drafts and only Claude voices review can share the same blind spot.

`council-multi-model` brings in a **heterogeneous (non-Claude) model** to break that correlation, through **two different entries** depending on what you already have:

- **Entry A - Review** (there is already a draft, plan, or PR to critique): the heterogeneous model **red-teams** it. It does not join the debate; it only attacks the self-favoring that happens when a model both writes and judges its own conclusion.
- **Entry B - Propose** (an open question, nothing drafted yet): the heterogeneous model **answers independently in parallel** with the Claude voices - Mixture-of-Agents style - and the independent answers are **aggregated** without silently collapsing disagreement.

For the heaviest decisions, chain them: run **B** first (propose + aggregate), then feed the aggregated result through **A**'s review step for one more independent pass. See "Chaining" below for the honesty caveat this requires.

The heterogeneous reviewer is **Codex**, reached through the `openai-codex` SDK, which reuses a local ChatGPT subscription and so spends no API credits. This aligns with the Codex tooling the repository already ships (`scripts/codex`, `orchestrate-codex-worker.sh`). Because not every machine has Codex configured, the skill **preflights** availability and falls back cleanly to the plain Claude-only council when it is absent.

This skill is a thin extension. Run `council` for everything except the added nodes; this file only describes what is added.

## Who decides (settled by council; do not change)

- **You (the user) decide.** The models only sharpen the disagreement, propose, or review; they do **not** emit a machine verdict.
- **No voting** - multi-model errors are correlated, and voting amplifies confidence in a wrong answer.
- **No standing judge** - a large judge model rubber-stamps a "confident but wrong" majority and is often the same source as the debaters.
- **No-consensus is a legal end state** - if it cannot be resolved, label it "no consensus" rather than forcing a verdict.
- **Anti-anchoring** - present the un-collapsed disagreement (or the un-collapsed independent answers, in Entry B) first, then the draft/aggregation plus any review, and let the user decide last.
- **Aggregation must not blend incompatible approaches into mush** - if two independent answers propose genuinely different approaches (not just different emphasis), list them as **distinct candidates** in the aggregation; do not average them into an incoherent hybrid that nobody actually proposed. This is Entry B's specific failure mode - guard against it explicitly.

## When to use which entry

Same base trigger as `council` (ambiguous decisions, explicit tradeoffs) where you worry several Claude voices would share the same blind spot. Then pick the entry by what already exists:

| You have | Use | Why |
|---|---|---|
| An existing draft, plan, or PR to critique | **Entry A - Review** | Reviewing is cheaper than re-proposing from scratch, and a focused critique catches sharper faults than a second independent answer would. |
| An open question, nothing drafted yet | **Entry B - Propose** | Drafting with Claude-only voices first would already bias the frame before the heterogeneous model ever sees the question. Independent parallel answers avoid that anchoring. |
| An especially heavy decision, either starting point | **Chain B then A** | Get independent proposals first, aggregate, then spend one more independent pass judging the aggregation itself - see Chaining. |

Do not use for: code review (use `code-reviewer`), implementation breakdown (`planner`), architecture design (`architect`), or plain factual questions (answer directly).

## Entry A - Review an existing draft

Steps 1 to 5 are identical to `council`: extract the real question, gather minimal context, form the in-context Architect position first, launch the three Claude voices (Skeptic / Pragmatist / Critic) in parallel with only the question and compact context, then synthesize a verdict **draft** with the bias guardrails. The only change: step 5 produces a **draft**, because it must pass the heterogeneous review below.

### 5.5 Heterogeneous review

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
## Council - Multi-Model (Entry A): [decision title]

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

## Entry B - Propose independently, then aggregate (Mixture-of-Agents style)

Use when there is **no existing draft** - drafting with Claude voices first would bias the frame before the heterogeneous model sees the question at all.

### B1. Extract the real question

Same as `council` step 1: state the actual decision and the minimal context needed to answer it.

### B2. Launch every voice in parallel, fully blind to each other

Not "form a position first, then launch reviewers" - here **everyone answers the same question independently and at the same time**, seeing only the question and the same compact context:

- In-context Architect: writes its **own complete answer** (not a running position to be reviewed later).
- Three Claude subagents (Skeptic / Pragmatist / Critic): each writes its **own complete answer**, same constraint.
- Codex, if the preflight (see Entry A's 5.5) says **AVAILABLE**: also writes its **own complete answer** to the identical question, via `ask_codex.py` with `--role independent-proposal` instead of `--role heterogeneous-review`.

None of the voices see each other's answers before writing. This is the core difference from Entry A: in A, Codex reviews Claude's synthesis; in B, Codex is a **peer proposer**, not yet a reviewer.

### B3. Aggregate without collapsing disagreement

Synthesize the independent answers into one draft. Two rules, both already load-bearing elsewhere in this skill:

1. **Anti-anchoring**: list the un-collapsed independent answers first, exactly as each voice wrote them, before showing the aggregated draft.
2. **No blending incompatible approaches**: if the answers converge on the same approach with different emphasis, synthesize normally. If two or more voices propose **genuinely different approaches**, present them as **distinct labeled candidates** in the aggregation - do not average a REST API design and an event-driven design into a single incoherent hybrid nobody actually proposed.

### B4. Optional judge pass on the aggregation - read the caveat first

For heavy decisions you can spend one more independent pass **judging the aggregation itself** (did it lose a legitimate minority position, does the synthesized approach actually hold together) rather than re-litigating the original answers.

**The honesty caveat**: a judge must not grade an answer it already proposed (same rule as `plan/build/judge` - the judge must be independent). If Codex already proposed in B2, it **cannot** credibly judge the aggregation in B4 - that would be Codex checking its own contribution. With only Claude and Codex available:

- If Codex proposed in B2, **skip B4** and go straight to presenting the aggregation to the user (below) - do not manufacture a "review" that is not actually independent. It is fine to say plainly: "no independent judge available for this aggregation; Codex already contributed to the proposals."
- If Codex was **unavailable** in B2 (preflight failed, so only Claude voices proposed), Codex **can** genuinely judge the aggregation in B4 as a true heterogeneous read, using the same review mechanics as Entry A's 5.5.

### Present for the user's decision (anti-anchored order)

```markdown
## Council - Multi-Model (Entry B): [decision title]

### Independent answers (un-collapsed, read this first)
- Architect: [its complete answer]
- Skeptic / Pragmatist / Critic: [each complete answer]
- Codex (if available): [its complete answer, quoted verbatim]

### Aggregated draft
- [the synthesis - if approaches diverged, list distinct candidates instead of one blend]

### Judge pass on the aggregation (only if B4 ran)
> [quoted verbatim, or "skipped - no independent judge available (Codex already proposed)"]

### Over to you
- Consensus: ...
- Distinct candidates (if the aggregation could not merge them): ...
- You decide: [list the candidates for the user to pick; do not pick for them]
```

## Chaining B then A (heaviest decisions)

1. Run Entry B in full (B1-B4) to get an aggregated draft, with B4 honestly skipped if Codex already proposed.
2. Feed that aggregated draft into Entry A starting at its step 5.5, sourcing "the raw disagreement" from B3's un-collapsed independent answers instead of council's step 4.
3. Because Codex likely already proposed in B2, Entry A's 5.5 heterogeneous review at this point is **not independent either** unless Codex was unavailable in B2. State this plainly in the final presentation rather than silently reusing Codex as if it were a fresh reviewer. If you need a genuinely independent second look and only Claude+Codex are configured, the honest options are: present as-is with the caveat, or hold for a human review - do not fabricate a heterogeneous pass that did not happen independently.

## Dependencies and self-check

- `scripts/check_codex.py` - preflight: is the Codex SDK importable and is ChatGPT auth present. Run it first; fall back to the plain council on UNAVAILABLE.
- `scripts/ask_codex.py` - the Codex call via the `openai-codex` SDK, reusing the ChatGPT subscription (no API spend). Used for both `--role heterogeneous-review` (Entry A) and `--role independent-proposal` (Entry B). Read-only sandbox: it opines, never edits.
- `scripts/setup.sh` - one-time `.venv` (python3 + openai-codex). The `.venv` is gitignored, not committed.
- The heterogeneous model defaults to Codex - currently the only non-Claude model this skill can reach. If it cannot be reached, the skill degrades to plain `council` (Entry A) or Claude-only parallel proposals (Entry B) and marks the gap explicitly rather than hiding it.

## Persistence

Same as `council`: persist only when the review or aggregation materially changed the recommendation. Do not write a running log.

## Related

- `council` - the single-source (Claude-only) four-voice version; this skill's parent.
- `santa-method` - adversarial verification.
