---
description: "Go hook usage for Go modules, packages, and services. Apply when writing, reviewing, or refactoring hook permissions, automation boundaries, and guardrails."
alwaysApply: false
---
# Go Hooks

> This file extends the common hooks rule with Go specific content.

## PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **gofmt/goimports**: Auto-format `.go` files after edit
- **go vet**: Run static analysis after editing `.go` files
- **staticcheck**: Run extended static checks on modified packages
