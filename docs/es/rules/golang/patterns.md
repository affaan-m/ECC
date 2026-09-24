---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---
# Patrones de Go

> Este archivo extiende [common/patterns.md](../common/patterns.md) con contenido específico de Go.

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

## Interfaces Pequeñas

Definir las interfaces donde se usan, no donde se implementan.

## Inyección de Dependencias

Usar funciones constructor para inyectar dependencias:

```go
func NewUserService(repo UserRepository, logger Logger) *UserService {
    return &UserService{repo: repo, logger: logger}
}
```

## Referencia

Ver skill: `golang-patterns` para patrones completos de Go incluyendo concurrencia, manejo de errores y organización de paquetes.
