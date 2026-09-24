---
description: Orchestrate bootstrapping a working MVP from a design/spec doc — ingest, slice, scaffold, TDD, review, gated commit (reuses the GAN harness). Wrapper for the orch-build-mvp skill.
---

# /orch-build-mvp

Manually launch the **orch-build-mvp** orchestrator: turn an SDD/PRD/system-design
document into a running vertical slice.

## Usage

```
/orch-build-mvp <path to design/spec doc>
```

Examples:

```
/orch-build-mvp civicpulse/docs/SDD-v0.6.md
```

## What It Does

Invoke the `orch-build-mvp` skill with `$ARGUMENTS` as the doc path. The skill
(via the shared `orch-pipeline` engine, full pipeline incl. Scaffold) will:

1. Read the spec; extract scope, locked decisions, and a feature list ordered as
   **thin vertical slices** (one end-to-end path first). → **GATE 1** (approve slice plan).
2. Scaffold the first end-to-end slice.
3. Reuse the GAN harness: translate the SDD into `gan-harness/spec.md` +
   `eval-rubric.md`, then drive `/gan-build "<brief>" --skip-planner`
   (generator → evaluator loop) until the score passes or plateaus.
4. `code-reviewer` (+ `security-reviewer` on any security-trigger slice), then
   commit the scaffold and each slice as separate `feat:` commits. → **GATE 2**.

If `$ARGUMENTS` is empty, ask the user for the path to the design/spec doc.
