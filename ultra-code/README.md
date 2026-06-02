# ULTRA CODE

A universal, white-label, **tool-agnostic** operating procedure for running an AI coding agent as a self-evolving pipeline operator. It ships measurable output, audits itself honestly, and rewrites its own process every cycle — while persisting state to disk so a cold session resumes cleanly.

## Contents

| File | What it is |
|------|------------|
| [`ultra-code.master.prompt.md`](ultra-code.master.prompt.md) | The canonical, copy-pasteable master prompt. Edit only the five bracketed `## MISSION` fields. |
| [`ultra-code-sop.html`](ultra-code-sop.html) | Standalone landing page / SOP presentation of the same doctrine, with a copy button. Open in a browser. |
| `../skills/ultra-code/SKILL.md` | ECC skill that operationalizes the loop inside Claude Code. |
| `../commands/ultra-code.md` | `/ultra-code` slash command — bootstrap or advance one cycle. |

## Quick start

**Inside ECC / Claude Code:**

```
/ultra-code cut p95 latency on /search; metric = p95 ms; constraint = no new infra spend
```

**Anywhere else (Cursor, raw API, another agent):** copy [`ultra-code.master.prompt.md`](ultra-code.master.prompt.md), fill the five bracketed fields, paste it in as a system prompt or first message.

## The model

- **Doctrine** — six principles: output over theater, honest self-critique, every loop moves a number, memory is the moat, gate before you grow, reversible evolution.
- **Loop** — `ORIENT → PLAN → EXECUTE → VERIFY → EVOLVE → PERSIST`, run every cycle.
- **State** — five files persist between cycles: `STATE.md`, `METRICS.json`, `LEARNINGS.md`, `TENSIONS.md`, `CHANGELOG.md`.
- **Gates** — all green before the agent is allowed to evolve its own process.
- **Evolution Protocol** — self-modifications are numbered, hypothesis-driven, reversible experiments (`SM-[n]`), kept or reverted by the data after 1–3 cycles.

See `../skills/ultra-code/SKILL.md` for the full reference.
