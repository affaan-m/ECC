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
- Reference-answer restatement in the learner's own words (not nodding along) →
  forces reconstruction that exposes gaps the given answer can hide; during
  review it is true retrieval from storage.
- Spaced review (delayed review) → only what survives forgetting counts as storage.

**ZPD (zone of proximal development)**: what to teach next = challenge "just enough". Its inputs = `records/` (established understanding) + `progress.json` (mastery) + Mission (why the learner is here). Don't re-cover what's mastered; don't leap too far.

## 1. Knowledge types and gates

| type | Gate kind | Pass condition |
|---|---|---|
| `procedure` | quantitative | recency-weighted accuracy ≥ **0.9** (with the key hands-on task passing as evidence) |
| `concept` | qualitative | tutor judges the reference-answer restatement passed (`mastery_assess`) |
| `design` | qualitative | tutor judges the restatement + design-tradeoff follow-ups passed |

> **`memory` has no gate.** It is a reference-notes type (cheatsheet), not a
> knowledge-point type — see `curriculum-design.md`. The engine still accepts
> `memory` in old maps for backward compatibility but treats it as already
> covered (`is_mastered` returns true) and never creates review tasks for it, so
> it can never block advancement.

**Design axiom**: quantitative types (procedure) use exact grading because most have a single correct answer; concept/design use qualitative judgment because "why is it designed this way" has no single canonical answer — this is exactly how DeepTutor splits it.

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

## 3. Spaced-repetition scheduling (FSRS-inspired personalization)

Base interval sequence per type (days), as before:

| type | interval sequence |
|---|---|
| `memory` | `[0, 1, 3, 7, 14, 30]` |
| `concept` | `[3, 7, 14, 30]` |
| `procedure` | `[3, 7, 14]` |
| `design` | `[14, 28]` |

**Personalization parameters** — each knowledge point carries two learned
values (FSRS-inspired, simplified to pure deterministic math; see `ADOPTION.md` §6):

- `difficulty` (0.1–1.0, default 0.5): how hard this point is for the learner.
- `stability` (1.0–5.0, default 1.0): how durable the memory is.

**Update rules** (`schedule_next`):

- Correct:
  - `consecutive_correct += 1`; if `≥ 2` → index +2; else +1.
  - `difficulty = max(0.1, difficulty − 0.05)`.
  - `stability = min(5.0, stability × (1 + 0.2 × min(consecutive_correct, 5)))`.
- Wrong:
  - `consecutive_wrong += 1`; index steps back 1 (floor 0); if `≥ 2` → reset.
  - `difficulty = min(1.0, difficulty + 0.15)`.
  - `stability = max(1.0, stability × 0.5)`.

Index is clamped to `[0, max_index]`.

**Effective interval** (replaces `next_review_at = now + interval[index]`):

```text
effective_days = base_days[interval_index] × stability × (1 − difficulty × 0.5)
next_review_at = now + effective_days × 86400
```

- Higher `difficulty` → shorter interval (review sooner).
- Higher `stability` → longer interval (defer).

**Priority** (unchanged): error-record points get priority 1; else by type
`memory:2 / concept:3 / procedure:4 / design:5`.

**Interleaving** (`next_objective`): among due reviews of equal priority, a
review whose `knowledge_type` differs from `progress.last_review_type` is picked
first, so consecutive reviews interleave types instead of stacking one type.

## 4. What to learn next (`next_objective`)

**Advancement is computed from what is already mastered — never from a stage counter.** Priority, high to low:

1. **A pending question** (`pending_question`) → grade it first (`answer_pending`).
2. **The `flow_phase` gate** — the whole picture comes before the nodes. When
   `flow_phase` is `overview` → `{action: "overview"}`; `module_overview` →
   `{action: "module_overview", module_id: current_module_id}`. While the gate is
   open the engine **refuses to hand out knowledge points**. A missing
   `flow_phase` (old data) is treated as `learning` — the gate is skipped,
   point-by-point continues (backward compatible).
3. **The chapter gate** (textbook mode) — an in-progress `chapter` resumes it:
   `{action: "chapter", module_id, module_name, chapter_status, section_index,
   sections, due_review_count}`. Chapter learning is a continuous run, so a
   resume continues the chapter, not a node; `due_review_count` signposts the
   reviews waiting at the next natural pause.
