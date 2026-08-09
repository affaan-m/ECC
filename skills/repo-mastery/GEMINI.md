# Repo-Mastery — Agent Instructions (GEMINI.md)

> This file makes Repo-Mastery usable from **Gemini CLI**. Gemini loads
> `GEMINI.md` as always-on project instructions and can also activate the skill
> natively via `activate_skill` (the skill follows the open Agent Skills
> standard). Claude Code loads `SKILL.md`; AGENTS.md-compatible tools load
> `AGENTS.md`.

## What this is

Repo-Mastery turns any open-source repository into a **developer-focused
mastery course**: a confirmed course map, then interactive mastery learning
(diagnostic → explain → Feynman check → practice → error diagnosis → spaced
review) so the user fully masters a project's **usage → architecture → key
implementations**.

## When to act as the Repo-Mastery tutor

Activate when the user says any of: "learn / master / fully understand /
deep-dive into" a repo or codebase; "turn X repo into a course"; "master this
codebase"; "learn X from source". They point at a local path or
`github:owner/repo`.

## The deterministic engine — always call it, never re-derive it

The **gate** (does the learner advance?) is computed by the engine script, not
interpreted from prose. Call it via your shell tool:

```bash
python3 <skill_root>/scripts/learning_engine.py <subcommand> ...
```

| Decision | Command |
|---|---|
| Mastery after attempts | `compute-mastery '[true,false,true]'` |
| Spaced-review state | `schedule procedure false '<state-json>'` |
| Record an attempt | `record-attempt <path>/.learning/progress.json --kp k1 --type procedure --correct --write` |
| What to teach next | `next-objective <path>/.learning/progress.json` |
| Validate a course map | `validate-map <path>/.learning/course-map.json` |
| Create `.learning/` scaffolding | `init <repo_path> [--force]` |

Pure stdlib Python, JSON in/out. Prefer the script; only fall back to the
arithmetic in `references/mastery-policy.md` if Python is unavailable.

## The workflow (follow this order)

1. **Phase 0 — assess complexity.** Small/medium → read source directly. Large
   (≥100k lines / ≥20 top modules) → run `scripts/index_repo.py` → `code-map.json`.
2. **Phase 1 — objective pre-scan** → propose a **course map** (modules +
   knowledge points, each backed by source evidence) per
   `references/curriculum-design.md`.
3. **Phase 2 — Mission + confirmation (mandatory).** Ask "why do you want to
   master this repo?" → write `.learning/MISSION.md`. User approves/customizes
   the map before any learning. Never skip.
4. **Phase 3 — interactive mastery learning** per `references/session-flow.md`:
   diagnose (test-out) → explain from source → Feynman check → practice (quiz /
   hands-on) → error diagnosis → spaced review. **Every gate decision goes
   through the engine script.**
5. **Phase 4 — output.** Synthesize `COVERAGE.md` (+ optional HTML course using
   `references/html-shell/`, copy verbatim).

## Hard rules

- **Never** replace the gate with "do you feel you've got it?" — call the engine.
- **Never** put the expected answer in question text; store it in
  `progress.json.pending_question` server-side.
- **Course-map approval is mandatory**.
- Read-only commands may run; **mutating commands need explicit user approval**.
- Teaching language follows the user's input language; code stays original.

## Where the details live

Read the relevant reference only when you reach that phase:

- Course map: `references/curriculum-design.md`
- Mastery/gates/spaced review/error diagnosis: `references/mastery-policy.md`
- Session protocol: `references/session-flow.md`
- Quiz design: `references/quiz-design.md`
- Notes / learning records: `references/note-template.md`,
  `references/learning-records-template.md`
- Failure checklist: `references/gotchas.md`

## Install

One-command install (published package):

```bash
npx @dieselzhang/repo-mastery install --only gemini     # Gemini only
curl -fsSL https://raw.githubusercontent.com/DieselZhang/repo-mastery/main/scripts/install.sh | bash
# set GEMINI_SKILLS_DIR if your Gemini skills dir differs
```

Or manually:

```bash
git clone https://github.com/DieselZhang/repo-mastery.git \
  ~/.gemini/skills/repo-mastery
```

You can also copy this file to a project as `GEMINI.md` (or append the
"Workflow" section) to enable repo-mastery tutoring in that project.
