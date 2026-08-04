# patch_settings_cl_v2_simple.ps1 argv-dup bug workaround (2026-04-22)

## Summary

`docs/fixes/patch_settings_cl_v2_simple.ps1` is the minimal PowerShell
helper that patches `~/.claude/settings.local.json` so the observer hook
points at `observe-wrapper.sh`. It is the "simple" counterpart of
`docs/fixes/install_hook_wrapper.ps1` (PR #1540): it never copies the
wrapper script, it only rewrites the settings file.

The previous version of this helper registered the raw `observe.sh` path
as the hook command, shared a single command string across `PreToolUse`
and `PostToolUse`, and relied on `ConvertTo-Json` defaults that can emit
CRLF line endings. Under Claude Code v2.1.116 the first argv token is
duplicated, so the wrapper needs to be invoked with a specific shape and
the two hook phases need distinct entries.

## What the fix does

- First token is the PATH-resolved `bash` (no quoted `.exe` path), so the
  argv-dup bug no longer passes a binary as a script. Matches PR #1524 and
  PR #1540.
- The wrapper path is normalized to forward slashes before it is embedded
  in the hook command, avoiding MSYS backslash handling surprises.
- `PreToolUse` and `PostToolUse` receive distinct commands with explicit
  `pre` / `post` positional arguments.
- The settings file is written UTF-8 (no BOM) with CRLF normalized to LF
  so downstream JSON parsers never see mixed line endings.
- Existing hooks (including legacy `observe.sh` entries and unrelated
  third-party hooks) are preserved — the script only appends the new
  wrapper entries when they are not already registered.
- Idempotent on re-runs: a second invocation recognizes the canonical
  command strings and logs `[SKIP]` instead of duplicating entries.

## Resulting command shape

```
bash "C:/Users/<you>/.claude/skills/continuous-learning/hooks/observe-wrapper.sh" pre
bash "C:/Users/<you>/.claude/skills/continuous-learning/hooks/observe-wrapper.sh" post
```

## Usage

```powershell
pwsh -File docs/fixes/patch_settings_cl_v2_simple.ps1
# Windows PowerShell 5.1 is also supported:
powershell -NoProfile -ExecutionPolicy Bypass -File docs/fixes/patch_settings_cl_v2_simple.ps1
```

The script backs up the existing settings file to
`settings.local.json.bak-<timestamp>` before writing.

## PowerShell 5.1 compatibility

`ConvertFrom-Json -AsHashtable` is PowerShell 7+ only. The script tries
`-AsHashtable` first and falls back to a manual `PSCustomObject` →
`Hashtable` conversion on Windows PowerShell 5.1. Both hook buckets
(`PreToolUse`, `PostToolUse`) and their inner `hooks` arrays are
materialized as `System.Collections.ArrayList` before serialization, so
PS 5.1's `ConvertTo-Json` cannot collapse single-element arrays into bare
objects.

## Verified cases (dry-run)

1. Fresh install — no existing settings → creates canonical file.
2. Idempotent re-run — existing canonical file → `[SKIP]` both phases,
   file contents unchanged apart from the pre-write backup.
3. Legacy `observe.sh` present → preserves the legacy entries and
   appends the new `observe-wrapper.sh` entries alongside them.

All three cases produce LF-only output and match the shape registered by
PR #1524's manual fix to `settings.local.json`.

## Related

- PR #1524 — settings.local.json shape fix (same argv-dup root cause)
- PR #1539 — locale-independent `detect-project.sh`
- PR #1540 — `install_hook_wrapper.ps1` argv-dup fix (companion script)
