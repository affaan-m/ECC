---
description: "TypeScript security for TypeScript, JavaScript, TSX, and JSX code. Apply when writing, reviewing, or refactoring validation, secrets, auth, and vulnerability prevention."
alwaysApply: false
---
# TypeScript/JavaScript Security

> This file extends the common security rule with TypeScript/JavaScript specific content.

## Secret Management

```typescript
// NEVER: Hardcoded secrets
const apiKey = "sk-proj-xxxxx"

// ALWAYS: Environment variables
const apiKey = process.env.OPENAI_API_KEY

if (!apiKey) {
  throw new Error('OPENAI_API_KEY not configured')
}
```

## Agent Support

- Use **security-reviewer** skill for comprehensive security audits
