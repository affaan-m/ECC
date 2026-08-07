# Mastery Policy — Mastery, Gates, Spaced Review, Error Diagnosis

> **Read in**: Phase 3. This is the pure decision engine — **no LLM calls, no I/O**. The tutor consults these rules every learning turn. Three core questions: **Is this knowledge point mastered? What should the learner work on next? What does the whole map look like?**

This policy is ported from DeepTutor's `learning/` module (`mastery.py` / `policy.py` / `scheduler.py` / `models.py`), replacing "subject knowledge" with "code knowledge".

> **Every formula in this document is implemented in `scripts/learning_engine.py`.**
> The tutor (in any tool) MUST call the script for gate decisions
> (`compute-mastery`, `schedule`, `record-attempt`, `next-objective`,
> `validate-map`, `init`) rather than re-deriving the math by hand — this keeps
> mastery judgment identical across Claude Code, Codex, Gemini CLI, etc.

## 0. Design rationale: Fluency vs Storage Strength (absorbed from the teach skill)

Distinguish two kinds of "knowing":

- **Fluency**: retrievable in the moment — the "I get it" right after an explanation. It creates the **illusion of mastery**.
- **Storage**: long-term retention — still usable after a gap. This is the real goal.

All mechanisms in this policy fight the fluency illusion:

- Confidence ceiling (one lucky answer ≠ mastery) → prevents fluency masquerading as mastery.
- Feynman recital (not nodding along) → forces retrieval from storage.
- Spaced review (delayed review) → only what survives forgetting counts as storage.

**ZPD (zone of proximal development)**: what to teach next = challenge "just enough". Its inputs = `records/` (established understanding) + `progress.json` (mastery) + Mission (why the learner is here). Don't re-cover what's mastered; don't leap too far.

## 1. Knowledge types and gates

| type | Gate kind | Pass condition |
|---|---|---|
| `memory` | quantitative | recency-weighted accuracy ≥ **0.9** |
| `procedure` | quantitative | recency-weighted accuracy ≥ **0.9** (with the key hands-on task passing as evidence) |
| `concept` | qualitative | tutor judges the Feynman recital passed (`mastery_assess`) |
| `design` | qualitative | tutor judges the recital + design-tradeoff follow-ups passed |

**Design axiom**: quantitative types (memory/procedure) use exact grading because most have a single correct answer; concept/design use qualitative judgment because "why is it designed this way" has no single canonical answer — this is exactly how DeepTutor splits it.

## 2. Quantitative mastery (`compute_mastery`)

```text
Input: a knowledge point's chronological answer correctness [bool, ...]
Take the most recent up-to-5 attempts; weights oldest→newest = (0.5, 0.7, 0.85, 0.95, 1.0)
score = Σ(weight × right/wrong) / Σ(weights)
Confidence ceiling: only 1 recorded attempt → score capped at 0.5; only 2 → capped at 0.8
mastery = min(score, ceiling)
```

Meaning:

- Newer attempts weigh more — recovery after early mistakes is rewarded.
- **One lucky answer is not mastery** — the confidence ceiling keeps mastery below 0.9 until enough evidence accumulates.
- The judgment is deterministic, recorded in `progress.json`, independent of tutor memory.

## 3. Spaced-repetition scheduling

One interval sequence per type (days):

| type | interval sequence |
|---|---|
| `memory` | `[0, 1, 3, 7, 14, 30]` |
| `concept` | `[3, 7, 14, 30]` |
| `procedure` | `[3, 7, 14]` |
| `design` | `[14, 28]` |

**Scheduling rules** (`schedule_next`):

- Correct: `consecutive_correct += 1`; if `consecutive_correct ≥ 2` → index +2; else +1.
- Wrong: `consecutive_wrong += 1`; index steps back 1 (floor 0); if `consecutive_wrong ≥ 2` → reset the counter.
- Index clamped to `[0, max_index]`; `next_review_at = now + interval[index]`.

