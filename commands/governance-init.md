---
description: Create a day-zero governance scaffold for a new empty project: concise CLAUDE.md, thin Codex AGENTS.md bridge, governance workflow, append-only project history, optional pre-commit guard, and initial local commit. Use /governance for existing codebases.
argument-hint: "[project name, technology stack, confirmed modules]"
---

Create a **minimal day-zero governance scaffold** in the current empty project.

Use this command only for a new project with no implementation. Existing codebases use `/governance`, which discovers real structure before adding or updating governance artifacts. Progressive adoption is defined by `living-docs-governance`.

Treat `$ARGUMENTS` as project name, technology stack, and confirmed modules. Ask for missing information one item at a time; never guess the stack.

## Create

### 1. `CLAUDE.md` (Project Charter, ≤60 Lines)

Adapt `skills/docs-governance/templates/CLAUDE.example.md` and add only project-confirmed day-zero rules:

- **Governance rule first:** before updating or creating files or changing business rules, read and follow `docs/governance.md`.
- **Verification:** derive commands from the confirmed stack, such as `python -m py_compile` plus `ruff check`, or `npx tsc --noEmit` plus `npm test`. Include a minimum run command when the main program changes.
- **Git rules:** after initialization, create a local repository and initial commit; later commit focused change types after verification. Use English commit messages. Never automatically run broad staging, push, force push, hard reset, destructive checkout, branch deletion, amend, or interactive rebase.
- **Completion gate:** run project verification, simplify only the current change, rerun verification, perform review when available, reconcile Spec/Issue success criteria, execute the real path and inspect artifacts, then commit only when all applicable layers pass.
- **Failure self-check:** before retrying a failed operation, identify whether information, tooling, or constraints are missing and tell the user.
- **Pointers:** link requirements/success criteria, technical plans, and validated reference prototypes using the repository's chosen locations. For uncertain external APIs or transformations, build the smallest disposable reference experiment before production implementation.

### 2. `AGENTS.md` (Thin Codex Bridge)

When the user uses Codex or requests cross-host compatibility, adapt `skills/docs-governance/templates/AGENTS.example.md`. It points to the shared charter, red-line status, and on-demand map without copying their content.

### 3. `docs/governance.md`

Copy `skills/docs-governance/templates/governance.example.md`, replace `{Project Name}`, and leave project placeholders for evidence-driven evolution. Do not rewrite the fixed sections inline.

### 4. `PROJECT_LOG.md`

Use the format in `PROJECT_LOG.example.md`, but keep only one new event:

```markdown
## [today] init | Initialized the project with /governance-init
```

Do not copy example history entries.

### 5. Only Immediately Used Directories

Create directories only when the scaffold puts a real file in them. Do not pre-create empty `src/`, `tests/`, `references/`, `logs/`, or output folders. Add runtime-output locations to `.gitignore` when they first appear.

### 6. Optional Pre-Commit Guard

Ask before installing `skills/docs-governance/templates/pre-commit.example` into `.git/hooks/pre-commit`. The reference guard requires a staged history event with code changes, exempts test/documentation/governance-only changes, and prints an actionable recovery command.

### 7. Local Git Initialization

Run `git init`, stage only the explicitly generated files, and create `git commit -m "init: project governance scaffold"`. Do not push.

## Deliberately Omitted

- Project map and status: an empty project has no verified dependency direction, non-obvious paths, health metrics, or deletion zone. Create them after warning signals appear.
- CONTEXT, ADR, CONTRACT, TESTS, and REGRESSION artifacts: create only when stable domain language, hard-to-reverse decisions, cross-boundary interfaces, required test points, or real module dependencies appear.
- Project-specific hook configuration beyond the explicitly confirmed optional guard.

## Closeout

Report exact files created, the charter line count, the initial commit ID, and the smallest next step. Do not claim completion for commands that did not run.
