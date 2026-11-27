---
paths:
  - "**/*.cs"
  - "**/*.csx"
  - "**/*.csproj"
  - "**/appsettings*.json"
---

# C# 安全性

> 本文档在 [common/security.md](../common/security.md) 的基础上补充了 C# 特有的内容。

## 密钥管理

* 切勿在源代码中硬编码 API 密钥、令牌或连接字符串
* 在本地开发环境中使用环境变量或用户密钥，在生产环境中使用密钥管理器
* 确保 `appsettings.*.json` 中不包含真实的凭证信息

```csharp
// BAD
const string ApiKey = "sk-live-123";

// GOOD
var apiKey = builder.Configuration["OpenAI:ApiKey"]
    ?? throw new InvalidOperationException("OpenAI:ApiKey is not configured.");
```

## SQL 注入防范

* 始终使用 ADO.NET、Dapper 或 EF Core 的参数化查询
* 切勿将用户输入直接拼接到 SQL 字符串中
* 在使用动态查询构建时，先对排序字段和筛选操作符进行验证

```csharp
const string sql = "SELECT * FROM Orders WHERE CustomerId = @customerId";
await connection.QueryAsync<Order>(sql, new { customerId });
```

## 输入验证

* 在应用程序边界处验证 DTO
* 使用数据注解、FluentValidation 或显式的守卫子句
* 在执行业务逻辑之前拒绝无效的模型状态

## 身份验证与授权

* 优先使用框架提供的身份验证处理器，而非自定义的令牌解析逻辑
* 在端点或处理器边界强制执行授权策略
* 切勿记录原始令牌、密码或个人身份信息 (PII)

## 错误处理

* 返回面向客户端的、安全的错误信息
* 在服务器端记录包含结构化上下文的详细异常信息
* 切勿在 API 响应中暴露堆栈跟踪、SQL 语句或文件系统路径

## 参考资料

有关更广泛的应用安全审查清单，请参阅技能：`security-review`。