4. **A due review** → review first, so mastered ground doesn't decay (`review`).
5. **The first unmastered knowledge point** (by module order, then point order),
   **skipping modules in `chapter_covered_modules`** — a module whose chapter
   gate passed is *covered*: its points were either engine-verified at after-class
   checking or get validated via spaced review, never re-offered as fresh nodes.
   The skip lives in the module-iteration layer, NOT in `is_mastered` (which has
   no `module_id`). Their due reviews still surface (step 4) — covered ≠ forgotten.
   - **`memory` points are skipped outright** — reference-only, never a next objective (engine-level; old maps stay valid).
   - Never touched → `probe` (test whether it can be skipped — **test-out path**: already-proven points are skipped, not forced through fixed stages).
   - Quantitative type below its gate → `practice` (keep working it until it clears).
   - Qualitative type → `assess` (Feynman check).
6. **All mastered and nothing due** → `complete`.

`NextStep` actions: `answer_pending / overview / module_overview / chapter / review / probe / practice / assess / complete`.

**`mode: "review"`** (the `/repo-mastery review` command): skips the `flow_phase`
gate, the **chapter gate**, and the unmastered-point step — pending question →
due review → complete. So an unfinished overview *or* an in-progress chapter
never blocks scattered-time review; review drains only what is due (including
covered modules' points) and says `complete` when nothing is.

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

The user sees the **reference answer first** (see `session-flow.md` §2) — the
judgment is whether they can *critically engage with and restate* it, not
verbatim recall. Pass criteria for the Feynman check on concept/design points:

- **concept**: the user can restate the reference answer in their own words —
  "what + why + relation to adjacent concepts" — moving beyond its phrasing to
  their own mental model. Can't → not passed → return to explanation +
  reference answer, record the error type.
- **design**: beyond the restatement, add design-tradeoff follow-ups — "why not
  the alternative? in what scenario would it fail? where is the extension
  point?" Being able to answer the tradeoffs = mastery; echoing the reference
  answer without engaging the tradeoffs ≠ mastery.

**Causal questioning** (absorbed from RetainCraft): after the restatement, push
with causal probes to expose whether understanding is causal or merely echoed —
"why this design instead of X?", "if we swapped Y in, what would break and
where?", "which single change flips this behavior?" Causal answers count as
mastery evidence; vague recall does not.

**Vs-peer probing (ecosystem points, `m00`)** — the canonical three questions
for module 0 / any design point whose reference answer involves a peer
comparison (single source of truth; `quiz-design.md` and `session-flow.md`
only cross-reference this). Pick the applicable one(s); the peer facts must be
in `.learning/positioning.md` (cited `[web]` / `[src]`), never tutor memory:

- **Swap** — "if we swapped this repo for <peer> in the setup your
  Mission motivates, what breaks, what survives, and where does the migration
  pain concentrate?" Passing = naming concrete touchpoints from the matrix
  rows, not a vague "it'd be different".
- **Decision** — "give me the decision rule: under what conditions
  is <peer> the right pick, and under what conditions is this repo? Point to
  the matrix row that makes the call." Passing = a transferable criterion, not
  a feature list.
- **Boundary** — "this repo chose X over Y vs <peer>. What scenario
  makes that choice *fail* — where does X's weakness show?" Passing = naming
  the failure mode on the other side of the tradeoff, echoing neither side.

An unsourced vs-peer claim is a "facts to verify" search seed, never the reference
answer behind these probes.

Qualitative results live in `qualitative_mastery: {kp_id: bool}`; the map shows full value once passed, but the judgment itself is a boolean, not a score.

## 7. Progress data structure (`progress.json`)

```jsonc
{
  "repo": "owner/name",
  "diagnostic": { "module_mastery": {} },
  "flow_phase": "learning",             // overview | module_overview | learning (missing → learning)
  "current_module_id": "m01",           // module whose overview is pending (module_overview phase)
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
  "repetition_states": { "kp01-01": { "interval_index": 0, "consecutive_correct": 0,
                                       "consecutive_wrong": 0, "difficulty": 0.5,
                                       "stability": 1.0, "next_review_at": 1754571490 } },
  "review_queue": [ { "id": "review_kp01-01", "knowledge_point_id": "kp01-01",
                      "knowledge_type": "procedure", "due_at": 1754571490, "priority": 1 } ],
  "pending_question": { "question_id": "q3", "knowledge_point_id": "kp01-01",
                        "prompt": "...", "question_type": "short", "expected_answer": "..." },
  "chapter": { "module_id": "m01", "status": "teaching",   // textbook mode: teaching | qna | verifying
               "section_index": 2, "sections": 5 },       // (absent when no chapter in progress)
  "chapter_covered_modules": ["m01"],                     // modules whose chapter gate passed
  "last_review_type": "concept",
  "version": 1
}
```

Key points:

- `flow_phase` (`overview` → `module_overview` → `learning`) gates
  `next_objective`: while an overview is unfinished the engine refuses new
  points. Missing defaults to `learning` (old data continues point-by-point).
  `current_module_id` records which module's overview is pending. Advance via
  `set-phase <progress> <phase> [--module <id>]`.
- `pending_question.expected_answer` **lives server-side (this file)** and never round-trips to the user — grading never drifts (DeepTutor's `PendingQuestion`).
- All timestamps are Unix seconds.
- Once the file exists, **write it back atomically** (temp file + rename) at the end of each turn to avoid corruption.
- `repetition_states[].difficulty` / `stability` are FSRS-inspired personalization
  parameters (default 0.5 / 1.0; missing → treated as defaults for old data).
  `last_review_type` is updated on each attempt and used to interleave review types.
- `knowledge_types` may still hold `memory` (old maps) but the engine never
  builds review tasks for it — memory is reference-only (see `curriculum-design.md`).

### Module-level gate (`chapter-complete`) — review-init rules

Textbook mode (the default chapter flow) ends a module with `chapter-complete`,
the engine's module-level gate. For each **non-`memory`** knowledge point in
the module:

1. **No `repetition_states`** → initialise a fresh first-review state
   (written directly, **never via `schedule_next`** — that would fabricate a
   "answered correctly" record the learner never produced):
   `{interval_index: 0, consecutive_correct: 0, consecutive_wrong: 0,
   difficulty: 0.5, stability: 1.0, next_review_at: now + INTERVAL_SEQUENCES[type][0] * 86400}`.
2. **Has state but not mastered** (procedure: `mastery_levels < 0.9`;
   concept/design: `qualitative_mastery != true`) → **reset** to the same
   first-review state, so a lucky review streak can't inherit a lengthened interval.
3. **Has state and mastered** (key node verified at after-class checking) →
   **keep** the existing state and real engine records
   (`qualitative_mastery` / `quiz_attempts`) untouched.

Always write `knowledge_types[kp_id] = kp_type` and rebuild the review queue
(`_rebuild_review_queue`) — `_rebuild_review_queue` reads `knowledge_types` and
drops points whose type is missing (treated as `memory`), which would silently
remove covered points from review. The module is then added to
`chapter_covered_modules` (dedup) and the `chapter` state cleared.

**Display convention (status / COVERAGE.md)**: a point whose module is in
`chapter_covered_modules` is shown as **"Covered · awaiting review verification"**, not as
unmastered — covered means "module studied, true mastery pending spaced
review", a third state alongside unmastered and mastered (real engine
records). Never list a covered point under the unmastered column. Display
labels localize to the teaching language. English canonical: not-yet-learned /
Covered · awaiting review verification / mastered.

**This gate never fabricates mastery**: unverified points get real spaced
review and build mastery only from actual correct/incorrect attempts — the
"fluency ≠ storage" axiom holds (no fake `mastery_levels`, no broken confidence
ceiling). Key nodes checked after class keep their genuine engine records.

`set-qualitative <progress> --kp <id> --type concept|design --pass|--fail`
records an after-class qualitative judgment: writes `qualitative_mastery[kp]`,
and on `--pass` initialises the point's first review (same fresh state above)
if none exists, then rebuilds the queue — so a passed concept/design point is
scheduled for spaced review instead of being dropped.
