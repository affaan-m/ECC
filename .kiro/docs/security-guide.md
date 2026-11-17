# Security Guide for Agentic Workflows

## Introduction

AI agents are powerful development tools, but they introduce unique security considerations. This guide covers security best practices for using agentic workflows safely and responsibly.

## Core Security Principles

### 1. Trust but Verify

**Principle**: Always review agent-generated code, especially for security-critical components.

**Why**: Agents can make mistakes, miss edge cases, or introduce vulnerabilities unintentionally.

**Practice**:
- Review all authentication and authorization code manually
- Verify cryptographic implementations against standards
- Check input validation and sanitization
- Test error handling for information leakage

### 2. Least Privilege

**Principle**: Grant agents only the tools and access they need for their specific role.

**Why**: Limiting agent capabilities reduces the blast radius of potential mistakes.

**Practice**:
- Use `allowedTools` to restrict agent capabilities
- Read-only agents (planner, architect) should not have write access
- Review agents should not have shell access
- Use `toolsSettings.allowedPaths` to restrict file access

### 3. Defense in Depth

**Principle**: Use multiple layers of security controls.

**Why**: No single control is perfect; layered defenses catch what others miss.

**Practice**:
- Enable security-focused hooks (git-push-review, doc-file-warning)
- Use the security-reviewer agent before merging
- Maintain security steering files for consistent rules
- Run automated security scans in CI/CD

### 4. Secure by Default

**Principle**: Security should be the default, not an afterthought.

**Why**: It's easier to maintain security from the start than to retrofit it later.

**Practice**:
- Enable always-inclusion security steering files
- Use TDD workflow with security test cases
- Include security requirements in planning phase
- Document security decisions in lessons-learned

## Agent-Specific Security

### Planner Agent

**Risk**: May suggest insecure architectures or skip security requirements.

**Mitigation**:
- Always include security requirements in planning prompts
- Review plans with security-reviewer agent
- Use security-review skill during planning
- Document security constraints in requirements

**Example Secure Prompt**:
```
Plan a user authentication feature with these security requirements:
- Password hashing with bcrypt (cost factor 12)
- Rate limiting (5 attempts per minute)
- JWT tokens with 15-minute expiry
- Refresh tokens in httpOnly cookies
- CSRF protection for state-changing operations
```

### Code-Writing Agents (TDD Guide, Build Error Resolver)

**Risk**: May introduce vulnerabilities like SQL injection, XSS, or insecure deserialization.

**Mitigation**:
- Enable security steering files (always-loaded)
- Use git-push-review hook to catch issues before commit
- Run security-reviewer agent after implementation
- Include security test cases in TDD workflow

**Common Vulnerabilities to Watch**:
- SQL injection (use parameterized queries)
- XSS (sanitize user input, escape output)
- CSRF (use tokens for state-changing operations)
- Path traversal (validate and sanitize file paths)
- Command injection (avoid shell execution with user input)
- Insecure deserialization (validate before deserializing)

### Security Reviewer Agent

**Risk**: May miss subtle vulnerabilities or provide false confidence.

**Mitigation**:
- Use as one layer, not the only layer
- Combine with automated security scanners
- Review findings manually
- Update security steering files with new patterns

**Best Practice**:
```
1. Run security-reviewer agent
2. Run automated scanner (Snyk, SonarQube, etc.)
3. Manual review of critical components
4. Document findings in lessons-learned
```

### Refactor Cleaner Agent

**Risk**: May accidentally remove security checks during refactoring.

**Mitigation**:
- Use verification-loop skill to validate behavior preservation
- Include security tests in test suite
- Review diffs carefully for removed security code
- Run security-reviewer after refactoring

## Hook Security

### Git Push Review Hook

**Purpose**: Catch security issues before they reach the repository.

**Configuration**:
```json
{
  "name": "git-push-review",
  "version": "1.0.0",
  "description": "Review code before git push",
  "enabled": true,
  "when": {
    "type": "preToolUse",
    "toolTypes": ["shell"]
  },
  "then": {
    "type": "askAgent",
    "prompt": "Review the code for security issues before pushing. Check for: SQL injection, XSS, CSRF, authentication bypasses, information leakage, and insecure cryptography. Block the push if critical issues are found."
  }
}
```

**Best Practice**: Keep this hook enabled always, especially for production branches.

### Console Log Check Hook

**Purpose**: Prevent accidental logging of sensitive data.

