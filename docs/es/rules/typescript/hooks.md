---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# Hooks de TypeScript/JavaScript

> Este archivo extiende [common/hooks.md](../common/hooks.md) con contenido específico de TypeScript/JavaScript.

## Hooks PostToolUse

Configurar en `~/.claude/settings.json`:

- **Prettier**: Auto-formatear archivos JS/TS después de editar
- **Verificación de TypeScript**: Ejecutar `tsc` después de editar archivos `.ts`/`.tsx`
- **Advertencia de console.log**: Advertir sobre `console.log` en los archivos editados

## Hooks Stop

- **Auditoría de console.log**: Verificar todos los archivos modificados en busca de `console.log` antes de que termine la sesión
