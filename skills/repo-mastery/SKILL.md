---
name: repo-mastery
description: "Turn any open-source repository into a developer-focused mastery course. Given a local repo path or GitHub URL, it builds a confirmed course map and drives interactive mastery learning (diagnostic, explanation, Feynman check, practice, spaced review) with hands-on tasks, note-taking, and dual-format (Markdown + HTML) course output — so you fully master a project's usage, architecture, and key implementations like a real course. Triggers: 'learn this repo', 'master this codebase', 'turn X into a course', 'deep-dive into X project'."
origin: ECC
version: 2.2.1
tags: [learning, education, codebase, mastery, spaced-repetition]
---

# Repo-Mastery — Master an Open-Source Project from Source

> Turn any open-source repository into a **developer-focused mastery course**. Instead of "browsing code", you progressively master its **usage → architecture → key implementations**, with per-knowledge-point mastery gates, spaced review, and persistent notes.

## When to Activate

Use this skill whenever any of these applies:

- The user wants to "learn / master / fully understand / deep-dive into" an open-source repo or codebase.
- The user just got a new project's source and wants systematic learning instead of random browsing.
- The user wants to understand a project's **architecture and key implementations from source** (not just how to use it).
- The user wants learning progress to **persist across sessions** (memory + spaced review).
- The user says "turn X repo into a course", "learn X from source", "deep-dive into X project".

