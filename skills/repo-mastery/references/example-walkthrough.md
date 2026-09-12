# Example Walkthrough — one full course, start to first module

> Read in: any phase. A concrete end-to-end example so a fresh agent can see
> the intended dialogue shape. Uses one real well-known repo — **sqlite/sqlite**
> (the embedded database) — consistently. Protocol lines are English; learner
> replies are quoted as the user actually types them (here Chinese, matching
> the teaching language). The `[src]`/`[web]` tags illustrate the source
> discipline, not real fact-checked claims.

## 1. Preview (recon, zero side effects)

```text
User:  /repo-mastery preview sqlite/sqlite
Tutor: macro brief in chat — five sections, nothing persisted:
       1. What it is — embedded, single-file, public-domain SQL database;
          ~260k lines of C, runs in-process (src/sqlite3.c).
       2. Architecture — sqlite3_open → prepare (SQL → bytecode) → step (VDBE
          loop) → pager/btree behind the cursor.
       3. Differentiation vs peers — 3 rows, tagged:
          · embedded & single-file vs client-server (MySQL/Postgres) — no
            install, no network [web] https://www.sqlite.org/whentouse.html
            (2026-08-12)
          · B-tree storage vs LSM (RocksDB) — read-favor vs write-favor [unv]
          · whole-db test discipline — millions of statements in CI [web]
            https://www.sqlite.org/testing.html (2026-08-12)
       4. Key highlights — pager/WAL crash safety, VDBE bytecode, portable VFS.
       5. Deep-dive candidates — the storage core (pager/btree) and the query
          executor (VDBE) are the richest modules to learn.
Tutor: "That brief was scouting only — zero side effects, nothing written.
        Say 'deep-dive' (or 「深学」) and I'll start the course from here."
User:  「深学」
```

Cross-session: if the user says deep-dive in a *later* session, `/repo-mastery
start` re-runs Phase 0/1/2 and the brief is regenerated at start time.

## 2. Start: Phase 1–2 (pre-scan → value brief → Mission → map confirm)

```text
Tutor: /repo-mastery start sqlite/sqlite --language zh
       Phase 0 — ~260k lines C → large → run `scripts/index_repo.py` → `code-map.json`.
       Phase 1 — pre-scan (repo-internal only): README, main entry, build,
       structure, core modules → course-map candidates per curriculum-design.md.
       Phase 2 — value brief:
         Teaching-capability inventory — crash safety via pager/WAL, bytecode
         execution in VDBE, query planning, portable VFS.
         Differentiation (2–4 rows, sourced) — the same three preview rows.
       "Before we map the course — one question, with my recommendation:
        what's your Mission?  (a) use it safely in a product, (b) modify the
        storage engine, (c) borrow the architecture for your own engine.
        I'd recommend (c): it pulls in pager, btree and VDBE — the deepest
        material."
User:  「想改存储引擎，加一个自定义 VFS」（= b + a bit of c）
Tutor: Writes MISSION.md. "Mission locked: modify storage, add a custom VFS."
       Presents the full module list at once (one batch, no drilling):
         m00 sqlite-as-embedded-DB (positioning, droppable)
         m01 build & first query  (open → prepare → step)
         m02 pager & WAL         (page cache, journaling, crash safety)
         m03 btree               (page format, cursor, B+tree ops)
         m04 VDBE                (bytecode VM)
         m05 query planning
         m06 VFS / OS layer      (portable I/O — your Mission target)
       "Reply with all adjustments in one batch. My recommendation: keep m00
        (teaser only, skip deep-dive) and move m06 up to m02 since your
        Mission targets the VFS."
User:  「好，m06 提前到 m02，m00 只做概览不深入」
Tutor: Re-orders map to m01, m06(VFS), m02(pager/WAL), m03(btree), m04(VDBE),
       m05(planning). Writes .learning/: MISSION.md, positioning.md,
       course-map.json; sets flow_phase=overview; generates first-draft
       COVERAGE.md. "Course confirmed. pass_threshold 0.7."
```

## 3. Phase 3: global overview → module overview → first chapter

