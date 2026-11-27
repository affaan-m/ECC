# ECC 1.10.1 release announcement draft

ECC 1.10.1 is the follow-up stabilization release to 1.10.0.

This release is focused on install correctness, cross-surface naming clarity, Windows/PowerShell recovery, Cursor project install correctness, and Claude Code hook compatibility. It is not a feature-heavy release.

## What landed in the stabilization pass
- npm/package/release surfaces are aligned and `ecc-universal@1.10.0` is live on npm
- Windows locale/path and PowerShell install-path regressions fixed
- Bash hook process-storm regression fixed
- Claude Code 2.1.x hook schema compatibility fixed
- Cursor native project install path repaired:
  - `.cursor/hooks.json` now includes the required schema/version surface
  - `.cursor/mcp.json` is written in the native Cursor project location
- continuous-learning-v2 now accepts `claude-desktop` as a valid entrypoint
- Windows observe path now skips `AppInstallerPythonRedirector.exe`
- docs now distinguish plugin installs from full manual installs more clearly

## What 1.10.1 is for
- make the current install surfaces predictable
- reduce stale naming/install guidance
- close the follow-up regressions from 1.10.0
- give users one stable update point instead of piecing together fixes across issues and discussions

## Included release fixes
- `#1543` Cursor native project hook + MCP install repair
- `#1524` Claude Code v2.1.116 argv-dup mitigation in `settings.local.json`
- `#1522` continuous-learning-v2 accepts `claude-desktop` as a valid entrypoint
- `#1511` Windows observe path skips `AppInstallerPythonRedirector.exe`
- `#1546` continuous-learning-v2 plugin quick start correction
- `#1535` hero overflow follow-up

## Important naming clarification
- Claude marketplace/plugin identifier: `everything-claude-code@everything-claude-code`
- npm package: `ecc-universal`
- GitHub repo: `affaan-m/everything-claude-code`

Those are intentionally different surfaces. The plugin identifier follows Anthropic marketplace rules; the npm package remains `ecc-universal`.

## Still being monitored
This should be announced as a stabilization release, not as “all edge cases are solved.”

We are still watching for:
- OS-specific edge cases across macOS, Windows, Linux
- shell-specific behavior differences
- Cursor vs Claude plugin install-path mismatches that only appear in older or mixed installs
- third-party provider/tool-name compatibility reports that still need current-main repro

Current watch-list examples:
- `#1520` likely obsolete unless repro returns on the current installer
- `#1516` not gating unless reproduced on current `main`
- `#1484` remains a Windows umbrella/watch-list issue rather than an active release gate

## Recommended update guidance
If you hit 1.10.0 install/runtime problems:
1. update to the latest package/plugin surface
2. avoid mixing plugin install plus full manual repo copy unless the docs explicitly say to
3. if problems persist, report:
   - OS + shell
   - Claude Code/Cursor version
   - install method used
   - exact stderr/output
   - whether the issue is plugin install, npm install, repo sync, or Cursor project install
