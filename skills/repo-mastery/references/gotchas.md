# Gotchas — Failure-Point Checklist

> **Read in**: all phases. Self-check with this list at the start of the main flow, on exceptions, and before Phase 4 output. Absorbed from docs-to-course's `gotchas.md`, with repo-mastery-specific traps added.

## Course-map phase

- [ ] **Over-coarse knowledge points** — "understand the system architecture" is not a judgeable unit. Split to "dependency direction between modules / complete request call chain / config load precedence".
- [ ] **Modules without evidence** — every module in the map points to a real file/dir. No evidence → cut it; better fewer than hollow.
- [ ] **Skipping Phase 2 confirmation** — the user must approve/customize the map (with Mission). This is an explicit requirement; don't skip.
- [ ] **Concluding too early in the pre-scan** — Phase 1 only maps; conclusions belong to the explanation phase.

## Learning-session phase

- [ ] **Letting the LLM replace the gate** — never use "do you feel you've got it?" instead of `compute_mastery` / `mastery_assess`.
- [ ] **Expected-answer leakage** — the question text/options must never contain the expected answer; it lives only in `progress.json.pending_question`.
- [ ] **Dumping multiple concepts at once** — one knowledge point, one layer.
- [ ] **Re-posing the same question** — when below 0.9, pose a different question to avoid memorizing the answer.
- [ ] **Skipping error diagnosis** — answering the question directly without user self-attribution and an `error_records` entry corrupts review priority.
- [ ] **Feynman that only asks "got it?"** — the qualitative gate must make the user actually recital; design type must probe tradeoffs.
- [ ] **Cramming the whole repo into context** — read only the relevant files for the current point (locate via `code-map.json` in large repos).

## Hands-on phase

- [ ] **Running mutating commands without approval** — read-only commands may run directly; writing files / installing deps must be shown and approved first.
- [ ] **Treating the user's demo as evidence without qualifying it** — a procedure point's hands-on pass = mastery evidence, but record the result; don't just say "nice".
- [ ] **Non-verbatim commands** — commands/config the user will copy must be exact; don't invent flags.

## Mission & learning-records phase

- [ ] **Starting without the Mission** — Phase 2 must first ask "why do you want to master this repo" and write MISSION.md; skipping makes module choices groundless.
- [ ] **Not updating a changed Mission** — when the learning goal shifts, update MISSION.md and write a learning record.
- [ ] **Not writing a learning record when due** — when the user shows real understanding / states prior knowledge / a misconception gets corrected, write `records/NNNN-slug.md`; otherwise the ZPD baseline drifts.
- [ ] **Not marking supersession after a correction** — mark the old record `Status: superseded by LR-NNNN` instead of deleting (the evolution history is useful).

## Notes & data phase

- [ ] **Rewriting whole notes** — notes append incrementally, never full rewrites (token economy).
- [ ] **Rewriting user note text** — `/note` content is kept verbatim; the tutor only registers blockers.
- [ ] **Non-atomic `progress.json` writes** — temp file + rename, or the learning state can corrupt.
- [ ] **Forgetting to update global memory** — update `~/.repo-mastery/index.json` (where you left off) each turn, or `continue` breaks.

## Phase 4 output phase

- [ ] **Regenerating the HTML shell** — `styles.css` / `main.js` / `_footer.html` / `build.sh` are only copied verbatim from `references/html-shell/`, never rewritten.
- [ ] **HTML biased to UI step-strips** — this skill's HTML course centers on architecture diagrams / dependency graphs / call chains, not UI screenshots.
- [ ] **COVERAGE.md missing source references** — the complete course doc must carry `file:line` references, or it loses its "traceable back to source" value.
- [ ] **Interactive elements using ad-hoc classes** — follow `html-shell/interactive-elements.md`'s class/data-* conventions; the CSS/JS won't cover invented classes.
