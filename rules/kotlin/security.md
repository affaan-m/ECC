---
paths:
  - "**/*.kt"
  - "**/*.kts"
---
# Kotlin Security

> This file extends [common/security.md](../common/security.md) with Kotlin and Android/KMP-specific content.

## Secrets Management

- Never hardcode API keys, tokens, or credentials in source code
- Use `local.properties` (git-ignored) for local development secrets
- Use `BuildConfig` fields generated from CI secrets for release builds
- Use `EncryptedSharedPreferences` (Android) or Keychain (iOS) for runtime secret storage

```kotlin
// BAD
val apiKey = "sk-abc123..."

// GOOD — from BuildConfig (generated at build time)
val apiKey = BuildConfig.API_KEY

// GOOD — from secure storage at runtime
val token = secureStorage.get("auth_token")
```

## Network Security

- Use HTTPS exclusively — configure `network_security_config.xml` to block cleartext
- Pin certificates for sensitive endpoints using OkHttp `CertificatePinner` or Ktor equivalent
- Set timeouts on all HTTP clients — never leave defaults (which may be infinite)
- Validate and sanitize all server responses before use

```xml
<!-- res/xml/network_security_config.xml -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
```

## Input Validation

- Validate all user input before processing or sending to API
- Use parameterized queries for Room/SQLDelight — never concatenate user input into SQL
- Sanitize file paths from user input to prevent path traversal

```kotlin
// BAD — SQL injection
@Query("SELECT * FROM items WHERE name = '$input'")

// GOOD — parameterized
@Query("SELECT * FROM items WHERE name = :input")
fun findByName(input: String): List<ItemEntity>
```

## Data Protection

- Use `EncryptedSharedPreferences` for sensitive key-value data on Android
- Use `@Serializable` with explicit field names — don't leak internal property names
- Clear sensitive data from memory when no longer needed
- Use `@Keep` or ProGuard rules for serialized classes to prevent name mangling

## Authentication

- Store tokens in secure storage, not in plain SharedPreferences
- Implement token refresh with proper 401/403 handling
- Clear all auth state on logout (tokens, cached user data, cookies)
- Use biometric authentication (`BiometricPrompt`) for sensitive operations

## ProGuard / R8

- Keep rules for all serialized models (`@Serializable`, Gson, Moshi)
- Keep rules for reflection-based libraries (Koin, Retrofit)
- Test release builds — obfuscation can break serialization silently

## WebView Security

- Disable JavaScript unless explicitly needed: `settings.javaScriptEnabled = false`
- Validate URLs before loading in WebView
- Never expose `@JavascriptInterface` methods that access sensitive data
- Use `WebViewClient.shouldOverrideUrlLoading()` to control navigation
