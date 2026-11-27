---
description: "Swift hooks extending common rules"
globs: ["**/*.swift", "**/Package.swift"]
alwaysApply: false
---
# Swift Hooks

> This file extends the common hooks rule with Swift specific content.

## PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **SwiftFormat**: Auto-format `.swift` files after edit
- **SwiftLint**: Run lint checks after editing `.swift` files
- **swift build**: Type-check modified packages after edit

## Warning

Flag `print()` statements -- use `os.Logger` or structured logging instead for production code.
