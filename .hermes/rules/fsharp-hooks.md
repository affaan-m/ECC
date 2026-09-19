---
paths:
  - "**/*.fs"
  - "**/*.fsx"
  - "**/*.fsproj"
  - "**/*.sln"
  - "**/*.slnx"
  - "**/Directory.Build.props"
  - "**/Directory.Build.targets"
---
# F# Hooks

> This file extends [common/hooks.md](../common/hooks.md) with F#-specific content.

## PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **fantomas**: Auto-format edited F# files
- **dotnet build**: Verify the solution or project still compiles after edits
- **dotnet test --no-build**: Re-run the nearest relevant test project after behavior changes

## Stop Hooks

- Run a final `dotnet build` before ending a session with broad F# changes
- Warn on modified `appsettings*.json` files so secrets do not get committed
