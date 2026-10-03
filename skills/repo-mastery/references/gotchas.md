# Gotchas — Failure-Point Checklist

> **Read in**: all phases. Self-check with this list at the start of the main flow, on exceptions, and before Phase 4 output. Absorbed from docs-to-course's `gotchas.md`, with repo-mastery-specific traps added.

## Preview phase (recon)

- [ ] **Preview creating `.learning/` or touching the engine** — `/repo-mastery
  preview` is zero-side-effect recon: the macro brief lives in chat only; no
  `.learning/` scaffold, no Mission/map confirmation, no engine calls. It ends
  with zero artifacts (see `references/preview-brief.md` §3).
- [ ] **Preview inventing peer differentiation** — preview's vs-peer rows follow
  the same `[src]`/`[web]` discipline as `positioning-brief.md`; unsourced
  claims are marked "facts to verify", never fabricated.
- [ ] **Re-reconning in start after a preview** — a "deep-dive" hand-off reuses the
  preview brief as Phase 2's value-brief input instead of rescanning the repo.

## Course-map & clarification phase

- [ ] **Over-coarse knowledge points** — "understand the system architecture" is not a judgeable unit. Split to "dependency direction between modules / complete request call chain / config load precedence".
- [ ] **Modules without evidence** — every module in the map points to a real file/dir. No evidence → cut it; better fewer than hollow.
- [ ] **Skipping Phase 2 confirmation** — the user must approve/customize the map (with Mission). This is an explicit requirement; don't skip.
- [ ] **Concluding too early in the pre-scan** — Phase 1 only maps; conclusions belong to the explanation phase.
- [ ] **Batching Mission decision-tree questions** — the Mission root is one-at-a-time (see `clarification-interview.md`); course-map adjustments, by contrast, are confirmed in **one batch** with follow-up only on adjusted modules.
- [ ] **Blank-prompt decisions** — every decision question carries the tutor's evidence-based recommendation; assessment questions (Phase 3) never do.
- [ ] **Clarifying without a value brief** — Phase 2 must first present what this repo can teach and what makes it stand out vs peers (see `clarification-interview.md` §0), before asking "what do you want to master". Skipping it makes the Mission groundless.
- [ ] **Designing `memory` points as gate-able knowledge points** — parameter/command/API trivia is reference-note material (cheatsheet), never a knowledge point with a gate. Put it in the module's reference notes.
- [ ] **Running the ecosystem scan in Phase 1** — Phase 1 stays repo-internal and objective; peer/ecosystem facts belong in Phase 2's `positioning.md`, never the pre-scan (see `SKILL.md` Phase 2 "External retrieval").
- [ ] **Clarifying differentiation without a source** — the value brief's "stands out vs peers" is read from `.learning/positioning.md`, never improvised; an unsourced peer claim is marked "facts to verify", not a fact (see `clarification-interview.md` §0).
- [ ] **Producing the positioning matrix only after the Mission** — the two-pass rule of `positioning-brief.md`: generalized draft *before* the Mission interview, prune/deepen *after*. Producing it once, post-Mission only, loses the pre-Mission breadth.

## Learning-session phase

