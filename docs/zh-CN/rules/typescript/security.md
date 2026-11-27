---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# TypeScript/JavaScript 安全

> 本文档扩展了 [common/security.md](../common/security.md)，包含了 TypeScript/JavaScript 特定的内容。

## 密钥管理

```typescript
// NEVER: Hardcoded secrets
const apiKey = "sk-proj-xxxxx"

// ALWAYS: Environment variables
const apiKey = process.env.API_KEY

if (!apiKey) {
  throw new Error('API_KEY not configured')
}
```

## 代理支持

* 使用 **security-reviewer** 技能进行全面的安全审计
