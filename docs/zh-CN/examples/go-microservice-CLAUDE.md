# Go 微服务 — 项目 CLAUDE.md

> 一个使用 PostgreSQL、gRPC 和 Docker 的 Go 微服务真实示例。
> 将此文件复制到您的项目根目录，并根据您的服务进行自定义。

## 项目概述

**技术栈:** Go 1.22+, PostgreSQL, gRPC + REST (grpc-gateway), Docker, sqlc (类型安全的 SQL), Wire (依赖注入)

**架构:** 采用领域、仓库、服务和处理器层的清晰架构。gRPC 作为主要传输方式，REST 网关用于外部客户端。

## 关键规则

### Go 规范

* 遵循 Effective Go 和 Go Code Review Comments 指南
* 使用 `errors.New` / `fmt.Errorf` 配合 `%w` 进行包装 — 绝不对错误进行字符串匹配
* 不使用 `init()` 函数 — 在 `main()` 或构造函数中进行显式初始化
* 没有全局可变状态 — 通过构造函数传递依赖项
* Context 必须是第一个参数，并在所有层中传播

### 数据库

* `queries/` 中的所有查询都使用纯 SQL — sqlc 生成类型安全的 Go 代码
* 在 `migrations/` 中使用 golang-migrate 进行迁移 — 绝不直接更改数据库
* 通过 `pgx.Tx` 为多步骤操作使用事务
* 所有查询必须使用参数化占位符 (`$1`, `$2`) — 绝不使用字符串格式化

### 错误处理

* 返回错误，不要 panic — panic 仅用于真正无法恢复的情况
* 使用上下文包装错误：`fmt.Errorf("creating user: %w", err)`
* 在 `domain/errors.go` 中定义业务逻辑的哨兵错误
* 在处理器层将领域错误映射到 gRPC 状态码

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

### 代码风格

* 代码或注释中不使用表情符号
* 导出的类型和函数必须有文档注释
* 函数保持在 50 行以内 — 提取辅助函数
* 对所有具有多个用例的逻辑使用表格驱动测试
* 对于信号通道，优先使用 `struct{}`，而不是 `bool`

## 文件结构

```
cmd/
  server/
    main.go              # 入口点，Wire注入，优雅关闭
internal/
  domain/                # 业务类型和接口
    user.go              # 用户实体和仓库接口
    errors.go            # 哨兵错误
  service/               # 业务逻辑
    user_service.go
    user_service_test.go
  repository/            # 数据访问（sqlc生成 + 自定义）
    postgres/
      user_repo.go
      user_repo_test.go  # 使用testcontainers的集成测试
  handler/               # gRPC + REST处理程序
    grpc/
      user_handler.go
    rest/
      user_handler.go
  config/                # 配置加载
    config.go
proto/                   # Protobuf定义
  user/v1/
    user.proto
queries/                 # sqlc的SQL查询
  user.sql
migrations/              # 数据库迁移
  001_create_users.up.sql
  001_create_users.down.sql
```

## 关键模式

### 仓库接口

```go
type UserRepository interface {
    Create(ctx context.Context, user *User) error
    FindByID(ctx context.Context, id uuid.UUID) (*User, error)
    FindByEmail(ctx context.Context, email string) (*User, error)
    Update(ctx context.Context, user *User) error
    Delete(ctx context.Context, id uuid.UUID) error
}
```

### 使用依赖注入的服务

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

### 表格驱动测试

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

## 环境变量

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

## 测试策略

```bash
/go-test             # TDD workflow for Go
/go-review           # Go-specific code review
/go-build            # Fix build errors
```

### 测试命令

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

## ECC 工作流

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

## Git 工作流

* `feat:` 新功能，`fix:` 错误修复，`refactor:` 代码更改
* 从 `main` 创建功能分支，需要 PR
* CI: `go vet`, `staticcheck`, `go test -race`, `golangci-lint`
* 部署: 在 CI 中构建 Docker 镜像，部署到 Kubernetes
