---
paths:
  - "**/*.kt"
  - "**/*.kts"
---

# Kotlin 安全

> 本文档基于 [common/security.md](../common/security.md)，补充了 Kotlin 和 Android/KMP 相关的内容。

## 密钥管理

* 切勿在源代码中硬编码 API 密钥、令牌或凭据
* 本地开发时，使用 `local.properties`（已通过 git 忽略）来管理密钥
* 发布版本中，使用由 CI 密钥生成的 `BuildConfig` 字段
* 运行时密钥存储使用 `EncryptedSharedPreferences`（Android）或 Keychain（iOS）

```kotlin
// BAD
val apiKey = "sk-abc123..."

// GOOD — from BuildConfig (generated at build time)
val apiKey = BuildConfig.API_KEY

// GOOD — from secure storage at runtime
val token = secureStorage.get("auth_token")
```

## 网络安全

* 仅使用 HTTPS —— 配置 `network_security_config.xml` 以阻止明文传输
* 使用 OkHttp 的 `CertificatePinner` 或 Ktor 的等效功能为敏感端点固定证书
* 为所有 HTTP 客户端设置超时 —— 切勿使用默认值（可能为无限长）
* 在使用所有服务器响应前，先进行验证和清理

```xml
<!-- res/xml/network_security_config.xml -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
```

## 输入验证

* 在处理或将用户输入发送到 API 之前，验证所有用户输入
* 对 Room/SQLDelight 使用参数化查询 —— 切勿将用户输入拼接到 SQL 语句中
* 清理用户输入中的文件路径，以防止路径遍历攻击

```kotlin
// BAD — SQL injection
@Query("SELECT * FROM items WHERE name = '$input'")

// GOOD — parameterized
@Query("SELECT * FROM items WHERE name = :input")
fun findByName(input: String): List<ItemEntity>
```

## 数据保护

* 在 Android 上，使用 `EncryptedSharedPreferences` 存储敏感键值数据
* 使用 `@Serializable` 并明确指定字段名 —— 不要泄露内部属性名
* 敏感数据不再需要时，从内存中清除
* 对序列化类使用 `@Keep` 或 ProGuard 规则，以防止名称混淆

## 身份验证

* 将令牌存储在安全存储中，而非普通的 SharedPreferences
* 实现令牌刷新机制，并正确处理 401/403 状态码
* 退出登录时清除所有身份验证状态（令牌、缓存的用户数据、Cookie）
* 对敏感操作使用生物特征认证（`BiometricPrompt`）

## ProGuard / R8

* 为所有序列化模型（`@Serializable`、Gson、Moshi）保留规则
* 为基于反射的库（Koin、Retrofit）保留规则
* 测试发布版本 —— 混淆可能会静默地破坏序列化

## WebView 安全

* 除非明确需要，否则禁用 JavaScript：`settings.javaScriptEnabled = false`
* 在 WebView 中加载 URL 前，先进行验证
* 切勿暴露访问敏感数据的 `@JavascriptInterface` 方法
* 使用 `WebViewClient.shouldOverrideUrlLoading()` 来控制导航
