---
name: ecc-recipes
description: "Map a described workflow to the right ECC command-GROUP with run-order and stop condition, and browse all command-group recipe families. Adds a family-grouping + run-order + when-to-stop layer on top of the flat command catalog. Advisory only. TRIGGER when the user says which commands for X, what command group runs X, show ECC recipes, list ECC pipelines, or how do I run a workflow with ECC. DO NOT TRIGGER when the user wants the task executed directly, wants a single-command deep doc (use ecc-guide), or wants a draft prompt rewritten (use prompt-optimizer)."
argument-hint: <workflow description | empty=list all>
origin: community
author: KyawZinLatt
version: "1.0.0"
---

# ECC Recipes

One entry point for "which group of ECC slash-commands runs my workflow, in what
order, and when do I stop." Also browses every command-group recipe family.

Fills the gap between two existing skills:

- `ecc-guide` — lists commands and where to read docs, but as a flat catalog.
- `prompt-optimizer` — matches a task to components, but outputs a single prompt,
  not a multi-command group with run-order and stop condition.

This skill adds: **family grouping + run-order + stop condition.**

## When to Activate

- "Which command group do I run for <workflow>?"
- "What's the command sequence to build an MVP / fix a defect / refactor?"
- "Show me all ECC command-group recipes" (catalog mode)
- "How many workflow pipelines does ECC have?"
- User invokes `/ecc-recipes` with or without a description.

### Do Not Use When

- User wants the task done now — route to the actual command, don't describe it.
- User wants deep docs for ONE command — use `ecc-guide`.
- User wants a draft prompt rewritten — use `prompt-optimizer`.

## Core Principle

**Answer from current files, not memory.** The command set changes; never
hardcode counts or member lists. Read the live `commands/` directory each run,
then classify into families.

### Live reads

Resolve the commands directory (first that exists), then list names:

```bash
for D in \
  "$HOME"/.claude/plugins/marketplaces/ecc/commands \
  "$HOME"/.claude/plugins/cache/ecc/ecc/*/commands \
  ./commands \
  ./.claude/commands \
  "$HOME"/.claude/commands; do
  [ -d "$D" ] && CMD_DIR="$D" && break
done
[ -z "${CMD_DIR:-}" ] && { echo "No ECC commands directory found."; return 1; }
find "$CMD_DIR" -maxdepth 1 -name '*.md' -exec basename {} .md \; | sort
```

Optionally read `manifests/install-*.json` if present for richer grouping. Use
the smallest set of reads needed.

## Family Classification (by prefix)

Group command names by leading prefix; map known singletons by hand. Families are
derived live — the table below is the *classification rule*, not a frozen list.

| Family prefix | Recipe meaning | Typical run-order |
|---|---|---|
| `orch-*` | gated Research, Plan, TDD, Review, Commit per task type | pick one orch-* by task kind; it runs its own internal phases |
| `multi-*` | multi-model workflow | `multi-plan` then `multi-execute` then review (or `multi-workflow` end-to-end) |
| `prp-*` | PRD to plan to implement to PR pipeline | `prp-prd` then `prp-plan` then `prp-implement` then `prp-commit` then `prp-pr` |
| `epic-*` | large multi-unit epic, parallel | `epic-decompose` then `epic-claim` then `epic-validate` then `epic-review` then `epic-unblock` then `epic-sync` then `epic-publish` |
| `loop-*` | managed autonomous loop and monitor | `loop-start <pattern>` then watch with `loop-status` |
| `gan-*` | generator and evaluator loop | `gan-build` (code) or `gan-design` (UI); self-looping |
| `*-build` / `*-review` / `*-test` | per-language CI triad | `<lang>-test` (TDD) then `<lang>-build` (fix) then `<lang>-review` |
| `hookify-*` | behavior-hook management | `hookify` then `hookify-list` then `hookify-configure` |
| `learn` / `instinct-*` / `evolve` / `promote` / `prune` | continuous-learning | `learn` then `instinct-status` then `evolve` then `promote` |
| singletons | `santa-loop`, `plan`, `plan-prd`, `pr`, `code-review`, `checkpoint`, etc. | standalone or glue between groups |

Any command not matching a prefix rule → list it under **singletons** with its
one-line description.

## How It Works

```
1. Live-read command names from CMD_DIR.
2. Classify into families by prefix and a singleton map.
3. If a workflow description was given -> MATCH MODE.
   If none -> CATALOG MODE.
4. Advisory only: print the plan. Never run the matched commands.
```

### Catalog mode (no description)

Output the family table: each family, member count, members, one-line meaning,
typical run-order. End with the total command count and a prompt to describe a
workflow for a matched recipe.

### Match mode (description given)

1. Restate the workflow in one sentence.
2. Pick the best 1-2 families; say WHY in one line each.
3. **Run-order block** — exact command sequence for the matched family.
4. **Stop condition** — always explicit (max-runs, completion-signal,
   review-passes, or single-shot). For autonomous loops, warn about subscription
   burn and recommend a backstop bound.
5. **Where to read** — the `commands/<name>.md` path plus `/ecc-guide <name>`.

## Output Template (match mode)

```
Workflow: <one-sentence restatement>

Best fit: <family> — <why>
(Alt: <family> — <why>)

Run-order:
  /<cmd1>   # job
  /<cmd2>   # job
  /<cmd3>   # job
  STOP when: <condition>
  WARNING (autonomous loops only): an unbounded loop burns subscription/credits —
  add a max-iteration or max-cost backstop alongside the completion signal.

Read full docs:
  commands/<cmd1>.md   (or: /ecc-guide <cmd1>)
```

## Examples

**Catalog:** `/ecc-recipes` → prints the family table and total count.

**Match:** `/ecc-recipes plan a whole app upfront then auto-build with adversarial
review until done` → Best fit: `loop-*` (autonomous) wrapping `gan-*` or
`santa-loop` (adversarial). Run-order: `plan-prd` then
`loop-start rfc-dag --mode safe` then monitor `loop-status`; STOP when all units
pass review N consecutive times (add a max-iteration backstop to bound burn).

**Match:** `/ecc-recipes fix a bug in my Go service` → Best fit: `orch-fix-defect`
(reproduce, fix, review, commit). Alt: `go-test` then `go-build` then
`go-review`. STOP: regression test green and review pass.

## Non-Goals

- Not an executor — advisory only.
- Not per-command deep docs — that's `ecc-guide`.
- Not prompt rewriting — that's `prompt-optimizer`.
- Never hardcode command counts or member lists — always live-read.
