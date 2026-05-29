---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# Seguridad en TypeScript/JavaScript

> Este archivo extiende [common/security.md](../common/security.md) con contenido específico de TypeScript/JavaScript.

## Gestión de Secretos

```typescript
// NUNCA: Secretos hardcodeados
const apiKey = "sk-proj-xxxxx"

// SIEMPRE: Variables de entorno
const apiKey = process.env.OPENAI_API_KEY

if (!apiKey) {
  throw new Error('OPENAI_API_KEY not configured')
}
```

## Soporte de Agentes

- Usar la skill **security-reviewer** para auditorías de seguridad exhaustivas
