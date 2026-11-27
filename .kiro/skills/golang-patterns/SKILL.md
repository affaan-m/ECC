---
name: golang-patterns
description: >
  Go-specific design patterns and best practices including functional options,
  small interfaces, dependency injection, concurrency patterns, error handling,
  and package organization. Use when working with Go code to apply idiomatic
  Go patterns.
metadata:
  origin: ECC
  globs: ["**/*.go", "**/go.mod", "**/go.sum"]
---

# Go Patterns

> This skill provides comprehensive Go patterns extending common design principles with Go-specific idioms.

## Functional Options

Use the functional options pattern for flexible constructor configuration:

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

**Benefits:**
- Backward compatible API evolution
- Optional parameters with defaults
- Self-documenting configuration

## Small Interfaces

Define interfaces where they are used, not where they are implemented.

**Principle:** Accept interfaces, return structs

```go
// Good: Small, focused interface defined at point of use
type UserStore interface {
    GetUser(id string) (*User, error)
}

func ProcessUser(store UserStore, id string) error {
    user, err := store.GetUser(id)
    // ...
}
```

**Benefits:**
- Easier testing and mocking
- Loose coupling
- Clear dependencies

## Dependency Injection

Use constructor functions to inject dependencies:

```go
func NewUserService(repo UserRepository, logger Logger) *UserService {
    return &UserService{
        repo:   repo,
        logger: logger,
    }
}
```

**Pattern:**
- Constructor functions (New* prefix)
- Explicit dependencies as parameters
- Return concrete types
- Validate dependencies in constructor

## Concurrency Patterns

### Worker Pool

```go
func workerPool(jobs <-chan Job, results chan<- Result, workers int) {
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for job := range jobs {
                results <- processJob(job)
            }
        }()
    }
    wg.Wait()
    close(results)
}
```

### Context Propagation

Always pass context as first parameter:

```go
func FetchUser(ctx context.Context, id string) (*User, error) {
    // Check context cancellation
    select {
    case <-ctx.Done():
        return nil, ctx.Err()
    default:
    }
    // ... fetch logic
}
```

## Error Handling

### Error Wrapping

```go
if err != nil {
    return fmt.Errorf("failed to fetch user %s: %w", id, err)
}
```

### Custom Errors

```go
type ValidationError struct {
    Field string
    Msg   string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("%s: %s", e.Field, e.Msg)
}
```

### Sentinel Errors

```go
var (
    ErrNotFound = errors.New("not found")
    ErrInvalid  = errors.New("invalid input")
)

// Check with errors.Is
if errors.Is(err, ErrNotFound) {
    // handle not found
}
```

## Package Organization

### Structure

```
project/
├── cmd/              # Main applications
│   └── server/
│       └── main.go
├── internal/         # Private application code
│   ├── domain/       # Business logic
│   ├── handler/      # HTTP handlers
│   └── repository/   # Data access
└── pkg/              # Public libraries
```

### Naming Conventions

- Package names: lowercase, single word
- Avoid stutter: `user.User` not `user.UserModel`
- Use `internal/` for private code
- Keep `main` package minimal

## Testing Patterns

### Table-Driven Tests

```go
func TestValidate(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        wantErr bool
    }{
        {"valid", "test@example.com", false},
        {"invalid", "not-an-email", true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := Validate(tt.input)
            if (err != nil) != tt.wantErr {
                t.Errorf("got error %v, wantErr %v", err, tt.wantErr)
            }
        })
    }
}
```

### Test Helpers

```go
func testDB(t *testing.T) *sql.DB {
    t.Helper()
    db, err := sql.Open("sqlite3", ":memory:")
    if err != nil {
        t.Fatalf("failed to open test db: %v", err)
    }
    t.Cleanup(func() { db.Close() })
    return db
}
```

## When to Use This Skill

- Designing Go APIs and packages
- Implementing concurrent systems
- Structuring Go projects
- Writing idiomatic Go code
- Refactoring Go codebases
