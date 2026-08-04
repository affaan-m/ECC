---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---
# Seguridad en Go

> Este archivo extiende [common/security.md](../common/security.md) con contenido específico de Go.

## Gestión de Secretos

```go
apiKey := os.Getenv("OPENAI_API_KEY")
if apiKey == "" {
    log.Fatal("OPENAI_API_KEY not configured")
}
```

## Escaneo de Seguridad

- Usar **gosec** para análisis estático de seguridad:
  ```bash
  gosec ./...
  ```

## Context y Timeouts

Siempre usar `context.Context` para control de timeout:

```go
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()
```
