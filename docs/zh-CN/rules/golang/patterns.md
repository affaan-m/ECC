---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---

# Go 模式

> 本文档在 [common/patterns.md](../common/patterns.md) 的基础上扩展了 Go 语言特定的内容。

## 函数式选项

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

## 小接口

在接口被使用的地方定义它们，而不是在它们被实现的地方。

## 依赖注入

使用构造函数来注入依赖：

```go
func NewUserService(repo UserRepository, logger Logger) *UserService {
    return &UserService{repo: repo, logger: logger}
}
```

## 参考

有关全面的 Go 模式（包括并发、错误处理和包组织），请参阅技能：`golang-patterns`。
