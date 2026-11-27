---
paths:
  - "**/*.java"
---

# Java 安全

> 本文档在 [common/security.md](../common/security.md) 的基础上，补充了 Java 相关的内容。

## 密钥管理

* 切勿在源代码中硬编码 API 密钥、令牌或凭据
* 使用环境变量：`System.getenv("API_KEY")`
* 生产环境密钥请使用密钥管理器（如 Vault、AWS Secrets Manager）
* 包含密钥的本地配置文件应放在 `.gitignore` 中

```java
// BAD
private static final String API_KEY = "sk-abc123...";

// GOOD — environment variable
String apiKey = System.getenv("PAYMENT_API_KEY");
Objects.requireNonNull(apiKey, "PAYMENT_API_KEY must be set");
```

## SQL 注入防护

* 始终使用参数化查询——切勿将用户输入拼接到 SQL 语句中
* 使用 `PreparedStatement` 或你所使用框架的参数化查询 API
* 对用于原生查询的任何输入进行验证和清理

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

## 输入验证

* 在处理前，于系统边界处验证所有用户输入
* 使用验证框架时，在 DTO 上使用 Bean 验证（`@NotNull`, `@NotBlank`, `@Size`）
* 在使用文件路径和用户提供的字符串前，对其进行清理
* 对于验证失败的输入，应拒绝并提供清晰的错误信息

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

## 认证与授权

* 切勿自行实现认证加密逻辑——请使用成熟的库
* 使用 bcrypt 或 Argon2 存储密码，切勿使用 MD5/SHA1
* 在服务边界强制执行授权检查
* 清理日志中的敏感数据——切勿记录密码、令牌或个人身份信息

## 依赖项安全

* 运行 `mvn dependency:tree` 或 `./gradlew dependencies` 来审计传递依赖项
* 使用 OWASP Dependency-Check 或 Snyk 扫描已知的 CVE
* 保持依赖项更新——设置 Dependabot 或 Renovate

## 错误信息

* 切勿在 API 响应中暴露堆栈跟踪、内部路径或 SQL 错误
* 在处理器边界将异常映射为安全、通用的客户端消息
* 在服务器端记录详细错误；向客户端返回通用消息

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

## 参考

关于 Spring Security 认证与授权模式，请参见技能：`springboot-security`。
关于使用 JWT/OIDC、RBAC 和 CDI 的 Quarkus 安全模式，请参见技能：`quarkus-security`。
关于通用安全检查清单，请参见技能：`security-review`。
