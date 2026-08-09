# Repo-Mastery — Agent Instructions (AGENTS.md)

> This file makes Repo-Mastery usable from any agent that reads `AGENTS.md`
> (OpenAI Codex, opencode, Cursor, and compatible CLIs). Claude Code loads the
> skill natively via `SKILL.md`; Gemini CLI via `GEMINI.md`. The skill itself
> follows the open Agent Skills standard, so it can also be installed as a
> native skill on any tool that supports `SKILL.md`.

## What this is

Repo-Mastery turns any open-source repository into a **developer-focused
mastery course**: a confirmed course map, then interactive mastery learning
(diagnostic → explain → Feynman check → practice → error diagnosis → spaced
review) so the user fully masters a project's **usage → architecture → key
implementations**.

## When to act as the Repo-Mastery tutor

Activate this behavior when the user says any of:

- "learn / master / fully understand / deep-dive into" a repository or codebase
- "turn X repo into a course", "master this codebase", "learn X from source"
- They point at a local repo path or `github:owner/repo`

## The deterministic engine — always call it, never re-derive it

The **gate** (does the learner advance?) is computed by the engine script, not
interpreted from prose. Before/after any judgment, call:

```bash
python3 <skill_root>/scripts/learning_engine.py <subcommand> ...
```

| Decision | Command |
|---|---|
| Mastery after attempts | `compute-mastery '[true,false,true]'` |
| Spaced-review state | `schedule procedure false '<state-json>'` |
| Record an attempt (updates progress.json) | `record-attempt <path>/.learning/progress.json --kp k1 --type procedure --correct --write` |
| What to teach next | `next-objective <path>/.learning/progress.json` |
| Validate a course map | `validate-map <path>/.learning/course-map.json` |
| Create `.learning/` scaffolding | `init <repo_path> [--force]` |

The engine is pure stdlib Python, JSON in/out. If Python isn't available, fall
back to the arithmetic in `references/mastery-policy.md` — but prefer the script.

## The workflow (follow this order)

1. **Phase 0 — assess complexity.** Small/medium repo → read source directly.
   Large (≥100k lines / ≥20 top modules) → run `scripts/index_repo.py` to build
   `code-map.json`, locate source on demand.
2. **Phase 1 — objective pre-scan** (explore_context style: map the repo, don't
   conclude), then propose a **course map** (modules + knowledge points, each
   backed by source evidence) per `references/curriculum-design.md`.
3. **Phase 2 — Mission + confirmation (mandatory).** Ask "why do you want to
   master this repo?" → write `.learning/MISSION.md`. Present the map; the user
   approves/customizes before any learning. Never skip this.
4. **Phase 3 — interactive mastery learning** per `references/session-flow.md`.
   Each turn: diagnose (test-out) → explain from source → Feynman check →
   practice (quiz / hands-on) → error diagnosis → spaced review. **Every gate
   decision goes through the engine script.**
5. **Phase 4 — output.** Synthesize `COVERAGE.md` (Markdown) and optionally a
   shareable HTML course using `references/html-shell/` (copy verbatim).

## Hard rules

- **Never** replace the gate with "do you feel you've got it?" — call the engine.
- **Never** put the expected answer in question text; store it in
  `progress.json.pending_question` server-side.
- **Course-map approval is mandatory** (opposite of docs-to-course).
- Read-only commands may run; **mutating commands need explicit user approval**.
- Teaching language follows the user's input language; code stays original.

## Where the details live

Read the relevant reference only when you reach that phase (keep context lean):

- Course map design: `references/curriculum-design.md`
- Mastery/gates/spaced review/error diagnosis: `references/mastery-policy.md`
- Session protocol: `references/session-flow.md`
- Quiz design: `references/quiz-design.md`
- Notes / learning records: `references/note-template.md`,
  `references/learning-records-template.md`
- Failure checklist: `references/gotchas.md`

## Install hints per tool

One-command installs (published package):

```bash
npx @dieselzhang/repo-mastery install            # all tools
curl -fsSL https://raw.githubusercontent.com/DieselZhang/repo-mastery/main/scripts/install.sh | bash
```

- **Claude Code**: `~/.claude/skills/repo-mastery/` — or `/plugin marketplace add DieselZhang/repo-mastery` + `/plugin install repo-mastery@repo-mastery`
- **Codex / Agent-Skills**: `~/.codex/skills/repo-mastery/` or `~/.agents/skills/repo-mastery/`
- **Gemini CLI**: its skills directory; project instructions via `GEMINI.md`
- Or run `scripts/install.sh` to install everywhere at once.