**Priority**: knowledge points with **error records** (active/retrying status) get priority 1 (highest); otherwise by type `memory:2 / concept:3 / procedure:4 / design:5`. Due review tasks sort by priority.

## 4. What to learn next (`next_objective`)

**Advancement is computed from what is already mastered — never from a stage counter.** Priority, high to low:

1. **A pending question** (`pending_question`) → grade it first (`answer_pending`).
2. **A due review** → review first, so mastered ground doesn't decay (`review`).
3. **The first unmastered knowledge point** (by module order, then point order):
   - Never touched → `probe` (test whether it can be skipped — **test-out path**: already-proven points are skipped, not forced through fixed stages).
   - Quantitative type below its gate → `practice` (keep working it until it clears).
   - Qualitative type → `assess` (Feynman check).
4. **All mastered and nothing due** → `complete`.

`NextStep` actions: `answer_pending / review / probe / practice / assess / complete`.

## 5. Error diagnosis and metacognition

When the learner is wrong/stuck, classify the **error type** (DeepTutor's four categories, mapped to code learning):

| ErrorType | Meaning | Code-learning example |
|---|---|---|
| `structural` | missing prerequisite knowledge/context | "can't understand this async framework because I don't know `asyncio`" |
| `deviation` | a concept is understood wrong | "thought RAG trains the model; it's actually retrieval-augmented" |
| `application` | concept right but wrong scenario | "knows locks exist but used them where they don't apply" |
| `metacognitive` | doesn't know what they don't know | "thought I got it, then the recital exposed the gaps" |

Each error record: `error_type` + user's self-attribution + tutor confirmation + retry history. **Status flow**: `active → retrying → review → graduated`. active/retrying errors raise that point's review priority.

## 6. Qualitative judgment (`mastery_assess`)

Pass criteria for the Feynman check on concept/design points:

- **concept**: the user can explain in their own words "what + why + relation to adjacent concepts". Can't → not passed → return to explanation, record the error type.
- **design**: beyond the recital, add design-tradeoff follow-ups — "why not the alternative? in what scenario would it fail? where is the extension point?" Being able to answer the tradeoffs = mastery.

Qualitative results live in `qualitative_mastery: {kp_id: bool}`; the map shows full value once passed, but the judgment itself is a boolean, not a score.

## 7. Progress data structure (`progress.json`)

```jsonc
{
  "repo": "owner/name",
  "diagnostic": { "module_mastery": {} },
  "modules": [
    { "id": "m01", "name": "Build & environment", "order": 1,
      "pass_threshold": 0.7,
      "knowledge_points": [ { "id": "kp01-01", "name": "...", "type": "procedure" } ] }
  ],
  "mastery_levels": { "kp01-01": 0.42 },       // quantitative mastery 0..1
  "qualitative_mastery": { "kp01-02": true },  // qualitative judgment
  "knowledge_types": { "kp01-01": "procedure" },
  "quiz_attempts": [ { "question_id": "q1", "knowledge_point_id": "kp01-01",
                       "is_correct": false, "error_type": "deviation",
                       "mastery_estimate": 0.0, "timestamp": 1754567890 } ],
  "error_records": [ { "id": "e1", "knowledge_point_id": "kp01-01",
                       "error_type": "deviation", "status": "active" } ],
  "repetition_states": { "kp01-01": { "interval_index": 0, "next_review_at": 1754571490 } },
  "review_queue": [ { "id": "review_kp01-01", "knowledge_point_id": "kp01-01",
                      "due_at": 1754571490, "priority": 1 } ],
  "pending_question": { "question_id": "q3", "knowledge_point_id": "kp01-01",
                        "prompt": "...", "question_type": "short", "expected_answer": "..." },
  "version": 1
}
```

Key points:

- `pending_question.expected_answer` **lives server-side (this file)** and never round-trips to the user — grading never drifts (DeepTutor's `PendingQuestion`).
- All timestamps are Unix seconds.
- Once the file exists, **write it back atomically** (temp file + rename) at the end of each turn to avoid corruption.
