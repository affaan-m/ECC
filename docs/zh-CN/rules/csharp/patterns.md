---
paths:
  - "**/*.cs"
  - "**/*.csx"
---

# C# 模式

> 本文档在 [common/patterns.md](../common/patterns.md) 的基础上扩展了 C# 相关内容。

## API 响应模式

```csharp
public sealed record ApiResponse<T>(
    bool Success,
    T? Data = default,
    string? Error = null,
    object? Meta = null);
```

## 仓储模式

```csharp
public interface IRepository<T>
{
    Task<IReadOnlyList<T>> FindAllAsync(CancellationToken cancellationToken);
    Task<T?> FindByIdAsync(Guid id, CancellationToken cancellationToken);
    Task<T> CreateAsync(T entity, CancellationToken cancellationToken);
    Task<T> UpdateAsync(T entity, CancellationToken cancellationToken);
    Task DeleteAsync(Guid id, CancellationToken cancellationToken);
}
```

## 选项模式

使用强类型选项进行配置，而不是在整个代码库中读取原始字符串。

```csharp
public sealed class PaymentsOptions
{
    public const string SectionName = "Payments";
    public required string BaseUrl { get; init; }
    public required string ApiKeySecretName { get; init; }
}
```

## 依赖注入

* 在服务边界上依赖于接口
* 保持构造函数专注；如果某个服务需要太多依赖项，请拆分其职责
* 有意识地注册生命周期：无状态/共享服务使用单例，请求数据使用作用域，轻量级纯工作者使用瞬时
