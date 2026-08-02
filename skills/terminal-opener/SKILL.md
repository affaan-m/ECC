---
name: terminal-opener
description: Open an executable and its argument array in a visible terminal window through a reusable, shell-free launch plan with dry-run, JSON, capability detection, detached fallback, and standalone recovery modes. Use when Codex needs to open an interactive CLI, SSH session, local development process, sandbox, or other argv-based command in a new host terminal; diagnose whether a supported terminal is available; or provide an actionable plan when the requested terminal is unsupported.
---

# Terminal Opener

Use `scripts/open-terminal.js` to preserve an executable and every argument as
separate process entries. Never interpolate a shell command string. Keep every
spawn on `shell: false`. Default to a non-launching plan. Use `--launch` only
after the user explicitly requests a real window and the argv has been reviewed.
Remember that the target can inherit terminal environment variables; never pass
secret-bearing values unless the requested interactive workflow requires them.

## Launch a command

Pass launcher options before `--`, then pass exactly one executable followed by
its argument array:

```bash
node skills/terminal-opener/scripts/open-terminal.js \
  --launch \
  --cwd /absolute/host/path \
  -- ssh -t example.test command-with-arguments
```

Run normal mode first. Let WezTerm try its mux with a new window, then let the
launcher fall back to a detached `wezterm start` process if the mux is not
available.

## Recover from terminal configuration

Add `--recover` or `--standalone` when user configuration or mux state may
interfere with the requested command. Start a detached WezTerm process with:

```text
--skip-config start --always-new-process
```

Expect recovery mode to skip all user terminal configuration intentionally.

## Inspect before launch

Omit `--launch` (or add `--dry-run`) and add `--json` to inspect the exact
executable, argv, working directory, terminal adapter, primary launch, and
fallback without opening a window. Treat the JSON plan as the composition
boundary for callers.

Run `--detect --json` without a command to probe terminal availability. Follow
the returned `action` when the adapter is missing or unsupported. Use WezTerm
for the current adapter; treat other requested terminals as unsupported plans,
not as commands to execute.
