---
name: plan-orchestrate
description: Read a plan document, decompose it into steps, classify each step, and emit ready-to-paste ECC slash commands from the current default command surface. Generative only — never invokes commands itself. Use when the user has a multi-step plan and wants the right command for each step without picking it by hand.
metadata:
  origin: ECC
---

# Plan Orchestrate

Bridge a plan document to the current ECC slash-command surface by emitting one ready-to-paste command per step. The skill is generative only — it never executes commands. The user pastes each line when ready.

## When to Activate

- User has a multi-step plan document (PRD, RFC, implementation plan) and wants ready-to-paste commands for each step.
- User says "turn this plan into commands", "what command should I run for each step", "orchestrate this plan".
- A step-by-step plan exists but the user does not want to manually pick a command per step.

Skip when:
- The work is one ad-hoc step → run the appropriate slash command directly (see the catalogue below).
- The plan is unreadable or empty. Lack of explicit numbering alone is not a skip condition — see the "No clear steps" edge case below.
- The plan should run autonomously in the background → prefer `dmux-workflows` or the native `workflows/*.workflow.js` scripts instead.

## Inputs

```
<plan-doc-path> [--scope=all|step:<n>|range:<a>-<b>] [--dry-run]
```

- `<plan-doc-path>` — required; relative or absolute path (`@docs/...` accepted).
- `--scope` — limits emitted steps; defaults to `all`.
- `--dry-run` — print decomposition + command rationale only; do not emit final commands.

## Authoritative output shape (do not deviate)

```
/<command> "<task description>"
```

- The command must be one of the commands in the catalogue below. No `legacy-command-shims/` commands and no `/orchestrate` or `/ecc:orchestrate` — those are retired.
- One concrete command per step — never a placeholder or multiple forms.
- No `--mode`, `--gate`, `--agents=...`, or similar invented flags.
- Embedded double quotes in the task description are escaped as `\"`.
- The task description is 200–600 characters, one line, self-contained, and starts with `[Plan: <path>#step-<id>]`.

## Command catalogue

Classify each step by its primary tag and emit the matching command. The command itself decides which agents and skills to run.

| Tag | Trigger words | Command | Why |
|---|---|---|---|
| `design` | architecture, design, choose, evaluate, RFC | `/plan` | Needs human-approved implementation plan before code. |
| `plan` | plan, breakdown, milestone | `/plan` | Produces a step-by-step plan for approval. |
| `impl` | implement, build, add, create, port | `/orch-add-feature` | Net-new capability. |
| `fix` | fix, bug, broken, defect, repair, regression | `/orch-fix-defect` | Existing behavior is wrong. |
| `change` | change, alter, tweak, modify, behavior | `/orch-change-feature` | Existing working behavior should behave differently. |
| `refactor` | refactor, cleanup, dedupe, split, restructure | `/orch-refine-code` | Behavior-preserving restructure. |
| `migration` | migrate, upgrade, rewrite, port | `/orch-change-feature` | Replacing one implementation with another; if behavior must stay identical, classify as `refactor`. |
| `db` | schema, migration, index, SQL, Postgres, alembic, sqlmodel | `/orch-add-feature` | New schema/migration is a net-new capability in the current codebase. |
| `security` | encrypt, auth, secret, OWASP, PII, audit | `/security-scan` | Security review/audit when no `impl`/`fix` tag is primary. |
| `build` | build, compile, lint failure, CI | `/build-fix` | Fix build/type/lint errors. |
| `docs` | docs, readme, codemap, changelog | `/update-docs` | Update or add documentation. |
| `lookup` | lookup, reference, API usage | `/plan` | Research/lookup becomes a plan with findings. |
| `review` | review, audit, verify | `/code-review` | Review local uncommitted changes or a PR; pass the PR number in the task description for PR mode. |
| `test` | test, coverage, e2e, integration | `/test-coverage` | Add or analyze tests. |
| `loop` | loop, autonomous, watchdog | `/loop-start` | Start an autonomous loop. |

Tag resolution rules:
1. **Primary tag selection**: when a step matches multiple tags, the **first one in table order** (top of the table = highest priority) is the primary. The command for the primary tag is what gets emitted.
2. **Multi-tag notes**: write a one-line command rationale when a secondary tag meaningfully changes risk (for example, an `impl,security` step still emits `/orch-add-feature`, but the rationale notes that the security trigger will pull in `security-reviewer` automatically).
3. **Zero-tag steps**: default to `/code-review` and write the rationale `no tag matched; default review command`.
4. **Step with an explicit agent name**: if the plan text names an agent (for example, `tdd-guide`), map the step to the command that exercises that agent. For example, a step that says "write tests with tdd-guide" is an `impl` step → `/orch-add-feature`; a step that says "run python-reviewer over auth" is a `review` step → `/code-review` (or `/python-review` if the language is clearly Python). Do not emit raw agent names as commands.

## How It Works

### Phase 0 — Read the plan

1. Read `<plan-doc-path>`. If missing or empty, report and stop.
2. Optionally detect the dominant project language from markers (`pyproject.toml` / `uv.lock` / `requirements.txt` → python; `package.json` → typescript; `go.mod` → go; `Cargo.toml` → rust; `CMakeLists.txt` or top-level `*.cpp` → cpp; `pom.xml` / `build.gradle` → java; `build.gradle.kts` or top-level Kotlin → kotlin; `pubspec.yaml` → flutter). This is informational and can be included in the task description so the chosen command has context.
3. Normalize any agent names declared in the plan to tags or commands using the catalogue above. Never emit a bare agent name as the command.

