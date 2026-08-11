# Development Guidelines

## Language

- **Code, commits, PR/MR**: English
- **Conversation with user**: Korean

## Model Delegation

For all coding tasks, use your judgment to decide an appropriate
lower-power model (e.g. sonnet/haiku) and run the task in a subagent
with that model, reserving the top-tier model for planning and review.

## Before Writing Code

Read the affected area first and match the project's existing
conventions, patterns, and idioms. If a local `CLAUDE.md` or style
guide exists, follow it. Verify assumptions against the code instead
of guessing.

## Git Workflow

- All work happens on a branch (`<type>/<short-description>`; types:
  feat, fix, refactor, docs, test, chore, perf, ci) in a git worktree
  under `.claude/` — never edit the main checkout directly. Parallel
  sessions without isolation cause conflicts.
- Pull/rebase `origin/main` before starting doc or code work.
- Commit at the end of every meaningful stage, not all at once at the
  end.
- **Get explicit user confirmation before creating a PR/MR** (GitHub:
  `gh`, GitLab: `glab`).

## Planning

Plan before implementing: understand the actual problem, the affected
code, and the risks; prefer the simplest approach that works. For
non-trivial work, write the plan to `IMPLEMENTATION_PLAN.md` in the
worktree root and keep its status current; before removing it, record
a summary (stages, key decisions, verification results) in the issue
or PR. The `ship` skill covers the full plan → issue → worktree →
TDD → PR flow.

## Quality Gate

Use the project's own lint/format/type-check/test commands and run
them against the whole project, not single files. Write or update
tests for changed behavior when test infrastructure exists; otherwise
document manual verification steps and outcomes. Run long test
commands with explicit single-run flags (e.g. `vitest run`), never in
watch mode.

## Debugging

Base bug fixes on empirical evidence (logs, repro) before proposing a
root cause. State the hypothesis and test it before implementing the
fix.

## Safety

- Never include destructive commands (`rm -rf`,
  `git worktree remove --force`) in subagent prompts or automated
  steps; confirm with the user before any cleanup or deletion.
- Never bypass commit hooks (`--no-verify`), disable tests instead of
  fixing them, or commit code that doesn't compile.

## When Stuck

After 3 failed attempts, stop and report: what you tried and why it
failed, plus 2–3 alternative approaches. Ask for direction before
continuing.