- [ ] **Letting the LLM replace the gate** — never use "do you feel you've got it?" instead of `compute_mastery` / `mastery_assess`.
- [ ] **Blank-prompt grinding** — learning interaction gives a reference answer and lets the user react to the proposal (grill-me style); never make the user answer from an empty prompt. For procedure's graded question the reference answer is shown right *after* answering, for self-check.
- [ ] **Expected-answer leakage before grading** — for procedure's graded question the answer is never shown *before* the user answers (grading stays honest); shown right *after* for self-check. It lives only in `progress.json.pending_question`. (Concept/design's reference answer is part of the discussion, not hidden.)
- [ ] **Dumping multiple concepts at once** — one knowledge point, one layer.
- [ ] **Re-posing the same question** — when below 0.9, pose a different question to avoid memorizing the answer.
- [ ] **Skipping error diagnosis** — answering the question directly without user self-attribution and an `error_records` entry corrupts review priority.
- [ ] **Feynman that only asks "got it?"** — the qualitative gate must make the user actually restate the reference answer in their own words (not just nod); design type must probe tradeoffs.
- [ ] **Gating tutor-memory peer facts as knowledge points** — peer/ecosystem claims are facts in `.learning/positioning.md` (`[web]` / `[src]`), never gate-able `memory` points; a `[unv]` claim never sits behind a Feynman/quiz reference answer. Vs-peer answers come from the matrix (see `mastery-policy.md` §6).
- [ ] **Skipping the overviews** — learning must open with the global overview (and each module with its module overview) before any per-node teaching; jumping straight into nodes loses the whole picture (learner field feedback). Engine-enforced: while `flow_phase` is `overview`/`module_overview`, `next-objective` refuses points.
- [ ] **Resuming straight into a knowledge point** — a resume (`continue`, or the bare command that routes into it) always opens with the **Session Preamble** first: value replay (from `MISSION.md`) + current map + progress + due-review signpost, all display-only, no questions. Don't open a node before the preamble.
- [ ] **Skipping `set-phase`** — after presenting an overview you must advance `flow_phase` (`set-phase module_overview --module m01`, then `set-phase learning`); otherwise `next-objective` keeps refusing new points and the session stalls.
- [ ] **Blocking review on an unfinished overview** — scattered-time review is `/repo-mastery review` (`--mode review`), which bypasses the `flow_phase` gate and drains only due reviews. Don't let an unfinished overview stop the user's review moment.
- [ ] **Per-point quiz grinding** — discussion and explanation come first; verification follows and stays lightweight. Don't turn every point into an interrogation.
- [ ] **Cramming the whole repo into context** — read only the relevant files for the current point (locate via `code-map.json` in large repos).
- [ ] **Substituting re-reading for retrieval** — rereading/summarizing creates an "illusion of learning" (recognition ≠ recall). Review must force recall (see `quiz-design.md`), never re-read.
- [ ] **Consecutive same-type reviews** — interleave knowledge types in a review session; grinding one type trains discrimination poorly (`next_objective` prefers a different type from `last_review_type`).
- [ ] **Forcing module 0 on a learner who cut it** — m00 is recommended but droppable; pushing it after the user declined stalls the Mission ("use it / hack internals" → cut; the global overview's differentiation teaser still covers the value).

## Textbook-mode (chapter) phase

- [ ] **`chapter_complete` without rebuilding the review queue / without writing `knowledge_types`** — `_rebuild_review_queue` reads `knowledge_types` and drops points whose type is missing (treated as `memory`); a covered module's unverified points then never enter review. Always write `knowledge_types[kp]` and call the rebuild.
- [ ] **`chapter_start` while `flow_phase` is still `overview`/`module_overview`** — chapter-start validates `flow_phase == learning`; starting a chapter mid-overview leaves a dangling half-state (the chapter gate would fight the overview gate).
- [ ] **Skipping `set-qualitative` after a passed concept/design check** — a passed Feynman judgment must be written via `set-qualitative` (writes `qualitative_mastery` **and** initialises the point's spaced review); flipping the boolean by hand leaves the point unscheduled for review.
- [ ] **Entering a new module in interactive mode by default** — textbook-mode chapter is the default on entering each new module; after the module overview, auto-start it (`chapter-start`) with one line of notice, don't silently offer per-point nodes. Switch to per-point only when the learner asks for it, for that module.
- [ ] **Dumping the textbook once and skipping the section walk** — `chapter` mode means the tutor teaches the material section by section (`chapter-advance`), not generating a document and moving on. A one-shot material dump has no teaching, no Q&A, no gate.
- [ ] **Advancing to the next section without the user's confirmation** — after each section the tutor MUST stop and hand control back ("This section is done — any questions? If none, we move to the next section.") and wait for an explicit user reply before `chapter-advance --section N`. Chaining multiple sections in one turn is a violation even if every call is valid — the engine can't see the conversation, so the pause is the tutor's job. Same pause before teaching → `--status qna`.
- [ ] **After-class checking that misses the module's key nodes** — the 1–2 deep questions must land on the module's critical knowledge points and go through the engine (`set-qualitative` / `record-attempt`), not trivia.
- [ ] **Reading "chapter done" as "module mastered"** — `chapter-complete` covers the module but does not fake mastery; unchecked points are verified later via spaced review. Never write a mastery score for a point the learner never actually answered (fluency ≠ storage).
- [ ] **Showing a covered module's points as unmastered** — in `status` / `COVERAGE.md`, a point whose module is in `chapter_covered_modules` is labelled "Covered · awaiting review verification", a third state between unmastered and mastered (real engine records). Listing it under the unmastered column misreads "studied, awaiting review verification" as "not studied".

## Hands-on phase

- [ ] **Running mutating commands without approval** — read-only commands may run directly; writing files / installing deps must be shown and approved first.
- [ ] **Treating the user's demo as evidence without qualifying it** — a procedure point's hands-on pass = mastery evidence, but record the result; don't just say "nice".
- [ ] **Non-verbatim commands** — commands/config the user will copy must be exact; don't invent flags.

## Mission & learning-records phase

- [ ] **Starting without the Mission** — Phase 2 must first ask "why do you want to master this repo" and write MISSION.md; skipping makes module choices groundless.
- [ ] **Not updating a changed Mission** — when the learning goal shifts, update MISSION.md and write a learning record.
- [ ] **Not writing a learning record when due** — when the user shows real understanding / states prior knowledge / a misconception gets corrected, write `records/NNNN-slug.md`; otherwise the ZPD baseline drifts.
- [ ] **Not marking supersession after a correction** — mark the old record `Status: superseded by LR-NNNN` instead of deleting (the evolution history is useful).
- [ ] **Applying saved global preferences to a new course** — a fresh `start` (or the bare command on a dir with no `.learning/`) must be **clean**: do not inherit `~/.repo-mastery/profile.md` style/depth/language preferences; the current input language and the new Mission drive it. Global memory is consulted only on explicit request.
- [ ] **Routing `continue` by global memory instead of the current dir** — `continue` resumes the current directory's `.learning/`; if there is none, say so and guide to `start` on the current dir. Never jump to a project listed in `~/.repo-mastery/index.json` because it was "last learned".

## Notes & data phase

- [ ] **Rewriting whole notes** — notes append incrementally, never full rewrites (token economy).
- [ ] **Rewriting user note text** — `/note` content is kept verbatim; the tutor only registers blockers.
- [ ] **Re-consolidating what auto already wrote** — `/repo-mastery note` consolidates the **interval since the last note** (`notes/.boundary.json`), deduplicated against the per-turn auto diary; re-summarizing already-written key points is wasted tokens (see `session-flow.md` §6.5).
- [ ] **Inventing pre-compaction interval content** — when the note interval starts before a context compaction (cross-session resume), recover from `notes/<module>.md` + `records/` and mark unrecoverable detail "to revisit"; never fabricate take-aways the tutor can no longer see.
- [ ] **Interval spanning modules consolidated into one note** — when the interval's discussion crosses modules, route each part to its own module's note; `notes/.boundary.json` records the last-consolidated module.
- [ ] **Skipping the first note because there's no boundary** — no `.boundary.json` means the interval is from session/module start, not "nothing to consolidate"; write the boundary after the first note.
- [ ] **Non-atomic `progress.json` writes** — temp file + rename, or the learning state can corrupt.
- [ ] **Forgetting to update global memory** — update `~/.repo-mastery/index.json` (where you left off) each turn, or `continue` breaks.
- [ ] **Full wrap-up on a mechanical turn** — a review drain, simple confirmation, or Q&A digesting with no new conclusion earns **slim wrap-up** (write-back + index.json + one-line report); auto-consolidate is skipped and deferred to the next substantive turn, so the "always fresh on substance" diary never becomes "always rewritten" (see `session-flow.md` §7).
- [ ] **MASTERY.md going stale** — refresh the status dashboard (progress / mastery % / review due / next objective) on every substantive wrap-up and via `/repo-mastery status`; the Session Preamble reads it, so a stale MASTERY means a stale preamble (see `session-flow.md` §8).
- [ ] **Full preamble on a same-session continue** — a session whose context already holds Mission / map / progress gets the **slim preamble** (one line: last position + next objective + due count, from `MASTERY.md`); re-replaying value/map the user just saw is wasted tokens (see `session-flow.md` §0).

## Phase 4 output phase

- [ ] **Waiting until learning ends to build the course doc** — the course note (COVERAGE.md / HTML) is generated at Phase 2 confirmation as a first draft, then updated module-by-module as learning progresses (learner field feedback); don't synthesize only at the end.
- [ ] **Regenerating the HTML shell** — `styles.css` / `main.js` / `_footer.html` / `build.sh` are only copied verbatim from `references/html-shell/`, never rewritten.
- [ ] **HTML biased to UI step-strips** — this skill's HTML course centers on architecture diagrams / dependency graphs / call chains, not UI screenshots.
- [ ] **COVERAGE.md missing source references** — the complete course doc must carry `file:line` references, or it loses its "traceable back to source" value.
- [ ] **Interactive elements using ad-hoc classes** — follow `html-shell/interactive-elements.md`'s class/data-* conventions; the CSS/JS won't cover invented classes.
