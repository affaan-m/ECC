---
name: ultra-code
description: "Self-evolving engineering operator loop. Bootstraps persistent state files, runs a gated Orient→Plan→Execute→Verify→Evolve→Persist cycle, and rewrites its own process via numbered reversible experiments. Use for autonomous, metric-driven, long-horizon work where the agent must improve both the output and how it works."
origin: ECC
---

# ULTRA CODE Skill

A universal, tool-agnostic operating procedure for running an AI coding agent as a **self-evolving pipeline operator**. It ships measurable output, audits itself honestly, and improves its own process every cycle — without losing state between sessions.

The canonical, copy-pasteable prompt lives at [`ultra-code/ultra-code.master.prompt.md`](../../ultra-code/ultra-code.master.prompt.md). A presentation/landing version is at [`ultra-code/ultra-code-sop.html`](../../ultra-code/ultra-code-sop.html). This skill operationalizes that prompt inside ECC.

## When to Use

- Long-horizon, autonomous work where the agent runs many cycles toward one objective.
- Any project that needs **measurable progress** (a single success metric moved every cycle) rather than activity.
- Work that must **survive context loss** — state persists to disk, so a cold session resumes cleanly.
- Situations where you want the agent to **improve its own workflow** over time, not just the artifact.
- Pairs naturally with `continuous-agent-loop` / `autonomous-loops` (loop mechanics) and `continuous-learning-v2` (instincts). ULTRA CODE supplies the *operating doctrine*; those skills supply the *runner*.

Do **not** use for a single one-shot edit or quick question — the state-file overhead is not worth it.

## The Six Doctrine Principles

1. **Output over theater** — a cycle is real only if it produces a verifiable artifact.
2. **Honest self-critique** — maintain a public log of what is broken or uncertain; never hide tension.
3. **Every loop moves a number** — move a tracked metric, or be a named prerequisite that unblocks one.
4. **Memory is the moat** — state, learnings, and decisions persist to disk.
5. **Gate before you grow** — improve the process only after passing quality gates.
6. **Reversible evolution** — every self-modification is numbered, justified, and undoable.

## How It Works

### 1. Initialize state (first run only)

Create these files in the project (or a dedicated `.ultra-code/` directory). Read them at the start of every cycle.

| File | Holds |
|------|-------|
| `STATE.md` | Current objective, active task, done, next, open blockers — the cold-start brief |
| `METRICS.json` | Every tracked metric, timestamped. The success metric is mandatory |
| `LEARNINGS.md` | Append-only lessons: what was tried, what happened, what changes next |
| `TENSIONS.md` | Honesty log — unresolved problems and suspected mistakes. Never emptied to look good |
| `CHANGELOG.md` | Self-modification history — every process change, numbered and reversible |

Define the mission before cycle 1:
- **PRIMARY OBJECTIVE** — what done looks like.
- **SUCCESS METRIC** — the one number that proves it worked.
- **PIPELINE** — what the agent controls (codebase, tests, deploy, etc.).
- **HARD CONSTRAINTS** — never-violate rules (security, budget, scope, compliance).

### 2. Run the loop, every cycle

```
ORIENT  → read STATE/METRICS/TENSIONS; one line: where we are + best next move
PLAN    → smallest increment with a verifiable result; favor the one that moves the metric most
EXECUTE → build the smallest shippable unit; produce the artifact, not a description
VERIFY  → run the quality gates; never advance on red
EVOLVE  → propose exactly ONE process improvement; apply via Evolution Protocol
PERSIST → update all state files; write a compact handoff for the next cold start
```

### 3. Quality gates — all green before EVOLVE

- [ ] It runs / it works.
- [ ] It moved a tracked metric, or is a named prerequisite that unblocks one.
- [ ] It is reversible or recoverable.
- [ ] It respects every hard constraint.
- [ ] A competent stranger could understand it from `STATE.md` alone.

If any gate cannot pass, log the reason in `TENSIONS.md` — never fake a pass.

### 4. Evolution Protocol — numbered reversible experiments

Append to `CHANGELOG.md`:

```
SM-[n] | [date]
TRIGGER:    the specific friction that prompted this change
CHANGE:     what I am now doing differently
HYPOTHESIS: the metric I expect to move, and the direction
REVERT-IF:  the signal that says this made things worse
STATUS:     active → (KEPT | REVERTED after 1–3 cycles)
```

Rules: change **one** thing at a time; judge against the hypothesis after 1–3 cycles; revert if it didn't help. You may rewrite any part of your process **except** the hard constraints, the honesty contract, and the quality gates.

### 5. Return format, every response

1. `CYCLE [n]` — the one-line orientation.
2. The artifact produced this cycle.
3. Gate results — pass/fail per gate.
4. The self-modification logged, or `none — current process holding`.
5. The next single most valuable move.

## Examples

**Bootstrap on a new project**

```
/ultra-code
> Objective: cut p95 API latency on /search
> Success metric: p95 latency (ms) on /search under sustained load
> Pipeline: api/, load-test harness, CI
> Constraints: no new infra spend; no breaking the public response schema
```

The agent creates the five state files, restates the objective and metric in its own words, then runs CYCLE 1 against the smallest latency win it can verify.

**Resume cold next session**

```
/ultra-code
```

With state files already present, the agent reads `STATE.md` + `METRICS.json` + `TENSIONS.md`, orients in one line, and continues from the persisted handoff — no re-deriving context.

## Notes

- Tool-agnostic by design: the loop is the same whether the agent edits files, runs tests, or calls deploy.
- Keep state lean. `STATE.md` is a brief, not a journal; long history belongs in `LEARNINGS.md` / `CHANGELOG.md`.
- The honesty contract is load-bearing: a self-improving system that lies about gate results optimizes garbage.
