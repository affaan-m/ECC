# Go Microservice — CLAUDE.md de Projeto

> Exemplo real para um microserviço Go com PostgreSQL, gRPC e Docker.
> Copie para a raiz do seu projeto e customize para seu serviço.

## Visão Geral do Projeto

**Stack:** Go 1.22+, PostgreSQL, gRPC + REST (grpc-gateway), Docker, sqlc (SQL type-safe), Wire (injeção de dependência)

**Arquitetura:** Clean architecture com camadas domain, repository, service e handler. gRPC como transporte principal com gateway REST para clientes externos.

## Regras Críticas

### Convenções Go

- Siga Effective Go e o guia Go Code Review Comments
- Use `errors.New` / `fmt.Errorf` com `%w` para wrapping — nunca string matching em erros
- Sem funções `init()` — inicialização explícita em `main()` ou construtores
- Sem estado global mutável — passe dependências via construtores
- Context deve ser o primeiro parâmetro e propagado por todas as camadas

### Banco de Dados

- Todas as queries em `queries/` como SQL puro — sqlc gera código Go type-safe
- Migrations em `migrations/` com golang-migrate — nunca alterar banco diretamente
- Use transações para operações multi-etapa via `pgx.Tx`
- Todas as queries devem usar placeholders parametrizados (`$1`, `$2`) — nunca string formatting

### Tratamento de Erro

- Retorne erros, não use panic — panic só para casos realmente irrecuperáveis
- Faça wrap de erros com contexto: `fmt.Errorf("creating user: %w", err)`
- Defina sentinel errors em `domain/errors.go` para lógica de negócio
- Mapeie erros de domínio para gRPC status codes na camada de handler

```go
// Domain layer — sentinel errors
var (
    ErrUserNotFound  = errors.New("user not found")
    ErrEmailTaken    = errors.New("email already registered")
)

// Handler layer — map to gRPC status
func toGRPCError(err error) error {
    switch {
    case errors.Is(err, domain.ErrUserNotFound):
        return status.Error(codes.NotFound, err.Error())
    case errors.Is(err, domain.ErrEmailTaken):
        return status.Error(codes.AlreadyExists, err.Error())
    default:
        return status.Error(codes.Internal, "internal error")
    }
}
```

### Estilo de Código

- Sem emojis em código ou comentários
- Tipos e funções exportados devem ter doc comments
- Mantenha funções abaixo de 50 linhas — extraia helpers
- Use table-driven tests para toda lógica com múltiplos casos
- Prefira `struct{}` para canais de sinal, não `bool`

## Estrutura de Arquivos

```
cmd/
  server/
    main.go              # Entrypoint, Wire injection, graceful shutdown
internal/
  domain/                # Business types and interfaces
    user.go              # User entity and repository interface
    errors.go            # Sentinel errors
  service/               # Business logic
    user_service.go
    user_service_test.go
  repository/            # Data access (sqlc-generated + custom)
    postgres/
      user_repo.go
      user_repo_test.go  # Integration tests with testcontainers
  handler/               # gRPC + REST handlers
    grpc/
      user_handler.go
    rest/
      user_handler.go
  config/                # Configuration loading
    config.go
proto/                   # Protobuf definitions
  user/v1/
    user.proto
queries/                 # SQL queries for sqlc
  user.sql
migrations/              # Database migrations
  001_create_users.up.sql
  001_create_users.down.sql
```

## Padrões-Chave

### Interface de Repositório

```go
type UserRepository interface {
    Create(ctx context.Context, user *User) error
    FindByID(ctx context.Context, id uuid.UUID) (*User, error)
    FindByEmail(ctx context.Context, email string) (*User, error)
    Update(ctx context.Context, user *User) error
    Delete(ctx context.Context, id uuid.UUID) error
}
```

### Serviço com Injeção de Dependência

