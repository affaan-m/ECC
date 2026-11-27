---
inclusion: fileMatch
fileMatchPattern: "*.ts,*.tsx,*.js,*.jsx"
description: TypeScript/JavaScript security best practices extending common security rules with language-specific concerns
---

# TypeScript/JavaScript Security

> This file extends the common security rule with TypeScript/JavaScript specific content.

## Secret Management

```typescript
// NEVER: Hardcoded secrets
const apiKey = "sk-proj-xxxxx"
const dbPassword = "mypassword123"

// ALWAYS: Environment variables
const apiKey = process.env.OPENAI_API_KEY
const dbPassword = process.env.DATABASE_PASSWORD

if (!apiKey) {
  throw new Error('OPENAI_API_KEY not configured')
}
```

## XSS Prevention

```typescript
// NEVER: Direct HTML injection
element.innerHTML = userInput

// ALWAYS: Sanitize or use textContent
import DOMPurify from 'dompurify'
element.innerHTML = DOMPurify.sanitize(userInput)
// OR
element.textContent = userInput
```

## Prototype Pollution

```typescript
// NEVER: Unsafe object merging
function merge(target: any, source: any) {
  for (const key in source) {
    target[key] = source[key]  // Dangerous!
  }
}

// ALWAYS: Validate keys
function merge(target: any, source: any) {
  for (const key in source) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue
    }
    target[key] = source[key]
  }
}
```

## SQL Injection (Node.js)

```typescript
// NEVER: String concatenation
const query = `SELECT * FROM users WHERE id = ${userId}`

// ALWAYS: Parameterized queries
const query = 'SELECT * FROM users WHERE id = ?'
db.query(query, [userId])
```

## Path Traversal

```typescript
// NEVER: Direct path construction
const filePath = `./uploads/${req.params.filename}`

// ALWAYS: Validate and sanitize
import path from 'path'
const filename = path.basename(req.params.filename)
const filePath = path.join('./uploads', filename)
```

## Dependency Security

```bash
# Regular security audits
npm audit
npm audit fix

# Use lock files
npm ci  # Instead of npm install in CI/CD
```

## Agent Support

- Use **security-reviewer** agent for comprehensive security audits
- Invoke via `/agent swap security-reviewer` or use the security-review skill
