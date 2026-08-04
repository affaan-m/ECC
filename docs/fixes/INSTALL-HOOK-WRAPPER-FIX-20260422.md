# install_hook_wrapper.ps1 argv-dup bug workaround (2026-04-22)

## Summary

`docs/fixes/install_hook_wrapper.ps1` is the PowerShell helper that copies
`observe-wrapper.sh` into `~/.claude/skills/continuous-learning/hooks/` and
rewrites `~/.claude/settings.local.json` so the observer hook points at it.

The previous version produced a hook command of the form:

```
"C:\Program Files\Git\bin\bash.exe" "C:\Users\...\observe-wrapper.sh"
```

Under Claude Code v2.1.116 the first argv token is duplicated. When that token
is a quoted Windows executable path, `bash.exe` is re-invoked with itself as
its `$0`, which fails with `cannot execute binary file` (exit 126). PR #1524
documents the root cause; this script is a companion that keeps the installer
in sync with the fixed `settings.local.json` layout.

## What the fix does

- First token is now the PATH-resolved `bash` (no quoted `.exe` path), so the
  argv-dup bug no longer passes a binary as a script.
- The wrapper path is normalized to forward slashes before it is embedded in
  the hook command, avoiding MSYS backslash handling surprises.
- `PreToolUse` and `PostToolUse` receive distinct commands with explicit
  `pre` / `post` positional arguments, matching the shape the wrapper expects.
- The settings file is written with LF line endings so downstream JSON parsers
  never see mixed CRLF/LF output from `ConvertTo-Json`.

## Resulting command shape

```
bash "C:/Users/<you>/.claude/skills/continuous-learning/hooks/observe-wrapper.sh" pre
bash "C:/Users/<you>/.claude/skills/continuous-learning/hooks/observe-wrapper.sh" post
```

## Usage

```powershell
# Place observe-wrapper.sh next to this script, then:
pwsh -File docs/fixes/install_hook_wrapper.ps1
```

The script backs up `settings.local.json` to
`settings.local.json.bak-<timestamp>` before writing.

## PowerShell 5.1 compatibility

`ConvertFrom-Json -AsHashtable` is PowerShell 7+ only. The script tries
`-AsHashtable` first and falls back to a manual `PSCustomObject` →
`Hashtable` conversion on Windows PowerShell 5.1. Both hook buckets
(`PreToolUse`, `PostToolUse`) and their inner `hooks` arrays are
materialized as `System.Collections.ArrayList` before serialization, so
PS 5.1's `ConvertTo-Json` cannot collapse single-element arrays into
bare objects. Verified by running `powershell -NoProfile -File
docs/fixes/install_hook_wrapper.ps1` on a Windows 11 machine with only
Windows PowerShell 5.1 installed (no `pwsh`).

## Related

- PR #1524 — settings.local.json shape fix (same argv-dup root cause)
- PR #1511 — skip `AppInstallerPythonRedirector.exe` in observer python resolution
- PR #1539 — locale-independent `detect-project.sh`
- PR #1542 — `patch_settings_cl_v2_simple.ps1` companion fix
