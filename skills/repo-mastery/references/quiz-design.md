# Quiz Design — Principles (Test Application, Not Memory)

> **Read in**: Phase 3, when posing quantitative questions. This principle is absorbed from docs-to-course's `content-philosophy.md`, adapted for "code understanding".

## The iron rule: test application, not memory

The value of a question is: **a wrong answer reveals "can't use / don't understand", not "didn't memorize"**. Definitions are the job of a glossary tooltip, not a quiz.

**What to test (best first)**:
1. **"What would you do" scenarios** — "to add feature X to this project, which extension point/module would you use?" Gold standard.
2. **Tracing** — "which modules does this request pass through, from entry to storage?" Tests call-chain understanding.
3. **Troubleshooting scenarios** — "startup fails with `ImportError: xxx` — most likely cause and first thing to check?"
4. **Tradeoff/decision questions** — "for task Z, would you pick A or B? Why?" Tests design understanding.
5. **Ecosystem-pick questions** — "this repo or <peer> for setup Z — which and why? Under what conditions would the other win?" Tests positioning understanding (module 0). The canonical vs-peer probes live in `mastery-policy.md` §6 — cross-reference those, never maintain a second source here.
6. **"What is it / why"** — short definition + one why.

**What NOT to test**:
- ❌ Verbatim definitions (that's memory, and scrollable).
- ❌ **Exact flag/argument spelling, CLI commands, parameter names** — these are
  reference-note material (cheatsheet), never quizzed. They're numerous,
  project-specific, and don't build transferable skill (learner field feedback;
  see `curriculum-design.md`). The engine never gates on `memory` points.
- ❌ Anything answerable by scrolling up.

## Question formats (for code learning)

| Form | Use for | Example |
|---|---|---|
| Multiple choice (with scenario) | fast grading, most memory/procedure | "which is the correct config-load precedence? A) … B) … C) …" |
| Sequencing | call chains / flows | "arrange build → install → launch in the real order" |
| Fill-in / short answer | procedure, must write it | "after `deeptutor kb create`, which command searches the KB?" |
| Small code change | understanding a function's behavior | "change one line here to make it output X — which line?" |

## Tone of grading and feedback

- **Wrong answers get encouraging, teaching explanations**: "not quite — B is right here because A bypasses the config-loading layer…" Never punitive, no score anxiety.
- Correct answers **reinforce the principle**, not just praise.
- Quantity: 1–3 questions per point is enough to judge; don't inflate.

## Option formatting: no clues (absorbed from the teach skill)

- In multiple choice, keep **every option roughly equal in length** — don't let "the long one is right" leak the answer.
- Avoid "all of the above / none of the above" cop-out distractors.
- Distractors should look real — taken from genuinely confusable configs/modules/calls, not invented.

## Retrieval practice: learning vs review (absorbed from the teach skill)

**Learning a new point is reference-answer-first, not blank recall** (learner
field feedback; absorbed from mattpocock's `grill-me`): after explaining, give
the reference answer and let the user **react to the proposal** — agree, push
back, restate in their own words. There is **no independent blank-prompt
answering** for concept/design.

**Review stays recall-first**: the whole point of spaced review is retrieving
after forgetting. But a stuck user gets the reference answer as a catch-up,
never a grinding blank prompt:

- Short-answer/fill-in > recognition multiple-choice for review turns: being able to write the call chain proves storage better than recognizing the right option.
- Frame multiple-choice as "scenario → what would you do", so the user forms the answer in their head before comparing options.
- For a graded procedure question during learning, the user answers first, then you **immediately show the reference answer** for self-check.

## Reference-answer interaction (grill-me style)

The default interaction for learning a new point:

1. **Explain** the point from source (discussion-first).
2. **Present a reference answer** — the standard one-line statement, with `file:line`.
3. **User reacts to the proposal**: agree, push back, ask where it differs from
   their understanding, restate it in their own words.
4. **Judge the reaction** — the quality of the engagement (did they catch the
   mechanism, can they restate it, can they point at what would change), not a
   verbatim recall.

**Boundary** (the one place the answer is withheld): a **graded** procedure
question keeps the expected answer in `progress.json.pending_question` and
never shows it *before* the user answers; it is shown *right after*, for
self-check. That is the only case where the answer is hidden at all.

## How grading drives mastery

- Each attempt appends to that point's `quiz_attempts`.
- `compute_mastery` recomputes (recency-weighted + confidence ceiling; see `mastery-policy.md`).
- ≥ 0.9 advances; below → back to explain, then pose a **different question** (never the same one — avoid memorizing the answer).

## When not to quiz

- A point already has 2 correct attempts and mastery ≥ 0.9 → pose a harder "deepening" question or just advance.
- The user explicitly wants to hear the explanation first → respect the pace, explain first.
- A hands-on verification (procedure) already passed → it counts as evidence; no need to pile on a pointless question.

## Flashcard quality standards (absorbed from the flashcards skill)

A quiz/review card is a **self-test, not a reading note**. These rules govern how to craft **`memory`-type and review cards**; the iron rule above still holds — application questions remain the gold standard for comprehension points. Quality rules:

1. **Force recall, not recognition** — ask open questions where the answer must
   be reconstructed, not recognized from options.
2. **One card, one fact** — each card asks exactly one thing; keep it short.
3. **One unambiguous answer** — the question has a single correct answer.
4. **Answer ≤ 3 lines** — a too-long answer can't be retrieved.
5. **Understanding before memorizing** — cover fundamentals first, then build up.
6. **Elaborate and connect** — link the fact to something known, a vivid image, a
   concrete example; extra retrieval paths make recall easier.
7. **Context built into the question** — good: "What does `git stash pop`
   restore?"; bad: "[Git] What does stash pop do?"
8. **Break up lists** — split enumerations into single questions, or use
   overlapping cards (A then B, B then C).
9. **Distinguish similar concepts** — give confusable items distinguishing context.
10. **Ask both directions** — A→B and B→A strengthen retention.
11. **Timestamp perishable facts** — add "as of [year]" to current numbers.

Avoid: trivial facts, answers longer than three or four lines, ambiguous
questions, opinions instead of facts, lists as an answer.

> Low-effectiveness techniques to avoid: summarizing, highlighting, and rereading
> create **illusions of learning** (recognition ≠ recall). A tutor must never
> substitute "re-read the summary" for a retrieval question.
