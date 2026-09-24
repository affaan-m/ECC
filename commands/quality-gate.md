---
description: Run the ECC formatter quality gate for a single file and report remediation steps.
---

# Quality Gate Command

Operator entry point for the formatter quality gate that normally runs as the
`post:quality-gate` PostToolUse hook (`scripts/hooks/quality-gate.js`).

## How it actually works

The gate is a single-file formatter check driven by hook input, not CLI flags:

- The script reads the target from the hook's stdin JSON
  (`tool_input.file_path`); it does not take a path argument.
- Behavior toggles are environment variables:
  - `ECC_QUALITY_GATE_FIX=true` - apply formatting fixes instead of check-only
  - `ECC_QUALITY_GATE_STRICT=true` - log formatter failures as gate failures
- Coverage by file type:
  - `.ts/.tsx/.js/.jsx/.json/.md` - Biome `check` or Prettier `--check`,
    whichever the project ships (JS/TS under Biome is skipped here because
    `post-edit-format` already runs `biome check --write`)
  - `.go` - `gofmt`
  - `.py` - `ruff format`
- Lint and type checks are not part of this gate. Use the `verification-loop`
  skill or the language verification skills for lint/type/test pipelines.

## Usage

To run the gate manually against one file, pipe hook-style JSON into the
script (set the env toggles first if you want fix or strict behavior):

```bash
echo '{"tool_input":{"file_path":"src/example.ts"}}' \
  | ECC_QUALITY_GATE_FIX=true node scripts/hooks/quality-gate.js
```

Then report formatter findings and concrete remediation steps.

## Notes

Hook wiring lives in `hooks/hooks.json` (`post:quality-gate`, profiles
`standard`/`strict` via `run-with-flags.js`).

## Arguments

$ARGUMENTS:

- `[path]` optional file to check. The script itself takes no CLI
  arguments - when a path is given, substitute it as `tool_input.file_path`
  in the stdin JSON shown above before running the command
