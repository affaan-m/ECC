---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---
# Go Pattern'leri

> Bu dosya [common/patterns.md](../common/patterns.md) dosyasını Go'ya özgü içerikle genişletir.

## Functional Options

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

## Küçük Interface'ler

Interface'leri implement edildikleri yerde değil, kullanıldıkları yerde tanımla.

## Dependency Injection

Bağımlılıkları enjekte etmek için constructor fonksiyonları kullan:

```go
func NewUserService(repo UserRepository, logger Logger) *UserService {
    return &UserService{repo: repo, logger: logger}
}
```

## Referans

Concurrency, hata yönetimi ve paket organizasyonu dahil kapsamlı Go pattern'leri için skill: `golang-patterns` dosyasına bakın.
