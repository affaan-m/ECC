---
name: repo-mastery
description: "Turn any open-source repository into a developer-focused mastery course. Given a local repo path or GitHub URL, build a confirmed course map and drive overview-first learning (architecture picture, then key-node discussion, then spaced review) with hands-on tasks and a continuously-updated course note (Markdown + HTML). Triggers: 'learn this repo', 'master this codebase', 'turn X into a course', 'deep-dive into X project'."
origin: personal
version: 3.2.0
tags: [learning, education, codebase, mastery, spaced-repetition]
---

# Repo-Mastery — Master an Open-Source Project from Source

## When to Activate
- user wants to learn/master/deep-dive an open-source repo or codebase
- user got new project source and wants systematic learning
- user wants architecture + key implementations from source (not usage docs)
- user wants progress to persist across sessions (spaced review + notes)
- triggers: "learn this repo", "master this codebase", "turn X into a course"

Do NOT activate for doc/README summaries, one-off code Q&A, or end-user tutorials — that is docs-to-course.

## Setup
- Target: local path or github:owner/repo (auto git clone --depth 1)
- Python 3: only for the large-repo index (scripts/index_repo.py, pure stdlib)
- Creates .learning/ in the target (auto-gitignored). ~/.repo-mastery/ (profile + index) is an OPT-IN profile — not read automatically; consulted only when the user explicitly asks for saved preferences. The current directory's .learning/ is the sole automatic state source.
- Teaching language follows the user's input (--language zh|en to force); code, paths, identifiers keep original form
- Runs on Claude Code / Codex / Gemini CLI / AGENTS.md tools (agentskills.io)

## Commands
(6 commands — each: signature + one imperative line)
/repo-mastery preview <path|url>    # zero-side-effect recon: macro brief in chat, no .learning/, no engine. Say "deep-dive" (or the user's language for "go deeper") to hand off into start.
/repo-mastery start [path|url] [--language zh|en] [--fresh]   # value brief → map confirm → overview-first learning (textbook-mode chapter per module by default); path defaults to the current directory; --fresh restarts an existing course.
/repo-mastery continue              # resume the current directory's .learning/ (session preamble first, then next-objective). If none, say so and guide to start on the current dir — never jump to a project from global memory.
/repo-mastery review                # spaced review only: drain due reviews, bypass overview gate, never open new content.
/repo-mastery note ["<text>"]       # consolidate discussion since last note into notes/<module>.md (categorized); <text> appended verbatim.
/repo-mastery status                # refresh MASTERY.md one-page dashboard from progress.json + course-map.json.

(Bare /repo-mastery routes by the current directory: has .learning/ → continue; no .learning/ → start a course on the current directory. The shared due-review pool: continue runs next-objective end-to-end and signposts due reviews; review drains them alone and bypasses the flow_phase overview gate. Preview is zero-side-effect: brief in chat, handoff on "deep-dive". Both continue and review loop next-objective, act on the returned action (overview | module_overview | chapter | answer_pending | review | complete), and stop on a non-review action.)

(Gate invariant — always hold: advancement is a deterministic engine decision, never an LLM self-assessment; mastery is built from real attempts, never faked.)

## Session Preamble (mandatory on every resume)
- New course (current dir has no .learning/ / fresh start): start clean — do NOT read ~/.repo-mastery/ preferences or index.json; teaching language follows the user's current input.
- Resume (current dir has .learning/): read the current dir's MISSION.md + positioning.md (value replay) → MASTERY.md (map + progress) → due review/chapter first. Display-only, no questions. Global memory (profile.md) is referenced only if the user explicitly asks ("use my saved preferences" / 「用我之前的偏好」).
- Same-session: one line — "Last learned X, next objective Y, N reviews due" (Chinese example: 「上次学到 X，下一步 Y，due N 条复习」).
- Then advance per next-objective. While flow_phase is overview/module_overview, next-objective refuses knowledge points (engine-enforced).

