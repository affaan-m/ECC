---
description: "Go coding style for Go modules, packages, and services. Apply when writing, reviewing, or refactoring formatting, naming, structure, and readability."
alwaysApply: false
---
# Go Coding Style

> This file extends the common coding style rule with Go specific content.

## Formatting

- **gofmt** and **goimports** are mandatory -- no style debates

## Design Principles

- Accept interfaces, return structs
- Keep interfaces small (1-3 methods)

## Error Handling

Always wrap errors with context:

```go
if err != nil {
    return fmt.Errorf("failed to create user: %w", err)
}
```

## Reference

See skill: `golang-patterns` for comprehensive Go idioms and patterns.
