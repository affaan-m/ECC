---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---
# Estilo de Código en Go

> Este archivo extiende [common/coding-style.md](../common/coding-style.md) con contenido específico de Go.

## Formateo

- **gofmt** y **goimports** son obligatorios — sin debates de estilo

## Principios de Diseño

- Aceptar interfaces, retornar structs
- Mantener las interfaces pequeñas (1-3 métodos)

## Manejo de Errores

Siempre envolver los errores con contexto:

```go
if err != nil {
    return fmt.Errorf("failed to create user: %w", err)
}
```

## Referencia

Ver skill: `golang-patterns` para idiomas y patrones completos de Go.