## Main Flow (/repo-mastery start)
Phase 0 — Complexity: <100k lines small/medium (read directly); ≥100k or ≥20 top-level modules large (run scripts/index_repo.py → code-map.json). See references/index-script-spec.md; measure with find + wc -l when unsure.
Phase 1 — Pre-scan → course-map candidates: objective map (README, entry, structure, build, core modules); generate candidates per references/curriculum-design.md. Repo-internal only (no ecosystem scan yet).
Phase 2 — Value brief + Mission + map confirm: deliver the value brief (what this repo can teach + differentiation) per references/clarification-interview.md §0 + references/positioning-brief.md (external retrieval for peer facts; [src]/[web]/[unv] discipline); clarify Mission one question at a time with recommended answers; present the full module list at once, user replies all adjustments in one batch, follow-up only on adjusted modules; pass_threshold defaults 0.7. Learning starts only after approval. Then write .learning/ (MISSION.md, positioning.md, course-map.json), set-phase overview, generate first-draft COVERAGE.md.
Phase 3 — Overview-first learning: next-objective is gated by flow_phase — present global overview (Phase 3.0) → set-phase module_overview --module m01 → present module overview → set-phase learning → per-point learning. In each module: textbook-mode chapter by default (see Textbook Mode); per-point interactive mode is a supplement (test-out / single-point deep-dive / post-review reteach), switched conversationally. Learning loop: explain from source → give reference answer → user reacts → judge (Feynman recital for concept/design; lightweight scenario question + self-check for procedure) → error diagnosis → spaced review. Reference answer first, never a blank prompt; expected answer shown after for graded procedure questions. Hands-on on demand (read-only commands run; mutating requires approval). Auto-consolidate substantive turns into notes/<module>.md. See references/session-flow.md, mastery-policy.md, quiz-design.md.
Phase 4 — Continuously-generated course note: COVERAGE.md generated at Phase 2, updated per module; HTML course decided once at start (reuse references/html-shell/, copy verbatim), refreshed at completion. MASTERY.md is the status dashboard (regenerated by status).

## Textbook Mode (chapter) — default on entering each module
Five steps (engine-gated):
1. Generate chapters/<module>.md (intro → sections [each = one knowledge point: explain + source walk file:line + recap + review questions aligned to knowledge_point_ids] → chapter summary → cheatsheet) → chapter-start.
   Each section's source walk pastes the relevant source (file:line locator + inline key fragment + collapsible `<details>` full source) — see `note-template.md`.
2. Walk section by section; after each section STOP and wait for explicit user reply before chapter-advance --section N.
3. Q&A (status=qna): user asks freely.
4. Verification (status=verifying): 1-2 deep questions on key nodes → set-qualitative / record-attempt.
5. Complete (chapter-complete): module-level gate — covered points get initialized spaced review (not fake mastery); module joins chapter_covered_modules; points still enter review queue. Status shows three states: 未掌握 / 已覆盖 · 待复习验证 / 已掌握 (not-yet-learned / Covered · awaiting review verification / mastered) — covered ≠ mastered.

## Data Structures
<target-repo>/.learning/: MISSION.md, positioning.md, course-map.json, progress.json, MASTERY.md, records/, notes/ (incl .boundary.json), chapters/, briefs/, code-map.json, export/, .gitignore
~/.repo-mastery/: profile.md, index.json   (opt-in profile — not read automatically; consulted only on explicit request)

Expected answers of pending questions live server-side in progress.json — never round-trip to the user before grading.

## Reference Files (read per phase)
- curriculum-design.md (P1), positioning-brief.md (P2), preview-brief.md (preview), clarification-interview.md (P2), mastery-policy.md (P3), session-flow.md (P3), quiz-design.md (P3), module-brief-template.md (P3 large), note-template.md (P3), learning-records-template.md (all), gotchas.md (all), index-script-spec.md (P0 large), example-walkthrough.md (any), html-shell/ (P4)

## Scripts
- scripts/learning_engine.py — the deterministic gate. Call for compute-mastery / schedule / record-attempt / next-objective / set-phase / chapter-* / validate-map / init. Never re-derive the math.
- scripts/index_repo.py — large-repo index (pure stdlib).
- scripts/install.sh — install to Claude Code + Codex + Gemini CLI.

## Related Skills
- docs-to-course: docs → end-user usage course (source of methodology).
- understand-anything: knowledge-graph of a codebase (pair for architecture deep dives).

## Verification
Self-check with references/gotchas.md; confirm: .learning/ gitignored; course-map.json confirmed; progress.json atomic; notes on substantive turns + ~/.repo-mastery/index.json updated; no expected-answer leakage; no unapproved mutating commands.