```text
Tutor: Phase 3.0 — one-page global overview (entry → core data flow → key
       modules → differentiation teaser from positioning.md), written to
       notes/overview.md. No grading, no interruption.
       set-phase ... progress.json module_overview --module m01
       Phase 3.1 — m01 "build & first query": knowledge-point map + local
       cheatsheet (build flags, sqlite3_open_v2 flags). Then:
       set-phase ... progress.json learning
       "m01 defaults to textbook mode. Generating chapters/m01-build-runtime.md
        and starting it — four sections: (1) open, (2) prepare, (3) step,
        (4) statement lifecycle."
       chapter-start --module m01 --sections 4
       --- section 1 walk (open) ---
       "Why care: every API call funnels through sqlite3_open_v2. Concept:
        the connection owns a pager, and the pager owns the page cache.
        Source walk (three-part, per note-template.md) — the tutor pastes
        the source, not just a pointer:
          · file:line locator:  src/sqlite3.c sqlite3_open_v2 →
              sqlite3_open_internal → pager_open  (locate via
              `code-map.json`'s symbol table, then Read the slice)
          · inline key fragment (teaching core, 3-15 lines), pasted from
              the file: sqlite3_open_v2() → allocates the pager →
              pager_open() — the handoff that makes the connection own the
              page cache
          · <details> full source: the same slice verbatim, collapsed under
              a `<details>` block so the learner can expand it when wanted
        This section is done — any questions? If none, we move on."
User:  「继续，理解了 open 的流程」
Tutor: chapter-advance --section 1   (never before an explicit reply)
       --- section 2 walk (prepare → bytecode) ---  ... STOP, confirm ...
User:  「继续」
Tutor: chapter-advance --section 2  → sections 3–4 walked the same way
       → pause again before after-class Q&A:
       "Sections done. Entering Q&A — ask anything."
       chapter-advance --status qna
User:  「prepare 的结果能缓存复用吗？」
Tutor: answers + digests (auto-consolidates into notes/m01-*.md).
       "Now after-class checking — two deep questions on the key nodes."
       chapter-advance --status verifying
User:  (restates open→prepare→step from source)
Tutor: set-qualitative --kp m01-01 --type concept --pass
       (a second procedure point: record-attempt --kp m01-03 --type procedure
        --correct --question <qid> --write)
       chapter-complete  → m01 covered; points scheduled for spaced review,
       shown as "Covered · awaiting review verification", never as mastered.
```

## 4. Command examples (note / status / review / continue)

```text
/repo-mastery note          — interval consolidation since notes/.boundary.json:
                              before → read boundary; extract the interval's Q&A
                              conclusions, cheatsheet additions, Feynman records
                              (dedup vs the auto diary); after → append an
                              "Interval synthesis" recap + update the boundary.
                              Also /repo-mastery note "用户原文" appends verbatim.
/repo-mastery status        — regenerates MASTERY.md, one page:
                              Progress (modules 1/6, verified points 2/24,
                              current m02 chapter) · Mastery % by knowledge type ·
                              Review due (count + earliest due_at) · Next objective.
/repo-mastery review        — spaced review only: drains due reviews, bypasses
                              the flow_phase overview gate, never opens new
                              content. "2 reviews due — let's recall."
/repo-mastery continue      — Session Preamble first (value replay + MASTERY.md
                              progress + due signpost, display-only), then
                              next-objective resumes. Bare /repo-mastery is
                              the same.
```

## 5. Failure recovery (concrete, imperative)

```text
· set-phase failed →
    1. read progress.json → flow_phase (the actual phase)
    2. re-run next-objective (CLI subcommand) so the cursor resumes there
    3. retry the matching set-phase (module_overview --module mNN while an
       overview is unfinished, else learning)
· chapter-advance rejected by the engine → read the error and branch:
    (a) "no active chapter" → re-run chapter-start --module m01 --sections 4
        first; (b) invalid --status → pass a valid teaching|qna|verifying.
    Protocol rule too: after each section, pause and wait for an explicit
    learner reply before advancing — never chain sections in one turn.
· .boundary.json missing → the interval starts at the session/module start
    (first note), not an invented earlier boundary. Consolidate from there,
    then write {"module_id": ..., "last_consolidated_at": <now unix>}.
· no search tool for the value brief → degraded repo-evidence mode: build the
    brief from repo facts only, mark peer rows [unv], and never fabricate a
    source.
· next-objective returns complete → the course is done: show the final
    COVERAGE.md summary (modules covered, verified points, mastery %), then
    offer: refresh the HTML course from the final COVERAGE.md (HTML build
    step), start over, or switch repos.
```
