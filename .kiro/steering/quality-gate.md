---
inclusion: manual
description: Quality gate instructions — invoke with #quality-gate to run build, type check, lint, and tests.
---

# Quality Gate

Run a full quality gate check against your project: build, type check, lint, and tests.

## How to Use

### Option 1: Invoke via steering (recommended)

Reference `#quality-gate` in chat to activate this steering file, then ask the agent to run the quality gate:

```
#quality-gate Run the quality gate on this project.
```

The agent will execute `.kiro/scripts/quality-gate.sh` and report results.

### Option 2: Enable the PostTaskExec hook

If you want the quality gate to run automatically after every spec task:

1. Open the Agent Hooks panel in Kiro
2. Find `quality-gate` and toggle it **on**

Or edit `.kiro/hooks/quality-gate.json` and set `"enabled": true`.

> **Note:** Enabling automatic execution runs build, lint, and tests against your project after every spec task completion. This consumes credits and may be slow for large projects. Use Option 1 for on-demand execution.

### Option 3: Run manually in terminal

```bash
bash .kiro/scripts/quality-gate.sh
```

## What It Checks

1. **Build** — Runs `<pm> run build` if a build script exists
2. **Type check** — TypeScript (`tsc --noEmit`), Python (`pyright`/`mypy`)
3. **Lint** — Biome, ESLint, Ruff, or golangci-lint (auto-detected)
4. **Tests** — `<pm> run test`, `pytest`, or `go test ./...`

Checks are skipped gracefully if the relevant tooling is not found.
