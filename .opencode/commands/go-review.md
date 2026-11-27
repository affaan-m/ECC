---
description: Go code review for idiomatic patterns
agent: go-reviewer
subtask: true
---

# Go Review Command

Review Go code for idiomatic patterns and best practices: $ARGUMENTS

## Your Task

1. **Analyze Go code** for idioms and patterns
2. **Check concurrency** - goroutines, channels, mutexes
3. **Review error handling** - proper error wrapping
4. **Verify performance** - allocations, bottlenecks

## Review Checklist

### Idiomatic Go
- [ ] Package naming (lowercase, no underscores)
- [ ] Variable naming (camelCase, short)
- [ ] Interface naming (ends with -er)
- [ ] Error naming (starts with Err)

### Error Handling
- [ ] Errors are checked, not ignored
- [ ] Errors wrapped with context (`fmt.Errorf("...: %w", err)`)
- [ ] Sentinel errors used appropriately
- [ ] Custom error types when needed

### Concurrency
- [ ] Goroutines properly managed
- [ ] Channels buffered appropriately
- [ ] No data races (use `-race` flag)
- [ ] Context passed for cancellation
- [ ] WaitGroups used correctly

### Performance
- [ ] Avoid unnecessary allocations
- [ ] Use `sync.Pool` for frequent allocations
- [ ] Prefer value receivers for small structs
- [ ] Buffer I/O operations

### Code Organization
- [ ] Small, focused packages
- [ ] Clear dependency direction
- [ ] Internal packages for private code
- [ ] Godoc comments on exports

## Report Format

### Idiomatic Issues
- [file:line] Issue description
  Suggestion: How to fix

### Error Handling Issues
- [file:line] Issue description
  Suggestion: How to fix

### Concurrency Issues
- [file:line] Issue description
  Suggestion: How to fix

### Performance Issues
- [file:line] Issue description
  Suggestion: How to fix

---

**TIP**: Run `go vet` and `staticcheck` for additional automated checks.
