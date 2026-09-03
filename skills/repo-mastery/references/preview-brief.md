# Preview Brief (read before Phase 0, optional)

> **Read in**: before Phase 0 (optional pre-flight). The user has a new repo
> and may only want to see "what it is, what the architecture looks like, how
> it differs functionally, what's worth learning deeply" — **whether to start a
> course is decided later**. `preview` is that scouting entry — it **only
> produces a macro brief in chat**: no `.learning/`, no engine, no files
> written (zero side effects).

## 1. Trigger

`/repo-mastery preview <local-path | github:owner/repo>` — user wants to scout
first; has not yet committed to starting a course.

## 2. Output — the macro brief (in chat, five sections)

1. **What it is（这是什么）** — one-line positioning + tech stack + scale (lines
   of code / top-level module count; for very large repos `index_repo.py` may
   be used ad hoc to produce a `code-map.json` for orientation, but **not
   persisted to `.learning/`**).
2. **Architecture panorama（架构全景）** — entry → core data flow → key modules,
   a 1–2 paragraph narrative (reuses the Phase 3.0 global-overview output
   style, see `session-flow.md`).
3. **Functional differentiation vs peers（功能差异点）** — 2–4 lines, tagged
   `[src]` / `[web]` (source discipline identical to `positioning-brief.md`:
   repo facts `file:line`, peer facts `[web]` + URL, uncited facts marked
   「待验证」, never fabricated; **preview does not persist `positioning.md`** —
   that full matrix is built only when `start` opens a course).
4. **Key implementation highlights（关键实现亮点）** — 3–5 points most worth
   learning, each with `file:line` evidence.
5. **Suggested deep-dive candidates（建议深学候选）** — which modules/points
   warrant a course (feeds the `start` course-map proposal).

## 3. Zero side effects (hard)

- No `.learning/`; no MISSION / positioning / course-map / progress / notes.
- No engine (no state change); `index_repo.py` only ever produces a temporary
  `code-map.json` for very large repos (in `/tmp` or read in place, **not**
  into `.learning/`).
- No Mission clarification, no map confirmation — that belongs to `start`.
  preview ends and leaves nothing behind.

## 4. Handoff to start (deep-dive)

User says deep-dive（深学）→ in the same session, run `/repo-mastery start
<repo>` directly. The preview brief's content (architecture narrative +
differentiation + highlights) becomes the input to start's Phase 2 value brief,
so start skips the redundant re-scouting (Phase 0 complexity check + Phase 1
pre-scan re-read) and proceeds through: Phase 1 course-map proposal → Phase 2
value brief + Mission/confirmation. preview persists nothing; `start` builds
the formal files from the brief (MISSION.md / positioning.md / course-map.json).

Cross-session handoff (user says deep-dive later) → `start` re-runs Phase 0/1/2
and the brief is regenerated at `start` time.

## 5. Relationship to positioning-brief.md

preview is **lightweight scouting** (in-chat brief, nothing persisted, no
matrix); positioning-brief is **course positioning** (Phase 2 builds the full
`positioning.md` comparison matrix that drives course trimming). Both share the
same `[src]` / `[web]` source discipline; preview never writes `positioning.md`
and never builds the positioning matrix.