**Configuration**:
```json
{
  "name": "console-log-check",
  "version": "1.0.0",
  "description": "Check for console.log statements",
  "enabled": true,
  "when": {
    "type": "fileEdited",
    "patterns": ["*.js", "*.ts", "*.tsx"]
  },
  "then": {
    "type": "runCommand",
    "command": "grep -n 'console\\.log' \"$KIRO_FILE_PATH\" && echo 'Warning: console.log found' || true"
  }
}
```

**Why**: Console logs can leak sensitive data (passwords, tokens, PII) in production.

### Doc File Warning Hook

**Purpose**: Prevent accidental modification of critical documentation.

**Configuration**:
```json
{
  "name": "doc-file-warning",
  "version": "1.0.0",
  "description": "Warn before modifying documentation files",
  "enabled": true,
  "when": {
    "type": "preToolUse",
    "toolTypes": ["write"]
  },
  "then": {
    "type": "askAgent",
    "prompt": "If you're about to modify a README, SECURITY, or LICENSE file, confirm this is intentional and the changes are appropriate."
  }
}
```

## Steering File Security

### Security Steering File

**Purpose**: Inject security rules into every conversation.

**Key Rules to Include**:
```markdown
---
inclusion: always
description: Security best practices and vulnerability prevention
---

# Security Rules

## Input Validation
- Validate all user input on the server side
- Use allowlists, not denylists
- Sanitize input before use
- Reject invalid input, don't try to fix it

## Authentication
- Use bcrypt/argon2 for password hashing (never MD5/SHA1)
- Implement rate limiting on authentication endpoints
- Use secure session management (httpOnly, secure, sameSite cookies)
- Implement account lockout after failed attempts

## Authorization
- Check authorization on every request
- Use principle of least privilege
- Implement role-based access control (RBAC)
- Never trust client-side authorization checks

## Cryptography
- Use TLS 1.3 for transport security
- Use established libraries (don't roll your own crypto)
- Use secure random number generators
- Rotate keys regularly

## Data Protection
- Encrypt sensitive data at rest
- Never log passwords, tokens, or PII
- Use parameterized queries (prevent SQL injection)
- Sanitize output (prevent XSS)

## Error Handling
- Never expose stack traces to users
- Log errors securely with correlation IDs
- Use generic error messages for users
- Implement proper exception handling
```

### Language-Specific Security

**TypeScript/JavaScript**:
```markdown
- Use Content Security Policy (CSP) headers
- Sanitize HTML with DOMPurify
- Use helmet.js for Express security headers
- Validate with Zod/Yup, not manual checks
- Use prepared statements for database queries
```

**Python**:
```markdown
- Use parameterized queries with SQLAlchemy
- Sanitize HTML with bleach
- Use secrets module for random tokens
- Validate with Pydantic
- Use Flask-Talisman for security headers
```

**Go**:
```markdown
- Use html/template for HTML escaping
- Use crypto/rand for random generation
- Use prepared statements with database/sql
- Validate with validator package
- Use secure middleware for HTTP headers
```

## MCP Server Security

### Risk Assessment

MCP servers extend agent capabilities but introduce security risks:

- **Network Access**: Servers can make external API calls
- **File System Access**: Some servers can read/write files
- **Credential Storage**: Servers may require API keys
- **Code Execution**: Some servers can execute arbitrary code

### Secure MCP Configuration

**1. Review Server Permissions**

Before installing an MCP server, review what it can do:
```bash
# Check server documentation
# Understand what APIs it calls
# Review what data it accesses
```

**2. Use Environment Variables for Secrets**

Never hardcode API keys in `mcp.json`:
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

**3. Limit Server Scope**

Use least privilege for API tokens:
- GitHub: Use fine-grained tokens with minimal scopes
- Cloud providers: Use service accounts with minimal permissions
- Databases: Use read-only credentials when possible

**4. Review Server Code**

For open-source MCP servers:
```bash
# Clone and review the source
git clone https://github.com/org/mcp-server
cd mcp-server
# Review for security issues
grep -r "eval\|exec\|shell" .
```

**5. Use Auto-Approve Carefully**

Only auto-approve tools you fully trust:
```json
{
  "mcpServers": {
    "github": {
      "autoApprove": ["search_repositories", "get_file_contents"]
    }
  }
}
```

Never auto-approve:
- File write operations
- Shell command execution
- Database modifications
- API calls that change state

## Secrets Management

### Never Commit Secrets

