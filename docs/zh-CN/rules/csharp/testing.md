---
paths:
  - "**/*.cs"
  - "**/*.csx"
  - "**/*.csproj"
---

# C# 测试

> 本文档扩展了 [common/testing.md](../common/testing.md) 中关于 C# 的特定内容。

## 测试框架

* 单元测试和集成测试首选 **xUnit**
* 使用 **FluentAssertions** 编写可读性强的断言
* 使用 **Moq** 或 **NSubstitute** 来模拟依赖项
* 当集成测试需要真实基础设施时，使用 **Testcontainers**

## 测试组织

* 在 `tests/` 下镜像 `src/` 的结构
* 明确区分单元测试、集成测试和端到端测试的覆盖范围
* 根据行为而非实现细节来命名测试

```csharp
public sealed class OrderServiceTests
{
    [Fact]
    public async Task FindByIdAsync_ReturnsOrder_WhenOrderExists()
    {
        // Arrange
        // Act
        // Assert
    }
}
```

## ASP.NET Core 集成测试

* 使用 `WebApplicationFactory<TEntryPoint>` 进行 API 集成测试覆盖
* 通过 HTTP 测试身份验证、验证和序列化，而不是绕过中间件

## 覆盖率

* 目标行覆盖率 80% 以上
* 将覆盖率重点放在领域逻辑、验证、身份验证和失败路径上
* 在 CI 中运行 `dotnet test` 并启用覆盖率收集（在可用的情况下）
