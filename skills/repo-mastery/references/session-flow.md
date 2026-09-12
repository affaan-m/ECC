# Session Flow — Learning Session Protocol (overview-first, discussion-driven)

> **Read in**: Phase 3. This is the operating manual for each learning turn. The tutor acts per this protocol every turn; decisions consult the rules in `mastery-policy.md`.

## 0. Session preamble: Session Preamble + Mission + ZPD (absorbed from the teach skill)

Before each learning session:

0. **Session Preamble** (SKILL.md "Session Preamble", **mandatory** on every
   resume — `continue`, or the bare command that routes into it, display-only —
   no questions). **New course vs resume**:
   - **New course** (current dir has no `.learning/`, or a fresh `start` on a
     new target): start **clean** — do NOT read `~/.repo-mastery/` preferences
     or `index.json`; teaching language follows the user's current input.
   - **Resume** (current dir has `.learning/`): the preamble below reads the
     current dir's files. Global memory (`~/.repo-mastery/profile.md`) is
     referenced **only if the user explicitly asks** ("use my saved
     preferences").
   **Layered by session
   type**: a **cross-session resume** (fresh session / long gap) replays the
   **full preamble** — **value replay** (read `MISSION.md` + `positioning.md`
   when present; one line: what this repo teaches + differentiation — the
   "stands out vs peers" part is read from `positioning.md`, never improvised),
   **current map + progress** (read `MASTERY.md` — the one-page status
   dashboard, §8: module list, done X/Y, mastery %, review due, current
   module/chapter, next objective), and **due review / chapter** (if
   `next_objective` returns `action: "review"`, recall first, signposted; if
   `action: "chapter"`, resume the textbook-mode chapter from its current
   section; entering a new module defaults to the textbook-mode chapter flow).
   A **same-session continue** (context already holds Mission / map / progress)
   uses the **slim preamble** — one line: "Last session: learned X, next Y, N
   reviews due",
   read from `MASTERY.md`, no re-replay. Only after this does the cursor
   advance.

1. **Recall warm-up** (absorbed from claude-teach-skill): pose **2–3 quick
   recall questions** drawn from `review_queue` (due first, then soonest
   `due_at`). Each answer goes through `record_attempt` (updates mastery /
   difficulty / stability / schedule). A forgotten point → re-teach it before
   anything new, and record the error. This forces retrieval from storage, not
   recognition. A correct warm-up answer feeds `consecutive_correct` →
   `stability`, so a good warm-up streak lengthens the next interval.
   (*memory-only content is never warm-up material — it's reference notes.*)

2. **Read MISSION.md** — why the user wants to master this repo. Align every explanation, question, and Feynman follow-up to the Mission (learning to use it? to modify it? to teach it?). If the Mission isn't filled in, ask — don't guess.
2. **Read `records/` + `progress.json`** — judge the user's **zone of proximal development (ZPD)**: the next thing to teach should be "just challenging enough". Don't re-teach what the user has proven; bridge missing prerequisites before leaping.
3. Then enter the phase below. For a fresh session this is the **global overview**; otherwise the module/node selected by `next_objective`.

## Overview-first (the whole picture before the nodes)

Learning starts with **the whole knowledge organization, then key-node
discussion** — not point-by-point grinding (learner field feedback). This order
is **engine-enforced**: `progress.json.flow_phase` gates `next_objective`
(`overview` → `module_overview` → `learning`; missing defaults to `learning`),
so while an overview is unfinished the engine refuses to hand out knowledge
points. Two non-graded levels, run in this order, advancing the phase with
`set-phase` after presenting each level:

**Phase 3.0 — Global overview** (once, at the start of learning):
deliver a one-page **architecture narrative** (entry → core data flow → key
modules), a **module map** (each module in one line), **key-implementation
highlights**, and a **differentiation summary** ("what makes this project stand
out vs peers" — reuse the one-liner/rows from `.learning/positioning.md`, see
`positioning-brief.md`; the full matrix stays there, see positioning.md).
Write it to `notes/overview.md`. No grading, no interruption — the learner sees
the skeleton before any node. Then advance:

```bash
python3 scripts/learning_engine.py set-phase <path>/.learning/progress.json module_overview --module m01
```

**Phase 3.1 — Module overview** (at the start of each module): deliver that
module's knowledge-point map + its local **cheatsheet** (verbatim commands /
parameters, auto-accumulated from `reference_notes`). Then advance:

```bash
python3 scripts/learning_engine.py set-phase <path>/.learning/progress.json learning
```

After the overviews, each knowledge point runs the per-point loop below. The
engine's `next_objective` stays the cursor — it just never returns `memory`
points (reference-only). Scattered-time review uses `/repo-mastery review`
(`--mode review`), which bypasses the `flow_phase` gate and drains only due
reviews — an unfinished overview never blocks it.

## Per-point learning loop (single knowledge point) — interactive supplement

The **supplement** to the default textbook-mode chapter, for three narrow uses:
**test-out** (an already-known point is skipped via `next_objective`'s `probe`,
not re-taught chapter-long), **single-point deep-dive** (deeper on one knowledge
point), and **post-review reteach** (a failed review point retaught at point
level). Run the flow for the action `next_objective` returns. **Core loop**
(**discussion-first**: explain and discuss are the default; verification is
lightweight and follows the explanation, never the other way around):

```text
overview (global + module)            ← once each, not per point
   → explain (from source, discussion)
   → reference answer + discuss (user reacts to the proposal, grill-me style)
   → verify: Feynman recital (concept/design) | light question + self-check (procedure) | none (memory→cheatsheet)
   → error_diagnosis (if wrong/stuck)
   → review (spaced-review scheduling, concept/design/procedure only)
   → write back progress.json + auto-note
```

## Textbook-mode chapter flow (flipped classroom)

**The default on entering each new module.** After the module overview, the
tutor auto-starts this flow (`chapter-start`) unless the learner asks for the
interactive per-point mode for that module (conversational switch — no flag, no
persistence; one line of notice first, not a confirmation gate). Instead of the
per-point loop above, a module is learned as a **complete chapter** first, then
checked as a whole. Engine actions per step (`chapter_start` /
`chapter_advance` / `chapter_complete` / `set-qualitative`; see
`mastery-policy.md` §7 for the `chapter` state):

```text
1. generate chapters/<module>.md   (full teaching material; its HTML page is generated with the HTML course — confirmed at start + refreshed on completion, output to .learning/export/)
     → chapter-start --module <m> --sections N      (validates flow_phase=learning, module exists, not covered, no pending)
2. walk the chapter section by section    tutor explains section by section; the user follows the material and may interrupt with questions anytime
     → [must pause after each section] give a natural confirmation point; call chapter-advance --section N only after an explicit user reply
       (supports interrupt/resume); never advance multiple sections in a row without confirmation
     → after all sections, pause for confirmation the same way before advance --status qna
3. after-class Q&A → status=qna          user asks freely; the tutor answers and digests (may write a learning record)
4. after-class checking → status=verifying  pose 1-2 deep questions on the chapter's key nodes:
     concept/design → deep Q&A + tutor judgment → set-qualitative --kp <id> --type concept|design --pass|--fail
     procedure     → pending_question + record-attempt (reuse the existing mechanism) + optional hands-on run verification
5. chapter-complete                      module-level gate: key nodes keep their real records; unverified points get initialized
                                         spaced-review; module added to chapter_covered_modules
```

Each section's source walk **pastes the relevant source directly** — a `file:line` locator, an inline key fragment (3-15 core lines), and the full source in a `<details>` collapsible block (see `note-template.md`). The tutor reads the source from the repo (or `code-map.json`/`briefs/` for large repos) and pastes it, instead of only citing the location.

**Section-by-section confirmation (mandatory).** After finishing each section the
tutor **stops and hands control back** — never auto-advance. Give a natural
confirmation point ("This section is done. Any questions? If not, let's move on
to the next."), then
**wait for an explicit user reply** (a question, or "continue / got it"). Only after the
user confirms does the tutor call `chapter-advance --section N`. Use the same
pause before advancing out of `teaching` into `--status qna` (after-class Q&A). The
engine cannot see the conversation, so *this pause is the protocol's job, not
the engine's* — chaining several sections in one turn is a violation even if
every `chapter-advance` call is individually valid.

The chapter's **after-class reflection questions must align with the course-map `knowledge_point_ids`** —
that is what lets after-class checking go through the engine's gate
(`set-qualitative` / `record-attempt`). Large repos: pre-extract source
snippets into `briefs/<module>.md` (module-brief-template) before writing the
chapter, to save tokens.

When `next_objective` returns `action: "chapter"`, the tutor **resumes that
chapter** (it outranks due review in auto mode; `due_review_count` signposts how
many reviews are waiting at the next natural pause). `mode="review"` bypasses
the chapter gate so scattered-time review never blocks mid-chapter.

## 1. explain — discussion-first (the default station)

- **Discussion is the main event.** Explain from source, then **invite the
  learner to engage**: ask what they think, compare with what they know, let
  them push back. The pacing is conversational, not a Socratic interrogation.
- **Explain from source, not from air**: cite specific files, functions, call chains (`file:line`).
- Follow the per-module arc absorbed from docs-to-course: *"why care" first (1–2 sentences of practical payoff) → concept + one fresh metaphor → look at the code / walk the call chain → recap (3–4 takeaways)*.
- **Auto-consolidate** the section's discussion into the module note after explaining (see `note-template.md`); this stays the per-turn diary — `/repo-mastery note` does the *interval* consolidation instead (see §6.5). Explanations are substantive turns: they always earn a consolidation; mechanical turns defer theirs to the next substantive one (see §7).
- Control length: one knowledge point, one layer at a time — don't dump three concepts at once.
- **Light diagnostic on first contact (test-out)**: before teaching a fresh
  point, one open question — "in your own words, what does this point do?" — so
  an already-known point is skipped, not re-taught. This is the gate-as-cursor
  compression path, not a per-point quiz.
- **`memory` content → cheatsheet**: parameters / commands / API spellings are
  *auto-accumulated verbatim* into the module's "Command / config cheatsheet"
  and marked covered — **no quiz, no gate** (they don't build transferable
  skill; see `curriculum-design.md`).

## 2. reference answer + discuss (grill-me style, the default follow-up)

- After explaining, **present a reference answer**: the standard one-line
  statement of this point, with `file:line`. The learner **reacts to this
  proposal** — agree, push back, ask where it differs from their mental model,
  or restate it in their own words. This is "reacting to a proposal, not
  staring at a blank prompt" (absorbed from mattpocock's `grill-me`).
- **No independent blank-prompt answering** for concept/design — the reference
  answer is the material the learner engages with. The judgment (next step)
  rests on the *quality of the reaction*: did they catch the key mechanism, can
  they restate it, can they point at what would change?
- For `procedure`, the reference answer is the **graded question's answer,
  shown right after the user answers** (self-check) — never shown *before*, so
  the attempt stays honest.

## 3. verify — Feynman recital (qualitative gate, concept / design)

- After the reference-answer discussion, have the user **restate the point in
  their own words** — "now put the reference answer in your own words as if I'm
  a beginner." The expected answer is **not hidden to test recall** — the user
  already saw it; the judgment is whether they can *critically engage with and
  restate* it.
- **concept**: judge "what + why + relation to adjacent concepts" — can they
  move beyond the reference answer's phrasing to their own mental model?
- **design**: add design-tradeoff follow-ups (see `mastery-policy.md` §6) —
  "why not the alternative?" probes whether they adopted the idea or only
  echoed the reference answer. For ecosystem points (`m00`), add the **vs-peer
  probing** questions from `mastery-policy.md` §6 (swap / decision / boundary);
  the reference answer cites its source — repo facts `file:line`, peer facts
  the `positioning.md` row + `[web]` URL. Never improvise an unsourced peer
  claim into the reference answer.
- Result → `qualitative_mastery`; not passed → back to explain + reference
  answer, record the error type.
- **Input form**: the user types their recital in chat (no voice requirement).

## 4. verify — quantitative gate / hands-on (procedure only)

### Lightweight question with self-check (procedure — never memory)
- Follow `quiz-design.md` (**test application, not memory**). Parameter/flag
  spelling is never quizzed — that is reference-note material.
- **The expected answer lives in `progress.json.pending_question` — never shown
  before the user answers** (the attempt stays honest).
- **Immediately after the user answers, show the reference answer** for
  self-check: "compare with what you said — where did you diverge?" Judge the
  attempt = answer + self-check correction, then record it via the **engine
  script** (deterministic, tool-agnostic):
  ```bash
  python3 scripts/learning_engine.py record-attempt <path>/.learning/progress.json \
      --kp <kp_id> --type procedure --correct --question <qid> --write
  ```
- Advance only when the script reports `passed_gate: true` (≥ 0.9); otherwise
  return to explain + practice more (pose a *different* question).

### Hands-on on demand (procedure especially)
- Guide the user to actually verify: "verify it now — run `pytest tests/test_x.py`" or "write a 20-line demo calling this API."
- **Command convention**:
  - Read-only/no-side-effect commands (`build`, `test`, `--help`, `git log`): may run directly.
  - Mutating operations (writing files, installing deps, writing data): **show the command and request approval first**.
- Record the hands-on result (passed/behavior/user's demo code) as mastery evidence for that point.

## 5. error_diagnosis — when wrong or stuck

- First ask the user to self-attribute: "where do you think you got stuck?" (`self_attribution`).
- The tutor classifies `error_type` (structural / deviation / application / metacognitive; see `mastery-policy.md` §5) and writes an `error_records` entry (status=active).
- Create the matching review task (that point's review priority → 1).
- Reteach: targeted explanation for the error type, then practice again.

## 6. review — due spaced-review tasks

- Pull due tasks by `scheduler`'s `next_review_at` (triggered by `/repo-mastery review`, or automatically when `next_objective` finds something due).
- Review form: one question per due point (quantitative) or a quick recital (qualitative).
- Review stays **recall-first** (that's the point — retrieval after
  forgetting), but a stuck user is never left staring at a blank prompt: offer
  the reference answer as a **catch-up** when they ask or after one
  attempt, record the error, and reschedule. Retrieval intent is preserved
  without grinding the user.
- Results update `repetition_states` + `review_queue`.
- **Interleave types**: when several reviews are due, alternate knowledge types
  (memory → concept → procedure → design) instead of grinding one type; `next_objective`
  already prefers a type different from `last_review_type`.
- **Covered modules' points review too**: points in `chapter_covered_modules`
  carry real `repetition_states` and appear in the queue — covered ≠ forgotten.
  `--mode review` drains them even mid-chapter.

## 6.5 `/repo-mastery note ["<text>"]` — interval consolidation (manual complement)

The per-turn **auto-consolidate** (after every explanation / judgment / other
**substantive** turn — see §1 / §7; **mechanical turns defer it to the next
substantive one**) keeps the module note fresh as a **per-turn diary** and stays
**unchanged**. `/repo-mastery note` is the **manual interval complement**: it
consolidates the discussion **since the last note** — not what auto already
wrote — and distills it into the note. Execute it this way:

1. **Interval start**: read `notes/.boundary.json`
   (`{"module_id": ..., "last_consolidated_at": <unix>}`). Present → the interval
   is that boundary → now; absent (first note) → from session / module start.
2. **Extract the interval**: from context, pull that interval's Q&A conclusions,
   new blockers, cheatsheet additions, Feynman records, and the user's own
   words. If the interval start predates a context compaction (cross-session
   resume), recover from `notes/<module>.md` + `records/` — unrecoverable detail
   is marked needs-review, never invented.
3. **Consolidate into `notes/<module>.md`** (route to each module's note when the
   interval spans modules):
   - **Key points / Q&A / cheatsheet / blockers / Feynman** sections: **deduplicated**
     — only what auto hasn't already written (re-writing it is wasted tokens).
   - A **`### Interval synthesis (<ISO date> <UTC>, since last note <time>) — <one-line recap>`**
     block: 2–4 distilled takeaways + any new Mission links. This is note's
     differentiator — auto is the per-turn diary, note is the interval synthesis.
   - `<text>` (if given) → **verbatim** into "My notes" (never rewritten; may be
     registered as a blocker/review point).
4. **Update boundary**: write `notes/.boundary.json` →
   `{"module_id": <current module>, "last_consolidated_at": <now unix>}`.
5. **Refresh index**: if `notes/README.md` exists, refresh that module's line
   (don't create it — respect the current layout).

**Iron rules**: never re-write what auto already consolidated; never fabricate
pre-compaction content; the tutor writes `.boundary.json` directly — the engine
is untouched.

## 7. End of each turn — layered wrap-up

Close each turn at the depth its content earned. Two layers:

**Substantive turn** — an explanation, a judgment, an error diagnosis, or a new
conclusion: **full wrap-up**.
1. **Atomically write back** `progress.json` (temp file + rename).
2. **Auto-consolidate** the module notes (`notes/<module>.md`); `/repo-mastery
   note` interval consolidation (see §6.5) is the manual, on-demand complement
   — it doesn't replace this.
3. Update global `~/.repo-mastery/index.json` (where you left off).
4. **Refresh `MASTERY.md`** — the one-page status dashboard (see §8), so
   "where am I" reflects this turn's state.
5. Report to the user in one line: current progress (e.g. "module 3/6, points
   7/24, mastery 45%").

**Mechanical turn** — a review drain, a simple confirmation, or Q&A digesting
with no new conclusion: **slim wrap-up** — steps 1, 3, 5 only. **Skip
auto-consolidate and the MASTERY refresh**: the next substantive turn's
consolidation covers this stretch (its interval runs from the last
consolidation), so nothing is lost — the diary is "always fresh on substance",
not "always rewritten".

Engine write-back (step 1) is already built into `record-attempt` /
`set-qualitative --write`; it is a *tutor* action only when progress.json needs
a direct state change.

## 8. MASTERY.md — the one-page status dashboard

`/repo-mastery status` reads `progress.json` + `course-map.json` and writes
`MASTERY.md` — the single page where "where am I" lives. Sections:

- **Progress** — modules covered X/Y (`chapter_covered_modules`), verified
  points N/M, current module + chapter section/status.
- **Mastery** — overall % and per-knowledge-type lines (from `mastery_levels` /
  `quiz_attempts` / `qualitative_mastery`); chapter-covered modules carry the
  "Covered · awaiting review verification" display convention, never "unmastered".
- **Review due** — `review_queue` count + earliest `due_at`; `--mode review`
  drains it.
- **Next objective** — what `next_objective` returned (review / chapter /
  knowledge point), so the next session resumes instantly.

**Refreshed** by `/repo-mastery status` explicitly, and automatically on a
substantive turn's full wrap-up (§7). Mechanical turns don't refresh it — their
state changes surface on the next substantive refresh. The Session Preamble
(§0) reads it, display-only.

**Division vs COVERAGE.md** — COVERAGE.md is the **content** note
(explanations, cheatsheet, blockers, notes; grows with learning). MASTERY.md is
the **state** note (numbers + next step; regenerated from JSON, never
hand-written). Status lives in MASTERY.md, not in COVERAGE.md's header.

## Tutor voice during sessions

- You're present (Claude Code session); advance one knowledge point at a time; never cram the whole repo into context.
- Explain from source, judge by engine — **never replace the gate with "do you feel you've got it?"**.
- A stuck user is a diagnostic signal, not a teaching failure — guide self-attribution.
- Keep momentum: close the loop on one point per turn where possible (judge + write back + note).
- Ask **one question at a time** (batching is bewildering). When a decision is needed, offer your evidence-based recommendation with the question; assessment questions (quiz / Feynman) never carry a hint (absorbed from the grilling skill).

## Token-saving rules for large repos

- When learning a point, only Read files relevant to it (locate via `course-map.json` evidence paths / `code-map.json`); **don't read the whole repo**.
- Large repos: consult `code-map.json`'s symbol table to locate `file:line`, then Read the needed slice.
- Once source snippets are captured in notes, prefer reading the notes over re-reading source in later sessions.

## Failure recovery — concrete steps when something breaks

- **`set-phase` fails** → read the current `flow_phase` from `progress.json`,
  re-run `next-objective` (the CLI subcommand; `next_objective` is the
  engine's function/return value — don't type the underscore form) so the
  cursor resumes from the actual phase, then retry the matching command
  (`set-phase ... module_overview --module mNN` while the overview is
  unfinished, else `set-phase ... learning`).
- **`chapter-advance` rejected by the engine** → read the error and branch:
  (a) the message says "no active chapter" → re-run `chapter-start
  --module <m> --sections N` first; (b) invalid `--status` → pass a valid
  `teaching|qna|verifying`. Separately, as a protocol rule: after each section,
  pause and wait for an explicit learner reply before advancing — never chain
  sections in one turn (the engine can't see the conversation).
- **`.boundary.json` missing** → the interval starts at the session / module
  start (first note), not an invented earlier boundary. Consolidate from there,
  then write the boundary (`{"module_id": ..., "last_consolidated_at": <now unix>}`).
- **Value brief with no search tool** → degraded repo-evidence mode: build the
  brief from repo facts only, mark unsourced peer rows `[unv]`, and **never
  fabricate a source** (see `positioning-brief.md` §Source rules).
