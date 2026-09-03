# Learning Records Template — ADR-style Learning Records

> **Read in**: all phases. Learning records and notes are **two layers**:
> - `notes/<module>.md` = content notes — what each module covered (knowledge accumulation).
> - `records/NNNN-slug.md` = decision records — **how the learner's understanding evolved** (non-obvious learnings, stated prior knowledge, corrected misconceptions). These feed ZPD decisions and future sessions.
>
> Format absorbed from mattpocock teach skill's `LEARNING-RECORD-FORMAT.md` (the teaching-world ADR).

## Location & numbering

- Location: `<repo>/.learning/records/`, filenames `0001-slug.md`, `0002-slug.md`, … incrementing.
- Lazy creation: only create the directory when the first record is written.

## Template (minimal)

```md
# {one-line title: what was learned / established}

{1-3 sentences: what was learned (or what prior knowledge was established), and why it matters for future sessions.}

Status: active | superseded by LR-NNNN   ← only when needed
Evidence: {how the user demonstrated this: answered a question / ran a demo / cited prior experience}
Implications: {what this unlocks or rules out for future sessions}
```

**The whole format is these few lines.** The value of a record is capturing "this is now known" + "it changes what to teach next" — not filling out sections.

## When to write one

1. **The user demonstrated genuine understanding of something non-trivial** — not just exposure, but evidence they can use it correctly (answered, demo ran). This sets a new floor for what to teach next.
2. **The user disclosed prior knowledge** — "I already know X." Record it, and the claimed depth, so future sessions don't re-teach it.
3. **A misconception was corrected** — the user believed something wrong and now sees why. High value: predicts future stumbling blocks for related topics.
4. **The Mission shifted in response to learning** — the user discovered they care about something different. Update `MISSION.md` and cross-link.

### What does *not* qualify

- Material merely covered. Coverage is not learning; wait for evidence.
- Anything already captured tersely as a glossary term. Don't duplicate.
- Session-by-session activity logs. Records are not a journal — they're decision-grade insights.

## Supersession

When a later record contradicts an earlier one (understanding deepened or corrected), mark the old record `Status: superseded by LR-NNNN` rather than deleting it — the history of how understanding evolved is itself useful signal (absorbed from teach's supersession).

## Relationship to ZPD

Each record updates the baseline of "what the user already knows". At session start, read `records/` + `progress.json` to judge the **zone of proximal development**: teach what's "just challenging enough" — not re-covering established knowledge, not leaping too far.
