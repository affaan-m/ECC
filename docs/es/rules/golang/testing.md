---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---
# Pruebas en Go

> Este archivo extiende [common/testing.md](../common/testing.md) con contenido específico de Go.

## Framework

Usar el `go test` estándar con **pruebas table-driven**.

## Detección de Condiciones de Carrera

Siempre ejecutar con la flag `-race`:

```bash
go test -race ./...
```

## Cobertura

```bash
go test -cover ./...
```

## Referencia

Ver skill: `golang-testing` para patrones detallados de pruebas en Go y helpers.
