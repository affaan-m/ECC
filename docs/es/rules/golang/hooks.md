---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---
# Hooks de Go

> Este archivo extiende [common/hooks.md](../common/hooks.md) con contenido específico de Go.

## Hooks PostToolUse

Configurar en `~/.claude/settings.json`:

- **gofmt/goimports**: Auto-formatear archivos `.go` después de editar
- **go vet**: Ejecutar análisis estático después de editar archivos `.go`
- **staticcheck**: Ejecutar verificaciones estáticas extendidas en los paquetes modificados
