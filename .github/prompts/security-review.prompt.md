---
agent: agent
description: Deep security analysis — OWASP Top 10, secrets, auth, injection, and dependency risks
---

# Security Review

Perform a thorough security analysis of the selected code or current branch changes.

## Checklist

### Secrets & Configuration
- [ ] No hardcoded API keys, tokens, passwords, or private keys anywhere in source
- [ ] All secrets loaded from environment variables or a secret manager
- [ ] Required env vars validated at startup (fail fast if missing)
- [ ] `.env` files excluded from version control

### Input Validation & Injection
- [ ] All user inputs validated and sanitized before use
- [ ] Parameterized queries for every database operation (no string interpolation)
- [ ] HTML output escaped or sanitized (XSS prevention)
- [ ] File path inputs sanitized (path traversal prevention)
- [ ] Command inputs sanitized (command injection prevention)

### Authentication & Authorization
- [ ] Auth checks enforced server-side — never trust client-supplied user IDs or roles
- [ ] Session tokens are sufficiently random and expire appropriately
- [ ] Sensitive operations protected by authz checks, not just authn
- [ ] CSRF protection enabled for state-changing endpoints

### Data Exposure
- [ ] Error responses scrubbed of stack traces, internal paths, and sensitive data
- [ ] Logs do not contain PII, tokens, or passwords
- [ ] Sensitive fields excluded from API responses (no over-fetching)
- [ ] Appropriate HTTP security headers set

### Dependencies
- [ ] No known vulnerable packages (run `npm audit` / `pip-audit` / `cargo audit`)
- [ ] Dependency versions pinned or locked
- [ ] No unused dependencies that increase attack surface

### Infrastructure (if applicable)
- [ ] Rate limiting on all public endpoints
- [ ] HTTPS enforced; no HTTP fallback in production
- [ ] Principle of least privilege for service accounts and IAM roles

## Response Protocol

If a **CRITICAL** issue is found:
1. Stop and report immediately.
2. Do not ship until fixed.
3. Rotate any exposed secrets.
4. Scan the rest of the codebase for similar patterns.

## Output Format

```
## Findings

**[CRITICAL|HIGH|MEDIUM|LOW]** — [category]
Location: [file:line if known]
Issue: [what is wrong and why it is dangerous]
Fix: [concrete remediation]

## Summary
- Critical: N
- High: N
- Medium: N
- Safe to ship: yes / no
```