**Risk**: Secrets in version control can be extracted from history.

**Prevention**:
```bash
# Add to .gitignore
echo ".env" >> .gitignore
echo ".kiro/settings/mcp.json" >> .gitignore
echo "secrets/" >> .gitignore

# Use git-secrets or similar tools
git secrets --install
git secrets --register-aws
```

### Use Environment Variables

**Good**:
```bash
# .env file (not committed)
DATABASE_URL=postgresql://user:pass@localhost/db
API_KEY=sk-...

# Load in application
export $(cat .env | xargs)
```

**Bad**:
```javascript
// Hardcoded secret (never do this!)
const apiKey = "sk-1234567890abcdef";
```

### Rotate Secrets Regularly

- API keys: Every 90 days
- Database passwords: Every 90 days
- JWT signing keys: Every 30 days
- Refresh tokens: On suspicious activity

### Use Secret Management Services

For production:
- AWS Secrets Manager
- HashiCorp Vault
- Azure Key Vault
- Google Secret Manager

## Incident Response

### If an Agent Generates Vulnerable Code

1. **Stop**: Don't merge or deploy the code
2. **Analyze**: Understand the vulnerability
3. **Fix**: Correct the issue manually or with security-reviewer agent
4. **Test**: Verify the fix with security tests
5. **Document**: Add pattern to lessons-learned.md
6. **Update**: Improve security steering files to prevent recurrence

### If Secrets Are Exposed

1. **Revoke**: Immediately revoke exposed credentials
2. **Rotate**: Generate new credentials
3. **Audit**: Check for unauthorized access
4. **Clean**: Remove secrets from git history (git-filter-repo)
5. **Prevent**: Update .gitignore and pre-commit hooks

### If a Security Issue Reaches Production

1. **Assess**: Determine severity and impact
2. **Contain**: Deploy hotfix or take system offline
3. **Notify**: Inform affected users if required
4. **Investigate**: Determine root cause
5. **Remediate**: Fix the issue permanently
6. **Learn**: Update processes to prevent recurrence

## Security Checklist

### Before Starting Development

- [ ] Security steering files enabled (always-inclusion)
- [ ] Security-focused hooks enabled (git-push-review, console-log-check)
- [ ] MCP servers reviewed and configured securely
- [ ] Secrets management strategy in place
- [ ] .gitignore includes sensitive files

### During Development

- [ ] Security requirements included in planning
- [ ] TDD workflow includes security test cases
- [ ] Input validation on all user input
- [ ] Output sanitization for all user-facing content
- [ ] Authentication and authorization implemented correctly
- [ ] Cryptography uses established libraries
- [ ] Error handling doesn't leak information

### Before Merging

- [ ] Code reviewed by security-reviewer agent
- [ ] Automated security scanner run (Snyk, SonarQube)
- [ ] Manual review of security-critical code
- [ ] No secrets in code or configuration
- [ ] No console.log statements with sensitive data
- [ ] Security tests passing

### Before Deploying

- [ ] Security headers configured (CSP, HSTS, etc.)
- [ ] TLS/HTTPS enabled
- [ ] Rate limiting configured
- [ ] Monitoring and alerting set up
- [ ] Incident response plan documented
- [ ] Secrets rotated if needed

## Resources

### Tools

- **Static Analysis**: SonarQube, Semgrep, CodeQL
- **Dependency Scanning**: Snyk, Dependabot, npm audit
- **Secret Scanning**: git-secrets, truffleHog, GitGuardian
- **Runtime Protection**: OWASP ZAP, Burp Suite

### Standards

- **OWASP Top 10**: https://owasp.org/www-project-top-ten/
- **CWE Top 25**: https://cwe.mitre.org/top25/
- **NIST Guidelines**: https://www.nist.gov/cybersecurity

### Learning

- **OWASP Cheat Sheets**: https://cheatsheetseries.owasp.org/
- **PortSwigger Web Security Academy**: https://portswigger.net/web-security
- **Secure Code Warrior**: https://www.securecodewarrior.com/

## Conclusion

Security in agentic workflows requires vigilance and layered defenses. By following these best practices—reviewing agent output, using security-focused agents and hooks, maintaining security steering files, and securing MCP servers—you can leverage the power of AI agents while maintaining strong security posture.

Remember: agents are tools that amplify your capabilities, but security remains your responsibility. Trust but verify, use defense in depth, and always prioritize security in your development workflow.
