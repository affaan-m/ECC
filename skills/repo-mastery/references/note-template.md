# Note Template — Note Format

> **Read in**: Phase 3. After each module's explanations/judgments, the tutor **automatically** accumulates key points into `notes/<module>.md`; the user appends personal thoughts/questions/blockers at any time with `/repo-mastery note "<text>"`. Notes are the context for later review and sessions (absorbed from DeepTutor's notebook idea).

## Note file organization

```text
<repo>/.learning/notes/
  ├── m01-run-build.md     # one per module; named <module_id>-<slug>.md
  ├── m02-architecture.md
  └── README.md            # note index: module → file + one-line status
```

## Per-module note structure

```md
# Module N — <title>

> Status: in-progress / mastered / has-blockers
> Mastery: <module-level average | qualitative result>
> Last updated: <ISO date> <UTC time>

## Key points (auto-accumulated)
> Appended after each explanation. Each = one self-checkable takeaway with a source reference (file:line).

- **Takeaway title** — one-sentence conclusion. `src/pipeline.py:120` `RAG main chain: …`
- …

## Command / config cheatsheet
> Verbatim, so the user can copy-and-use.

```bash
deeptutor kb create physics --doc ch1.pdf
```

## My notes (/note appended)
> User-appended content, kept verbatim; the tutor never rewrites the user's words.

- 2026-08-07: I don't get why message queue instead of RPC here —— <user text>
- …

## Blockers
> Diagnosed blockers (error type + attribution), mapped to review tasks.

| Knowledge point | Blocker | Error type | Status |
|---|---|---|---|
| kp01-01 | don't understand async prerequisite | structural | active |

## Feynman self-check
> When a qualitative point passes, record the distilled version of the user's recital (one line).

- kp01-02 (concept): user recital = "…"

## Resources / primary sources (absorbed from the teach skill)
> Recommend 1 high-quality primary source per module for going deeper — official docs / design docs / papers / maintainer talks. This is the "keep going on your own" entry point.

- Official docs: <link>
- Design doc / ADR: <link>
- Source file worth reading closely: `file:line`

## Due reviews
> Synced from `progress.json`'s `review_queue`, for quick entry into review in later sessions.
```

## Division of labor: auto vs manual

- **Auto-accumulated** (tutor's job): key points, command cheatsheet, blocker table, Feynman self-checks, due reviews. Updated after each explanation and judgment.
- **Manual append** (user's job): `/repo-mastery note "..."` goes verbatim into the "My notes" section. **The tutor never rewrites the user's words** — but may register it as a blocker/review point in the Blockers section.

## Iron rules

- Source references in notes carry `file:line` for traceability.
- Commands/config must be verbatim (the user will copy them).
- Notes update **incrementally**: append new content, don't rewrite the whole file (token economy).
- Review sessions read notes first rather than re-reading source — notes are your long-term memory.
