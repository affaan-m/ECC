---
description: "Go testing for Go modules, packages, and services. Apply when writing, reviewing, or refactoring tests, coverage, fixtures, and verification."
alwaysApply: false
---
# Go Testing

> This file extends the common testing rule with Go specific content.

## Framework

Use the standard `go test` with **table-driven tests**.

## Race Detection

Always run with the `-race` flag:

```bash
go test -race ./...
```

## Coverage

```bash
go test -cover ./...
```

## Reference

See skill: `golang-testing` for detailed Go testing patterns and helpers.