```go
type UserService struct {
    repo   domain.UserRepository
    hasher PasswordHasher
    logger *slog.Logger
}

func NewUserService(repo domain.UserRepository, hasher PasswordHasher, logger *slog.Logger) *UserService {
    return &UserService{repo: repo, hasher: hasher, logger: logger}
}

func (s *UserService) Create(ctx context.Context, req CreateUserRequest) (*domain.User, error) {
    existing, err := s.repo.FindByEmail(ctx, req.Email)
    if err != nil && !errors.Is(err, domain.ErrUserNotFound) {
        return nil, fmt.Errorf("checking email: %w", err)
    }
    if existing != nil {
        return nil, domain.ErrEmailTaken
    }

    hashed, err := s.hasher.Hash(req.Password)
    if err != nil {
        return nil, fmt.Errorf("hashing password: %w", err)
    }

    user := &domain.User{
        ID:       uuid.New(),
        Name:     req.Name,
        Email:    req.Email,
        Password: hashed,
    }
    if err := s.repo.Create(ctx, user); err != nil {
        return nil, fmt.Errorf("creating user: %w", err)
    }
    return user, nil
}
```

### Table-Driven Tests

```go
func TestUserService_Create(t *testing.T) {
    tests := []struct {
        name    string
        req     CreateUserRequest
        setup   func(*MockUserRepo)
        wantErr error
    }{
        {
            name: "valid user",
            req:  CreateUserRequest{Name: "Alice", Email: "alice@example.com", Password: "secure123"},
            setup: func(m *MockUserRepo) {
                m.On("FindByEmail", mock.Anything, "alice@example.com").Return(nil, domain.ErrUserNotFound)
                m.On("Create", mock.Anything, mock.Anything).Return(nil)
            },
            wantErr: nil,
        },
        {
            name: "duplicate email",
            req:  CreateUserRequest{Name: "Alice", Email: "taken@example.com", Password: "secure123"},
            setup: func(m *MockUserRepo) {
                m.On("FindByEmail", mock.Anything, "taken@example.com").Return(&domain.User{}, nil)
            },
            wantErr: domain.ErrEmailTaken,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            repo := new(MockUserRepo)
            tt.setup(repo)
            svc := NewUserService(repo, &bcryptHasher{}, slog.Default())

            _, err := svc.Create(context.Background(), tt.req)

            if tt.wantErr != nil {
                assert.ErrorIs(t, err, tt.wantErr)
            } else {
                assert.NoError(t, err)
            }
        })
    }
}
```

## Variáveis de Ambiente

```bash
# Database
DATABASE_URL=postgres://user:pass@localhost:5432/myservice?sslmode=disable

# gRPC
GRPC_PORT=50051
REST_PORT=8080

# Auth
JWT_SECRET=           # Load from vault in production
TOKEN_EXPIRY=24h

# Observability
LOG_LEVEL=info        # debug, info, warn, error
OTEL_ENDPOINT=        # OpenTelemetry collector
```

## Estratégia de Teste

```bash
/go-test             # TDD workflow for Go
/go-review           # Go-specific code review
/go-build            # Fix build errors
```

### Comandos de Teste

```bash
# Unit tests (fast, no external deps)
go test ./internal/... -short -count=1

# Integration tests (requires Docker for testcontainers)
go test ./internal/repository/... -count=1 -timeout 120s

# All tests with coverage
go test ./... -coverprofile=coverage.out -count=1
go tool cover -func=coverage.out  # summary
go tool cover -html=coverage.out  # browser

# Race detector
go test ./... -race -count=1
```

## Workflow ECC

```bash
# Planning
/plan "Add rate limiting to user endpoints"

# Development
/go-test                  # TDD with Go-specific patterns

# Review
/go-review                # Go idioms, error handling, concurrency
/security-scan            # Secrets and vulnerabilities

# Before merge
go vet ./...
staticcheck ./...
```

## Fluxo Git

- `feat:` novas features, `fix:` correções de bug, `refactor:` mudanças de código
- Branches de feature a partir da `main`, PRs obrigatórios
- CI: `go vet`, `staticcheck`, `go test -race`, `golangci-lint`
- Deploy: imagem Docker gerada no CI e publicada em Kubernetes
