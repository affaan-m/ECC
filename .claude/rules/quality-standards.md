# Quality Standards

## Code Quality Checklist

Before marking work complete:
- [ ] Code readable, well-named, <50 lines per function
- [ ] Files focused (<800 lines), no deep nesting (>4 levels)
- [ ] Error handling explicit, no mutation patterns
- [ ] No hardcoded values, secrets, or debug statements
- [ ] Tests exist for new functionality, 80%+ coverage

## Coding Style

### Immutability (CRITICAL)
ALWAYS create new objects, NEVER mutate existing ones. Prevents hidden side effects and enables safe concurrency.

### Core Principles
**KISS**: Simplest solution that works. **DRY**: Extract repeated logic. **YAGNI**: No speculative features.

### Naming Conventions
- Variables/functions: `camelCase`
- Booleans: `is`, `has`, `should`, `can` prefixes
- Types/interfaces: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Hooks: `usePrefix`

### File Organization
Many small files > few large files. 200-400 lines typical, 800 max. Organize by feature/domain, not type.

## Security Review Triggers

**STOP and use security-reviewer when:**
- Authentication/authorization code
- User input handling, database queries, file system operations
- External API calls, cryptographic operations, payment code

**MANDATORY checklist before ANY commit:**
- [ ] No hardcoded secrets (API keys, passwords, tokens)
- [ ] All user inputs validated, SQL injection prevention (parameterized queries)
- [ ] XSS prevention (sanitized HTML), CSRF protection enabled
- [ ] Authentication/authorization verified, rate limiting on endpoints
- [ ] Error messages don't leak sensitive data

## Security Issues Found

1. STOP immediately
2. Use **security-reviewer** agent
3. Fix CRITICAL issues before continuing
4. Rotate any exposed secrets

## Review Workflow

1. Run `git diff` to understand changes
2. Check security checklist first
3. Review code quality checklist
4. Run relevant tests, verify coverage >= 80%
5. Use appropriate agent for detailed review

## Common Issues

### Security
- Hardcoded credentials, SQL injection, XSS, path traversal
- CSRF protection missing, authentication bypasses

### Code Quality
- Large functions (>50 lines), large files (>800 lines)
- Deep nesting (>4 levels), missing error handling
- Mutation patterns, missing tests

### Performance
- N+1 queries → use JOINs or batching
- Missing pagination → add LIMIT
- Unbounded queries → add constraints
- Missing caching → cache expensive operations

## Review Severity

| Level | Action |
|-------|--------|
| **CRITICAL** | BLOCK - Must fix before merge |
| **HIGH** | WARN - Should fix before merge |
| **MEDIUM** | INFO - Consider fixing |
| **LOW** | NOTE - Optional |

## Agent Usage

| Agent | Purpose |
|-------|---------|
| **code-reviewer** | Code quality, patterns, best practices |
| **security-reviewer** | Security vulnerabilities, OWASP Top 10 |
