# ECC Hook Fix — 2026-04-21

## Summary

Claude Code CLI v2.1.116 on Windows was failing all Bash tool hook invocations with:

```
PreToolUse:Bash hook error
Failed with non-blocking status code:
C:\Program Files\Git\bin\bash.exe: C:\Program Files\Git\bin\bash.exe:
cannot execute binary file

PostToolUse:Bash hook error  (同上)
```

Result: `observations.jsonl` stopped updating after `2026-04-20T23:03:38Z`
(last entry was a `parse_error` from an earlier BOM-on-stdin issue).

## Root Cause

`C:\Users\sugig\.claude\settings.local.json` had two defects:

### Defect 1 — UTF-8 BOM + CRLF line endings

The file started with `EF BB BF` (UTF-8 BOM) and used `CRLF` line terminators.
This is the PowerShell `ConvertTo-Json | Out-File` default behavior, and it is
what `patch_settings_cl_v2_simple.ps1` leaves behind when it rewrites the file.

```
00000000: efbb bf7b 0d0a 2020 2020 2268 6f6f 6b73  ...{..    "hooks
```

### Defect 2 — Double-wrapped bash.exe invocation

The command string explicitly re-invoked bash.exe:

```json
"command": "\"C:\\Program Files\\Git\\bin\\bash.exe\" \"C:\\Users\\sugig\\.claude\\skills\\continuous-learning\\hooks\\observe-wrapper.sh\""
```

When Claude Code spawns this on Windows, argument splitting does not preserve
the quoted `"C:\Program Files\..."` token correctly. The embedded space in
`Program Files` splits `argv[0]`, and `bash.exe` ends up being passed to
itself as a script file, producing:

```
bash.exe: bash.exe: cannot execute binary file
```

### Prior working shape (for reference)

Before `patch_settings_cl_v2_simple.ps1` ran, the command was simply:

```json
"command": "C:\\Users\\sugig\\.claude\\skills\\continuous-learning\\hooks\\observe.sh"
```

Claude Code on Windows detects `.sh` and invokes it via Git Bash itself — no
manual `bash.exe` wrapping needed.

## Fix

`C:\Users\sugig\.claude\settings.local.json` rewritten as UTF-8 (no BOM), LF
line endings, with the command pointing directly at the wrapper `.sh` and
passing the hook phase as a plain argument:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "C:/Users/sugig/.claude/skills/continuous-learning/hooks/observe-wrapper.sh pre"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "C:/Users/sugig/.claude/skills/continuous-learning/hooks/observe-wrapper.sh post"
          }
        ]
      }
    ]
  }
}
```

Side benefit: the `pre` / `post` argument is now routed to `observe.sh`'s
`HOOK_PHASE` variable so events are correctly logged as `tool_start` vs
`tool_complete` (previously everything was recorded as `tool_complete`).

## Verification

Direct invocation of the new command format, emulating both hook phases:

```bash
# PostToolUse path
echo '{"tool_name":"Bash","tool_input":{"command":"pwd"},"session_id":"post-fix-verify-001","cwd":"...","hook_event_name":"PostToolUse"}' \
  | "C:/Users/sugig/.claude/skills/continuous-learning/hooks/observe-wrapper.sh" post
# exit=0

# PreToolUse path
echo '{"tool_name":"Bash","tool_input":{"command":"ls"},"session_id":"post-fix-verify-pre-001","cwd":"...","hook_event_name":"PreToolUse"}' \
  | "C:/Users/sugig/.claude/skills/continuous-learning/hooks/observe-wrapper.sh" pre
# exit=0
```

`observations.jsonl` gained:

```
{"timestamp":"2026-04-21T05:57:54Z","event":"tool_complete","tool":"Bash","session":"post-fix-verify-001",...}
{"timestamp":"2026-04-21T05:57:55Z","event":"tool_start","tool":"Bash","session":"post-fix-verify-pre-001","input":"{\"command\":\"ls\"}",...}
```

Both phases now produce correctly typed events.

**Note on live CLI verification:** settings changes take effect on the next
`claude` CLI session launch. Restart the CLI and run a Bash tool call to
confirm new rows appear in `observations.jsonl` from the actual CLI session.

## Files Touched

- `C:\Users\sugig\.claude\settings.local.json` — rewritten
- `C:\Users\sugig\.claude\settings.local.json.bak-hookfix-20260421-145718` — pre-fix backup

## Known Upstream Bugs (not fixed here)

- `install_hook_wrapper.ps1` — halts at step [3/4], never reaches [4/4].
- `patch_settings_cl_v2_simple.ps1` — overwrites `settings.local.json` with
  UTF-8-BOM + CRLF and re-introduces the double-wrapped `bash.exe` command.
  Should be replaced with a patcher that emits UTF-8 (no BOM), LF, and a
  direct `.sh` path.

## Branch

`claude/hook-fix-20260421`