### Phase 1 — Decompose steps

Identify "step units" in priority order:

1. Explicit numbering: `## Step N` / `### Phase N` / `## N. ...` / top-level ordered list.
2. A "Step" column in a table.
3. `---`-separated blocks with verb-led headings.
4. Otherwise treat each H2 as one step.

Per step extract `id` (1-based), `title` (≤ 80 chars), `intent` (1–3 sentences), `tags`.

### Phase 2 — Tag and pick command

Use the catalogue above. The output of this phase is a single command per step, not an agent chain. The command itself runs the right agent pipeline.

### Phase 3 — Compress task description

Each emitted `<task description>` must:

- Be self-contained (the command does not need the plan document open).
- Start with `[Plan: <path>#step-<id>]`.
- Include 1–3 verifiable acceptance criteria.
- Include a Scope guard (`Out of scope: ...`) **only if the plan declares one for this step**. Inherit verbatim. If the plan has no out-of-scope statement, omit the clause entirely — do not invent one.
- Be 200–600 characters; one line; embedded `"` escaped as `\"`; no literal newlines.

### Phase 4 — Output

Emit Markdown:

````markdown
# Plan-Orchestrate Result

**Plan**: `<path>`
**Steps**: <N>
**Scope**: <all | step:n | range:a-b>

## Steps overview

| # | Title | Tags | Command |
|---|---|---|---|
| 1 | ... | impl, security | `/orch-add-feature` |
| ... | | | |

---

## Step 1 — <title>

**Intent**: <1–3 sentences>
**Tags**: <a, b>
**Command rationale**: <why this command and what it will run>

```bash
/orch-add-feature "[Plan: docs/foo.md#step-1] <compressed task description>; Acceptance: <1–3 items>; Out of scope: <…>"
```
````

Append a final "Batch execution" block aggregating every step's command in order so the user can paste them all at once. **Skip the Batch block in overview-only mode** (see "Large plan" edge case): when only the overview table is being emitted, there are no per-step commands to aggregate.

### Phase 5 — Self-check (run before emitting)

- [ ] Every command is from the catalogue above; no `/orchestrate`, `/ecc:orchestrate`, or legacy-shim command appears in the rendered output.
- [ ] No invented `--mode`, `--gate`, or `--agents=...` fields.
- [ ] Each task description is single-line, double-quoted, with embedded `"` escaped.
- [ ] Each task description begins with `[Plan: <path>#step-<id>]` and includes Acceptance (1–3 items). The `Out of scope:` clause is present only when inherited from the plan.
- [ ] Overview table lists every step in the plan, regardless of `--scope`.
- [ ] Per-step detail block count matches the resolved `--scope` (full plan when `--scope=all`; one block for `step:n`; range size for `range:a-b`). In overview-only mode, no per-step blocks and no Batch block are emitted.

## Edge cases

- **No clear steps**: prefer H2/H3 splitting; if still ambiguous, report "no structured steps detected" with the document outline and ask the user to confirm running by outline.
- **Large plan (>1500 lines)**: enter **overview-only mode** — emit only the overview table and ask the user to narrow with `--scope` before re-running for details. In this mode, skip per-step detail blocks and skip the Batch execution block.
- **Step too broad** (e.g. "complete all backend work"): do not force a single command. Suggest splitting into N.a and N.b and propose a split.
- **Polyglot project**: mention the detected languages in the rationale and default the command to the generic form (`/orch-add-feature`, `/code-review`, etc.). Do not emit a language-specific command unless the language is clear from the step's scope.

## Examples

### Example 1 — Plugin mode, Python plan

Input:

```
plan-orchestrate @docs/plan/example-feature.md
```

Excerpt of expected output:

````markdown
## Step 2 — Encrypt sensitive UserProfile fields

**Intent**: Introduce an `EncryptedString` SQLAlchemy type and AES-GCM encrypt `birth_datetime` / `location` before persistence; load the key from an environment variable.
**Tags**: impl, security, db
**Command rationale**: Security-sensitive write path, so `/orch-add-feature` will run `tdd-guide`, then `database-reviewer` for the alembic migration, then `python-reviewer`, and finally `security-reviewer` because the security trigger is touched.

```bash
/orch-add-feature "[Plan: docs/plan/example-feature.md#step-2] Implement EncryptedString SQLAlchemy type and migrate UserProfile.birth_datetime/location columns; key from ENV APP_DB_KEY; Acceptance: encrypt/decrypt roundtrip tests pass; alembic upgrade/downgrade clean on empty DB; no plaintext in DB after migrate; Out of scope: cross-tenant profile sharing logic"
```
````

### Example 2 — Fix step

If a step reads "Fix the poller crash on empty NWS response", it is tagged `fix` and emits:

```bash
/orch-fix-defect "[Plan: docs/plan/example-feature.md#step-5] Fix poller crash on empty NWS response; Acceptance: reproduce crash with a failing regression test; fix makes the test pass; review the diff for error-handling gaps"
```

## Notes

- Generative only. Never invoke `/orch-add-feature`, `/code-review`, or any other command from inside this skill.
- Match the language of the plan document for task descriptions.
- Do not insert "Co-Authored-By" lines or emoji in the output unless the user explicitly asks.
