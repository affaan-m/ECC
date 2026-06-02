---
name: ultra-code
description: Run the ULTRA CODE self-evolving operator loop — bootstrap persistent state, then run one gated Orient→Plan→Execute→Verify→Evolve→Persist cycle
command: true
---

# ULTRA CODE Command

Invokes the `ultra-code` skill to run the self-evolving engineering operator loop in the current project.

## Implementation

1. Invoke the **`ultra-code`** skill (`skills/ultra-code/SKILL.md`) and follow it exactly.
2. **If the state files do not yet exist** (`STATE.md`, `METRICS.json`, `LEARNINGS.md`, `TENSIONS.md`, `CHANGELOG.md`):
   - Collect the mission from the user's arguments or ask for any missing field:
     - **PRIMARY OBJECTIVE** — what done looks like
     - **SUCCESS METRIC** — the one number that proves it worked
     - **PIPELINE** — what the agent controls
     - **HARD CONSTRAINTS** — never-violate rules
   - Create the five state files, restate the objective and success metric in your own words to confirm understanding, then run **CYCLE 1**.
3. **If the state files already exist**, read `STATE.md` + `METRICS.json` + `TENSIONS.md`, orient in one line, and run the **next cycle** from the persisted handoff.

## Usage

```
/ultra-code                         # bootstrap (prompts for mission) or resume the next cycle
/ultra-code <objective>             # bootstrap with the objective inline
```

Examples:

```
/ultra-code cut p95 latency on /search; metric = p95 ms; no new infra spend
/ultra-code                         # next session — resumes cold from STATE.md
```

## Loop (each cycle)

`ORIENT → PLAN → EXECUTE → VERIFY → EVOLVE → PERSIST`

All quality gates must pass before EVOLVE; if a gate can't pass, log it in `TENSIONS.md` rather than faking it.

## Return format (every cycle)

1. `CYCLE [n]` — one-line orientation
2. The artifact produced
3. Gate results (pass/fail per gate)
4. The self-modification logged, or `none — current process holding`
5. The next single most valuable move

See `skills/ultra-code/SKILL.md` for full doctrine, the Evolution Protocol format, and the canonical master prompt at `ultra-code/ultra-code.master.prompt.md`.
