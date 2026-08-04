---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# TypeScript/JavaScript Güvenlik

> Bu dosya [common/security.md](../common/security.md) dosyasını TypeScript/JavaScript'e özgü içerikle genişletir.

## Secret Yönetimi

```typescript
// ASLA: Hardcoded secret'lar
const apiKey = "sk-proj-xxxxx"

// DAIMA: Environment variable'lar
const apiKey = process.env.API_KEY

if (!apiKey) {
  throw new Error('API_KEY not configured')
}
```

## Agent Desteği

- Kapsamlı güvenlik denetimleri için **security-reviewer** skill kullan
