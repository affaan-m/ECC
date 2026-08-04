---
description: Fix Go build errors, go vet warnings, and linter issues incrementally. Invokes the go-build-resolver agent for minimal, surgical fixes.
---

# Go Build and Fix

This command invokes the **go-build-resolver** agent to incrementally fix Go build errors with minimal changes.

## What This Command Does

1. **Run Diagnostics**: Execute `go build`, `go vet`, `staticcheck`
2. **Parse Errors**: Group by file and sort by severity
3. **Fix Incrementally**: One error at a time
4. **Verify Each Fix**: Re-run build after each change
5. **Report Summary**: Show what was fixed and what remains

## When to Use

Use `/go-build` when:
- `go build ./...` fails with errors
- `go vet ./...` reports issues
- `golangci-lint run` shows warnings
- Module dependencies are broken
- After pulling changes that break the build

## Diagnostic Commands Run

```bash
# Primary build check
go build ./...

# Static analysis
go vet ./...

# Extended linting (if available)
staticcheck ./...
golangci-lint run

# Module issues
go mod verify
go mod tidy -v
```

## Example Session

```text
User: /go-build

Agent:
# Go Build Resolution

## Initial Diagnostics

```bash
$ go build ./...
internal/service/user.go:25:15: undefined: UserRepository
internal/handler/api.go:42:9: cannot use x (type string) as type int
internal/handler/api.go:58:2: missing return at end of function
```

Errors found: 3

## Fix 1: Undefined Identifier

File: internal/service/user.go:25
Error: undefined: UserRepository
Cause: Missing import

```go
// Added import
import "project/internal/repository"

// Changed
var repo UserRepository
// To
var repo repository.UserRepository
```

```bash
$ go build ./...
# 2 errors remaining
```

## Fix 2: Type Mismatch

File: internal/handler/api.go:42
Error: cannot use x (type string) as type int

```go
// Changed
count := params.Get("count")
// To
countStr := params.Get("count")
count, _ := strconv.Atoi(countStr)
```

```bash
$ go build ./...
# 1 error remaining
```

## Fix 3: Missing Return

File: internal/handler/api.go:58
Error: missing return at end of function

```go
func GetUser(id string) (*User, error) {
    if id == "" {
        return nil, ErrInvalidID
    }
    user := findUser(id)
    // Added missing return
    return user, nil
}
```

```bash
$ go build ./...
# Build successful!
```

## Final Verification

```bash
$ go vet ./...
# No issues

$ go test ./...
ok      project/internal/service   0.015s
ok      project/internal/handler   0.023s
```

## Summary

| Metric | Count |
|--------|-------|
| Build errors fixed | 3 |
| Vet warnings fixed | 0 |
| Files modified | 2 |
| Remaining issues | 0 |

Build Status: PASS: SUCCESS
```

## Common Errors Fixed

| Error | Typical Fix |
|-------|-------------|
| `undefined: X` | Add import or fix typo |
| `cannot use X as Y` | Type conversion or fix assignment |
| `missing return` | Add return statement |
| `X does not implement Y` | Add missing method |
| `import cycle` | Restructure packages |
| `declared but not used` | Remove or use variable |
| `cannot find package` | `go get` or `go mod tidy` |

## Fix Strategy

1. **Build errors first** - Code must compile
2. **Vet warnings second** - Fix suspicious constructs
3. **Lint warnings third** - Style and best practices
4. **One fix at a time** - Verify each change
5. **Minimal changes** - Don't refactor, just fix

## Stop Conditions

The agent will stop and report if:
- Same error persists after 3 attempts
- Fix introduces more errors
- Requires architectural changes
- Missing external dependencies

## Related Commands

- `/go-test` - Run tests after build succeeds
- `/go-review` - Review code quality
- `verification-loop` skill - Full verification loop

## Related

- Agent: `agents/go-build-resolver.md`
- Skill: `skills/golang-patterns/`
