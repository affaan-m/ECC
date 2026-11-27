---
description: "Kotlin security extending common rules"
globs: ["**/*.kt", "**/*.kts", "**/build.gradle.kts"]
alwaysApply: false
---
# Kotlin Security

> This file extends the common security rule with Kotlin-specific content.

## Secret Management

```kotlin
val apiKey = System.getenv("API_KEY")
    ?: throw IllegalStateException("API_KEY not configured")
```

## SQL Injection Prevention

Always use Exposed's parameterized queries:

```kotlin
// Good: Parameterized via Exposed DSL
UsersTable.selectAll().where { UsersTable.email eq email }

// Bad: String interpolation in raw SQL
exec("SELECT * FROM users WHERE email = '$email'")
```

## Authentication

Use Ktor's Auth plugin with JWT:

```kotlin
install(Authentication) {
    jwt("jwt") {
        verifier(
            JWT.require(Algorithm.HMAC256(secret))
                .withAudience(audience)
                .withIssuer(issuer)
                .build()
        )
        validate { credential ->
            val payload = credential.payload
            if (payload.audience.contains(audience) &&
                payload.issuer == issuer &&
                payload.subject != null) {
                JWTPrincipal(payload)
            } else {
                null
            }
        }
    }
}
```

## Null Safety as Security

Kotlin's type system prevents null-related vulnerabilities -- avoid `!!` to maintain this guarantee.
