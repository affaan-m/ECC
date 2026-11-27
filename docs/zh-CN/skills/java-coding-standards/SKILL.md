---
name: java-coding-standards
description: "Spring Boot服务的Java编码标准：命名、不可变性、Optional用法、流、异常、泛型和项目布局。"
origin: ECC
---

# Java 编码规范

适用于 Spring Boot 服务中可读、可维护的 Java (17+) 代码的规范。

## 何时激活

* 在 Spring Boot 项目中编写或审查 Java 代码时
* 强制执行命名、不可变性或异常处理约定时
* 使用记录类、密封类或模式匹配（Java 17+）时
* 审查 Optional、流或泛型的使用时
* 构建包和项目布局时

## 核心原则

* 清晰优于巧妙
* 默认不可变；最小化共享可变状态
* 快速失败并提供有意义的异常
* 一致的命名和包结构

## 命名

```java
// PASS: Classes/Records: PascalCase
public class MarketService {}
public record Money(BigDecimal amount, Currency currency) {}

// PASS: Methods/fields: camelCase
private final MarketRepository marketRepository;
public Market findBySlug(String slug) {}

// PASS: Constants: UPPER_SNAKE_CASE
private static final int MAX_PAGE_SIZE = 100;
```

## 不可变性

```java
// PASS: Favor records and final fields
public record MarketDto(Long id, String name, MarketStatus status) {}

public class Market {
  private final Long id;
  private final String name;
  // getters only, no setters
}
```

## Optional 使用

```java
// PASS: Return Optional from find* methods
Optional<Market> market = marketRepository.findBySlug(slug);

// PASS: Map/flatMap instead of get()
return market
    .map(MarketResponse::from)
    .orElseThrow(() -> new EntityNotFoundException("Market not found"));
```

## Streams 最佳实践

```java
// PASS: Use streams for transformations, keep pipelines short
List<String> names = markets.stream()
    .map(Market::name)
    .filter(Objects::nonNull)
    .toList();

// FAIL: Avoid complex nested streams; prefer loops for clarity
```

## 异常

* 领域错误使用非受检异常；包装技术异常时提供上下文
* 创建特定领域的异常（例如，`MarketNotFoundException`）
* 避免宽泛的 `catch (Exception ex)`，除非在中心位置重新抛出/记录

```java
throw new MarketNotFoundException(slug);
```

## 泛型和类型安全

* 避免原始类型；声明泛型参数
* 对于可复用的工具类，优先使用有界泛型

```java
public <T extends Identifiable> Map<Long, T> indexById(Collection<T> items) { ... }
```

## 项目结构 (Maven/Gradle)

```
src/main/java/com/example/app/
  config/
  controller/
  service/
  repository/
  domain/
  dto/
  util/
src/main/resources/
  application.yml
src/test/java/... (mirrors main)
```

## 格式化和风格

* 一致地使用 2 或 4 个空格（项目标准）
* 每个文件一个公共顶级类型
* 保持方法简短且专注；提取辅助方法
* 成员顺序：常量、字段、构造函数、公共方法、受保护方法、私有方法

## 需要避免的代码坏味道

* 长参数列表 → 使用 DTO/构建器
* 深度嵌套 → 提前返回
* 魔法数字 → 命名常量
* 静态可变状态 → 优先使用依赖注入
* 静默捕获块 → 记录日志并处理或重新抛出

## 日志记录

```java
private static final Logger log = LoggerFactory.getLogger(MarketService.class);
log.info("fetch_market slug={}", slug);
log.error("failed_fetch_market slug={}", slug, ex);
```

## Null 处理

* 仅在不可避免时接受 `@Nullable`；否则使用 `@NonNull`
* 在输入上使用 Bean 验证（`@NotNull`, `@NotBlank`）

## 测试期望

* 使用 JUnit 5 + AssertJ 进行流畅的断言
* 使用 Mockito 进行模拟；尽可能避免部分模拟
* 倾向于确定性测试；没有隐藏的休眠

**记住**：保持代码意图明确、类型安全且可观察。除非证明有必要，否则优先考虑可维护性而非微优化。
