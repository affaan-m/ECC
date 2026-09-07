---
name: terminal-opener
description: Open an executable and its argument array in a visible terminal window using WezTerm or macOS Terminal through a reusable, argv-preserving launch plan with dry-run, JSON, capability detection, fallback, and recovery modes. Use when an agent needs to open an interactive CLI, SSH session, local development process, sandbox, or other argv-based command in a new host terminal; diagnose whether a supported terminal is available; or provide an actionable plan when the requested terminal is unsupported.
---

# Terminal Opener

Use `scripts/open-terminal.js` to preserve an executable and every argument as
separate process entries. Never interpolate a shell command string. Keep every
spawn on `shell: false`. Default to a non-launching plan. Use `--launch` only
after the user requests a real window, or after the agent explains why visible
interaction is useful, and the argv has been reviewed.
The default launch remains backward compatible and inherits the calling
process environment, including secret-bearing variables. For sandbox review or
another sensitive target, use filtered mode so no environment variables are
inherited unless you explicitly allowlist each reviewed safe name.

## Launch a command

Pass launcher options before `--`, then pass exactly one executable followed by
its argument array:

```bash
node skills/terminal-opener/scripts/open-terminal.js \
  --launch \
  --cwd /absolute/host/path \
  -- ssh -t example.test command-with-arguments
```

Select WezTerm with `--terminal wezterm`. On macOS, select Terminal.app with
`--terminal terminal`; the accepted aliases are
`terminal / terminal.app / macos-terminal`. `ECC_TERMINAL` accepts the same
names as a user preference.

For WezTerm, run normal mode first. The launcher tries its mux with a new
window, then falls back to a detached `wezterm start` process if the mux is not
available. When fallback is used, read `muxFailure` from JSON output (or the
human-readable failure line) to diagnose why the mux path failed.

For Terminal.app, the launcher writes the reviewed target command to a private
temporary directory and passes only that command-file path to macOS `open`.
The command file quotes every target argv entry as one shell word, self-deletes
before it starts the target, and removes its directory. A failed `open` call
also removes the private temporary launcher. A detached watchdog expires any
launcher or environment file that Terminal.app never consumes. The dry-run
plan, command wrapper, and outer process argv never contain allowlisted
environment values.

## Filter the launch environment

Add `--filtered-env`, then repeat `--allow-env NAME` only for values the target
needs and that are safe to expose. Filtered mode applies to terminal detection,
the WezTerm launch paths, and the target opened by Terminal.app:

```bash
node skills/terminal-opener/scripts/open-terminal.js \
  --launch \
  --filtered-env \
  --allow-env PATH \
  --allow-env TERM \
  --cwd /absolute/host/path \
  -- podman exec -it ecc-sandbox-review bash
```

Do not allowlist token, credential, authentication-socket, cloud-profile, or
secret-bearing names. An empty allowlist passes an empty environment. A dry-run
JSON plan contains the filter mode and allowed names, never their values. The
caller must allowlist `PATH` when the selected terminal or target executable
depends on normal executable lookup. Add locale or display variables only after
reviewing their values and confirming the selected terminal needs them.

Terminal.app stores allowlisted values only in a mode-0600 environment file
inside a mode-0700 temporary directory. Its command wrapper contains only that
file's path. The target-side wrapper consumes and removes the file before the
reviewed target starts, and a bounded watchdog removes unconsumed artifacts.
Prefer an empty allowlist or safe non-secret variables for sandbox work.

WezTerm filtered launches pass only a private mode-0600 environment-file path
in the spawned argv. The target-side wrapper consumes and removes that file
before it executes the reviewed target, so reversible environment values do not
appear in the WezTerm client process arguments. The same bounded watchdog
expires the file if the terminal handoff succeeds but the target never starts.

## Recover from terminal configuration

Add `--recover` or `--standalone` when user configuration or mux state may
interfere with the requested command. Start a detached WezTerm process with:

```text
--skip-config start --always-new-process
```

Expect recovery mode to skip all user terminal configuration intentionally.
These flags are WezTerm-specific. Terminal.app ordinary mode uses macOS `open`
with a new application instance and has no stock-configuration equivalent.

## Inspect before launch

Omit `--launch` (or add `--dry-run`) and add `--json` to inspect the exact
executable, argv, working directory, terminal adapter, primary launch, and
fallback without opening a window. Treat the JSON plan as the composition
boundary for callers.

Run `--detect --json` without a command to probe terminal availability. Follow
the returned `action` when the adapter is missing or unsupported. Detection
executes `wezterm --version` for WezTerm or checks Terminal.app's bundle ID on
macOS. Treat terminals other than WezTerm and Terminal.app as unsupported plans,
not as commands to execute.
