# Positioning Brief (read in Phase 2)

> **Read in**: Phase 2. Turns the value brief's "what makes it stand out vs
> peers" from an improvised one-liner into a **sourced, persistent comparison
> matrix**. A developer learning a large open-source project wants to know
> *what it is, how it trades off against its natural peers, and when to pick it*
> before diving into architecture — this brief is that deliverable. Produces
> `<repo>/.learning/positioning.md`.

## Three names, three roles — keep them straight

| Name | Role | Kind |
|---|---|---|
| `references/positioning-brief.md` | this file — the skill's template/protocol (Phase 2) | skill reference |
| `<repo>/.learning/positioning.md` | the per-repo **persistent output** (comparison matrix + sources + decision rules) | learning artifact |
| **value brief** (existing, `clarification-interview.md` §0) | the Phase 2 in-chat proposal (teaching-capability inventory + differentiation) | conversation |

The value brief stays a conversation proposal; it is **not** merged into
`positioning.md`. Its differentiation section is *read from* `positioning.md`
— never improvised on the spot.

## Flow (Phase 2, after the Phase 1 repo-internal pre-scan)

1. **External ecosystem scan** — if a web/search tool is available
   (WebSearch in Claude Code, any MCP search), compare against the repo's
   natural peers. If not, skip straight to a repo-evidence-only brief (see
   Source rules).
2. **Produce `positioning.md` in two passes** (the Mission is settled *after*
   the value brief, so the matrix must not depend on it before it exists):
   - **Pass 1 (before the Mission interview)**: a generalized draft — the
     repo's natural peers, categorized rows. Do not over-research; breadth of
     categories first.
   - **Pass 2 (after the Mission is settled)**: prune/deepen the rows the
     Mission actually cares about (e.g. Mission = "borrow the design" →
     deepen the agent-loop/architecture rows; Mission = "use it" → deepen
     operations/ecosystem rows). Write the 3–5 line summary into `MISSION.md`.
3. **Present the value brief** — differentiation section = 2–4 key matrix rows
   + the "when to pick it" rule. Do **not** dump the full matrix into chat; it
   lives in `positioning.md`.
4. **Global overview (Phase 3.0)** later reuses the same one-liner/rows — one
   source, three touchpoints (value brief teaser → overview summary → m00
   module if kept).

## Output structure — `<repo>/.learning/positioning.md`

```markdown
# Positioning — <repo>
> Updated: <ISO date> ｜ Sources: [src]=repo 源码 · [web]=外部 URL+访问日期 · [unv]=未验证 tutor 记忆
> The ecosystem goes stale: when facts change, update this file and write a learning record per the learning-records rules.

## One-line positioning
<what niche, for whom, what it deliberately is not>  [src] <file:line> or [web] <URL>

## Ecosystem comparison table
| Peer 同类项目 | Dimension 维度 | Peer's approach 同类做法 | This repo's approach 本项目做法 | Key tradeoff 关键取舍 | When to pick this 何时选本项目 | Source 来源 |
|---|---|---|---|---|---|---|
| <peer> | <dimension> | <peer's approach> | <this repo's approach> | <key tradeoff> | <when to pick this> | [web] URL(date) or [src] or [unv] |
| ...    | ...    | ...    | ...    | ...    | ...    | ...    |

## When to pick it / when to pick a peer (transferable criteria)
- Pick this repo if: ...
- Pick a peer if: ...
- Criteria (rules transferable across projects): ...

## Facts to verify (never enter the comparison table)
- <claim> — no source; needs a WebSearch or mark [unv]

## Anti-patterns
- An uncited comparison row → may only enter "facts to verify（待验证）", never the table
- Passing off tutor memory as a source-walk conclusion → forbidden
- External facts into MISSION.md / COVERAGE.md → forbidden; this file only
```

The matrix has **7 fixed columns** (peer × dimension × peer's approach × this
repo's approach × key tradeoff × when to pick this repo × source). Rows are
peer×dimension — one peer may appear in several rows (different dimensions).
The "when to pick it" column is the evidence anchor for m00's `kp00-03`.

## Source rules (facts never mix)

- **Repo facts** (what *this* repo does / its architecture / its code): from
  source only — cite `file:line` / README. A web result about the repo itself
  **never overrides a source walk**; the repo is the authority for itself.
- **Peer / ecosystem facts** (what a comparable project does, benchmark
  numbers, ecosystem context): from an external search **only** when a search
  tool is available. Cite `[web] <URL>` + access date. Prefer primary sources
  (official docs/README/release notes/benchmark repos) over blog posts over
  aggregator lists; 1+ URL per comparison claim when possible; when sources
  contradict, present both and note the difference instead of resolving
  silently; date-stamp every external fact.
- **`[unv]`** — an uncited tutor-memory claim. Allowed only as a *seed for a
  search* or as a row in "facts to verify（待验证）". **Never** as a gated
  reference answer, never as a MISSION.md claim, never in a quiz.
- **Degraded mode**: no search tool → build the brief from repo evidence and
  mark peer rows `[unv]` / "待验证". **Never fabricate a source.**