Do **not** activate when: the user just wants a doc/README summary, a one-off code Q&A, or an end-user tutorial for a tool (that is `docs-to-course`'s job).

## Prerequisites

- **Claude Code** (the skill runtime) — the same skill also runs on OpenAI Codex and Gemini CLI (Agent Skills standard).
- **Target repository**: a local path, or a reachable `github:owner/repo` (the skill auto-runs `git clone --depth 1`).
- **Python 3** — needed by the deterministic engine (`scripts/learning_engine.py`) and the large-repo index (`scripts/index_repo.py`), both pure stdlib.
- **Write permission**: creates `.learning/` inside the target repo (auto-gitignored) and a global `~/.repo-mastery/`.

## Language

Teaching language **follows the user's input language by default** (Chinese input → Chinese teaching; English input → English teaching). You can also pass an explicit language flag:

```bash
/repo-mastery start <path|github:owner/repo> --language zh    # force Chinese
/repo-mastery start <path|github:owner/repo> --language en    # force English
```

Code, file paths, and identifiers always stay in their original form regardless of language.

## Core Design Axiom (always hold)

> **Intelligence at the exit, advancement at the gate.** You (the tutor) decide what to teach, how to question, how to explain — but whether the learner *may advance* is always a **deterministic engine decision**, never the LLM patting itself on the back.

- Quantitative gate (memory / procedure types): `compute_mastery()` recency-weighted accuracy ≥ 0.9, capped by a confidence ceiling — **one lucky answer is not mastery**.
- Qualitative gate (concept / design types): a Feynman-style explanation judged by the tutor (`mastery_assess`).
- Advancement is computed **from what is already mastered** (`next_objective`), never from a stage counter. Knowledge points already proven are skipped (test-out path).

**The gate is code, not prose** — run `scripts/learning_engine.py` for `compute-mastery`, `schedule`, `record-attempt`, `next-objective`, `validate-map`, and `init`. Every platform calls the same script, so mastery math never drifts.

---

## Commands

```bash
/repo-mastery start <local-path | github:owner/repo> [--language zh|en]  # Main flow: map → confirm → learn → output
/repo-mastery continue                                                  # Resume progress (back to next_objective)
/repo-mastery review                                                    # Run spaced-review session (due items)
/repo-mastery note "<text>"                                             # Manually append to the current module notes
/repo-mastery status                                                    # Show progress (map_summary style)
/repo-mastery report                                                    # Generate mastery report MASTERY.md
/repo-mastery export [--html]                                           # Synthesize complete course doc (COVERAGE.md; --html adds HTML)
```

---

## Main Flow (`/repo-mastery start`)

### Phase 0 — Complexity Assessment (decide how to ingest)

Make a quick scale judgment first, **then** choose how to digest the source:

| Metric | Small / Medium | Large |
|---|---|---|
| Source lines (`src/` + non-test) | < 100k | ≥ 100k |
| Top-level modules / packages | < 20 | ≥ 20 |
| Dependency complexity / multi-language | simple | complex |

- **Small / medium** → pure skill reads the source directly (Grep/Glob/Read + explore_context-style pre-scan), no Python dependency.
- **Large** → first run `scripts/index_repo.py` to generate `code-map.json` (modules/dependencies/symbol locations; see `references/index-script-spec.md`), build the course map on top of it, and locate source on demand instead of cramming the whole repo into context.
- When unsure, measure with `find` + `wc -l`; do not guess.

### Phase 1 — Pre-scan → Course Map Candidates

Start with an **explore_context-style objective pre-scan**: calmly map the repo first (README, entry files, directory structure, build config, core modules) **without jumping to conclusions**. Then generate course-map candidates per `references/curriculum-design.md`:

```jsonc
{
  "repo": "owner/name",
  "summary": "an objective overview of the repo",
  "modules": [
    {
      "id": "m01",
      "name": "Build & environment",
      "order": 1,
      "pass_threshold": 0.7,
      "knowledge_points": [
        {"id": "kp01-01", "name": "Build and run from scratch", "type": "procedure"},
        {"id": "kp01-02", "name": "Mental model of the directory structure", "type": "concept"}
      ]
    }
  ]
}
```

**Module arc** (absorbed from docs-to-course's "reference → route", adapted for source learning):

> **First win (build) → overall architecture mental model → core workflows/modules → key implementations → hands-on labs → troubleshooting → deep references**

This is a menu, not a checklist — pick 4–8 modules that fit the repo; fewer, deeper beats more, thinner. The knowledge point's `type` decides its gate (see `mastery-policy.md`).

### Phase 2 — Course Map Confirmation & Customization (user decision, never skipped)

First establish the **Mission** (absorbed from the teach skill's MISSION.md): ask the user one key question — **"Why do you want to master this repo?"** (use it? modify it? explain it in interviews? borrow its design? …). Write the answer to `<repo>/.learning/MISSION.md`; it grounds every later teaching decision (module choices, Feynman follow-ups, mastery priority). When the Mission changes, update it and write a learning record.

Then **present the candidate map** to the user, explain each module, and:

- ✅ User removes irrelevant modules / adds interesting ones / adjusts knowledge-point granularity.
- ✅ User confirms each module's `pass_threshold` (default 0.7).
- ✅ **Learning starts only after user approval.** This is mandatory — the opposite of docs-to-course's "don't get outline approval".

After confirmation, write `<repo>/.learning/course-map.json` and initialize the `.learning/` structure (below).

### Phase 3 — Interactive Mastery Learning

Drive per `references/session-flow.md`. Core loop (per knowledge point):

> **diagnostic (probe how much is known; test-out skip) → explain → Feynman check → practice (quiz / hands-on) → error diagnosis → spaced-review scheduling**

- The next station is always decided by the **engine script** — run `python3 scripts/learning_engine.py next-objective <path>/.learning/progress.json` (priority: pending question → due review → first unmastered point → complete).
- Quantitative gate (memory/procedure): pose a question, then record the attempt and recompute mastery via `python3 scripts/learning_engine.py record-attempt ... --write`; advance only when the script reports `passed_gate: true` (≥ 0.9).
- Qualitative gate (concept/design): have the user do a Feynman recital; you judge `passed`; retry if not. (Qualitative results are stored in `progress.json.qualitative_mastery` and read by the engine's `next-objective`.)
- **Hands-on on demand**: for procedure points, guide the user to actually run things (build/test/write a small demo). Read-only commands (`build`, `test`, `--help`) may run directly; **mutating operations (writing files, installing deps) require explicit user approval first**. The hands-on result is recorded as mastery evidence.
- **Auto notes**: after each explanation/judgment, automatically append to `<repo>/.learning/notes/<module>.md` (format: `note-template.md`); the user can `/repo-mastery note "..."` at any time.
- **Command convention**: only run read-only/no-side-effect commands by default; show any command that modifies the user's filesystem or installs dependencies and request approval.

### Phase 4 — Synthesize the Complete Course Document (dual format)

When learning completes (or the user runs `/repo-mastery export`), synthesize **course map + explanation notes + user practice records + mastery & blockers** into a complete course document:

1. **Markdown full version** `COVERAGE.md`: complete content with source references, module explanations, mastery, blockers, and review schedule. This is the primary artifact.
2. **HTML share version** (`/repo-mastery export --html`): **reuse the finished shell in `references/html-shell/`** (styles.css / main.js / _base.html / _footer.html / build.sh — copy verbatim, never regenerate), convert COVERAGE.md module content into `modules/0N-slug.html`, and assemble `index.html` with `build.sh`. Interactive elements (flow animations, group chat, glossary tooltips, scenario quizzes) follow the patterns in `references/html-shell/interactive-elements.md`.

> Note: the HTML version's visuals serve "source understanding" — **architecture diagrams, dependency graphs, call chains are the core content**, the opposite of docs-to-course's "UI step-strips bias".

---

## Data Structures

```text
<target-repo>/.learning/                  ← travels with the repo; auto-gitignored
  ├── MISSION.md           learning mission (why you want to master it; grounds teaching)
  ├── course-map.json      course map (confirmed version)
  ├── progress.json        LearningProgress (mastery / spaced review / blockers; see mastery-policy.md)
  ├── records/NNNN-slug.md ADR-style learning records (understanding evolution)
  ├── notes/<module>.md    structured notes (auto + /note append)
  ├── briefs/<module>.md   module briefs (large repos, token-saving)
  ├── code-map.json        large-repo index (optional)
  └── .gitignore           contains ".learning/"
~/.repo-mastery/                     ← global lightweight memory (no L1/L2/L3 layering)
  ├── profile.md           cross-repo preferences / level / blocker summary
  └── index.json           repos studied + state (last learned where)
```

Progress is stored in JSON, one record per knowledge point; the **expected answer of a pending question lives server-side (`progress.json`) and never round-trips to the user** — grading never drifts (absorbed from DeepTutor's `PendingQuestion`).

---

## Reference Files (read per phase to keep context lean)

- `references/curriculum-design.md` — **Phase 1**: designing the course map from source
- `references/mastery-policy.md` — **Phase 3**: mastery, gates, spaced review, error diagnosis, fluency vs storage
- `references/session-flow.md` — **Phase 3**: interactive learning session protocol (incl. Mission + ZPD)
- `references/quiz-design.md` — **Phase 3**: quiz design (test application, not memory)
- `references/module-brief-template.md` — **Phase 3, large repos**: pre-extract source snippets, save tokens
- `references/note-template.md` — **Phase 3**: note format
- `references/learning-records-template.md` — **All phases**: ADR-style learning record format
- `references/gotchas.md` — **All phases**: failure-point checklist
- `references/index-script-spec.md` — **Phase 0, large repos**: Python indexing script docs
- `references/html-shell/` — **Phase 4**: HTML course shell (copy verbatim)

## Scripts

- `scripts/learning_engine.py` — **the deterministic gate**. Call for mastery / schedule / record-attempt / next-objective / validate-map / init. Mandatory; never re-derive the math from prose.
- `scripts/index_repo.py` — large-repo code index (`code-map.json`), pure stdlib.

## Anti-Patterns

> The full failure checklist is in `references/gotchas.md`. These anti-patterns destroy learning quality outright — stop when you see one:

- ❌ **Letting the LLM replace the gate** — never use "do you feel you've got it?" instead of the engine script.
- ❌ **Skipping course-map confirmation** — the user must approve/customize the map (with Mission); this is an explicit requirement.
- ❌ **Leaking the expected answer** — the question text/options must never contain it; only `progress.json.pending_question` does.
- ❌ **Confusing "worked once" with "mastered"** — one lucky answer / one successful run ≠ mastery; the confidence ceiling + spaced review are the real goal (fluency ≠ storage).
- ❌ **Cramming the whole repo into context** — read only the files relevant to the current knowledge point; use `code-map.json` to locate on demand in large repos.

## Related Skills

- `docs-to-course` (codebase-to-course) — docs → end-user usage course (source of this skill's methodology & HTML shell).
- `understand-anything` — builds a knowledge graph of a codebase (pair well for architecture deep dives).
- `codebase-onboarding` — quick ramp on unfamiliar codebases (complements this skill's Phase 1 pre-scan).
- `find-docs` — locate project docs; useful for enriching a module's "primary sources".

## Verification (completion checks)

When starting / ending a learning session, self-check with `references/gotchas.md` and confirm:

- [ ] `.learning/` is gitignored; the target repo is not polluted.
- [ ] `course-map.json` is the user-confirmed version.
- [ ] `progress.json` written atomically, uncorrupted.
- [ ] Notes appended and `~/.repo-mastery/index.json` updated each turn.
- [ ] No expected-answer leakage; no unapproved mutating commands.
