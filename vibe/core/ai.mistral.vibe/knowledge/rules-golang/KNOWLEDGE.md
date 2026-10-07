---
name: rules-golang
description: ECC golang engineering rules for coding style, patterns, security, and testing.
display_name: "ECC Golang Rules"
icon: book
---

# ECC Golang Rules

## Go Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with Go specific content.

### Formatting

- **gofmt** and **goimports** are mandatory — no style debates

### Design Principles

- Accept interfaces, return structs
- Keep interfaces small (1-3 methods)

### Error Handling

Always wrap errors with context:

```go
if err != nil {
    return fmt.Errorf("failed to create user: %w", err)
}
```

### Reference

See skill: `golang-patterns` for comprehensive Go idioms and patterns.

## Go Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Go specific content.

### PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **gofmt/goimports**: Auto-format `.go` files after edit
- **go vet**: Run static analysis after editing `.go` files
- **staticcheck**: Run extended static checks on modified packages

## Go Patterns

> This file extends [common/patterns.md](../common/patterns.md) with Go specific content.

### Functional Options

```go
type Option func(*Server)

func WithPort(port int) Option {
    return func(s *Server) { s.port = port }
}

func NewServer(opts ...Option) *Server {
    s := &Server{port: 8080}
    for _, opt := range opts {
        opt(s)
    }
    return s
}
```

### Small Interfaces

Define interfaces where they are used, not where they are implemented.

### Dependency Injection

Use constructor functions to inject dependencies:

```go
func NewUserService(repo UserRepository, logger Logger) *UserService {
    return &UserService{repo: repo, logger: logger}
}
```

### Reference

See skill: `golang-patterns` for comprehensive Go patterns including concurrency, error handling, and package organization.

## Go Security

> This file extends [common/security.md](../common/security.md) with Go specific content.

### Secret Management

```go
apiKey := os.Getenv("OPENAI_API_KEY")
if apiKey == "" {
    log.Fatal("OPENAI_API_KEY not configured")
}
```

### Security Scanning

- Use **gosec** for static security analysis:
  ```bash
  gosec ./...
  ```

### Context & Timeouts

Always use `context.Context` for timeout control:

```go
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()
```

## Go Testing

> This file extends [common/testing.md](../common/testing.md) with Go specific content.

### Framework

Use the standard `go test` with **table-driven tests**.

### Race Detection

Always run with the `-race` flag:

```bash
go test -race ./...
```

### Coverage

```bash
go test -cover ./...
```

### Reference

See skill: `golang-testing` for detailed Go testing patterns and helpers.
