---
paths:
  - "**/*.java"
---
# Java Security

> This file extends [common/security.md](../common/security.md) with Java-specific content.

## Secrets Management

- Never hardcode API keys, tokens, or credentials in source code
- Use environment variables: `System.getenv("API_KEY")`
- Use a secret manager (Vault, AWS Secrets Manager) for production secrets
- Keep local config files with secrets in `.gitignore`

```java
// BAD
private static final String API_KEY = "sk-abc123...";

// GOOD — environment variable
String apiKey = System.getenv("PAYMENT_API_KEY");
Objects.requireNonNull(apiKey, "PAYMENT_API_KEY must be set");
```

## SQL Injection Prevention

- Always use parameterized queries — never concatenate user input into SQL
- Use `PreparedStatement` or your framework's parameterized query API
- Validate and sanitize any input used in native queries

```java
// BAD — SQL injection via string concatenation
Statement stmt = conn.createStatement();
String sql = "SELECT * FROM orders WHERE name = '" + name + "'";
stmt.executeQuery(sql);

// GOOD — PreparedStatement with parameterized query
PreparedStatement ps = conn.prepareStatement("SELECT * FROM orders WHERE name = ?");
ps.setString(1, name);

// GOOD — JDBC template
jdbcTemplate.query("SELECT * FROM orders WHERE name = ?", mapper, name);
```

## Input Validation

- Validate all user input at system boundaries before processing
- Use Bean Validation (`@NotNull`, `@NotBlank`, `@Size`) on DTOs when using a validation framework
- Sanitize file paths and user-provided strings before use
- Reject input that fails validation with clear error messages

```java
// Validate manually in plain Java
public Order createOrder(String customerName, BigDecimal amount) {
    if (customerName == null || customerName.isBlank()) {
        throw new IllegalArgumentException("Customer name is required");
    }
    if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) {
        throw new IllegalArgumentException("Amount must be positive");
    }
    return new Order(customerName, amount);
}
```

## Authentication and Authorization

- Never implement custom auth crypto — use established libraries
- Store passwords with bcrypt or Argon2, never MD5/SHA1
- Enforce authorization checks at service boundaries
- Clear sensitive data from logs — never log passwords, tokens, or PII

## Dependency Security

- Run `mvn dependency:tree` or `./gradlew dependencies` to audit transitive dependencies
- Use OWASP Dependency-Check or Snyk to scan for known CVEs
- Keep dependencies updated — set up Dependabot or Renovate

## Error Messages

- Never expose stack traces, internal paths, or SQL errors in API responses
- Map exceptions to safe, generic client messages at handler boundaries
- Log detailed errors server-side; return generic messages to clients

```java
// Log the detail, return a generic message
try {
    return orderService.findById(id);
} catch (OrderNotFoundException ex) {
    log.warn("Order not found: id={}", id);
    return ApiResponse.error("Resource not found");  // generic, no internals
} catch (Exception ex) {
    log.error("Unexpected error processing order id={}", id, ex);
    return ApiResponse.error("Internal server error");  // never expose ex.getMessage()
}
```

## References

See skill: `springboot-security` for Spring Security authentication and authorization patterns.
See skill: `quarkus-security` for Quarkus security with JWT/OIDC, RBAC, and CDI.
See skill: `security-review` for general security checklists.
