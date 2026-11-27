---
paths:
  - "**/*.java"
---

# Java 编码风格

> 本文档基于 [common/coding-style.md](../common/coding-style.md)，补充了 Java 特有的内容。

## 格式

* 使用 **google-java-format** 或 **Checkstyle**（Google 或 Sun 风格）进行强制规范
* 每个文件只包含一个顶层的公共类型
* 保持一致的缩进：2 或 4 个空格（遵循项目标准）
* 成员顺序：常量、字段、构造函数、公共方法、受保护方法、私有方法

## 不可变性

* 对于值类型，优先使用 `record`（Java 16+）
* 默认将字段标记为 `final` —— 仅在需要时才使用可变状态
* 从公共 API 返回防御性副本：`List.copyOf()`、`Map.copyOf()`、`Set.copyOf()`
* 写时复制：返回新实例，而不是修改现有实例

```java
// GOOD — immutable value type
public record OrderSummary(Long id, String customerName, BigDecimal total) {}

// GOOD — final fields, no setters
public class Order {
    private final Long id;
    private final List<LineItem> items;

    public List<LineItem> getItems() {
        return List.copyOf(items);
    }
}
```

## 命名

遵循标准的 Java 命名约定：

* `PascalCase` 用于类、接口、记录、枚举
* `camelCase` 用于方法、字段、参数、局部变量
* `SCREAMING_SNAKE_CASE` 用于 `static final` 常量
* 包名：全小写，使用反向域名（`com.example.app.service`）

## 现代 Java 特性

在能提高代码清晰度的地方使用现代语言特性：

* **记录** 用于 DTO 和值类型（Java 16+）
* **密封类** 用于封闭的类型层次结构（Java 17+）
* 使用 `instanceof` 进行**模式匹配** —— 避免显式类型转换（Java 16+）
* **文本块** 用于多行字符串 —— SQL、JSON 模板（Java 15+）
* 使用箭头语法的**Switch 表达式**（Java 14+）
* **Switch 中的模式匹配** —— 用于处理密封类型的穷举情况（Java 21+）

```java
// Pattern matching instanceof
if (shape instanceof Circle c) {
    return Math.PI * c.radius() * c.radius();
}

// Sealed type hierarchy
public sealed interface PaymentMethod permits CreditCard, BankTransfer, Wallet {}

// Switch expression
String label = switch (status) {
    case ACTIVE -> "Active";
    case SUSPENDED -> "Suspended";
    case CLOSED -> "Closed";
};
```

## Optional 的使用

* 从可能没有结果的查找方法中返回 `Optional<T>`
* 使用 `map()`、`flatMap()`、`orElseThrow()` —— 绝不直接调用 `get()` 而不先检查 `isPresent()`
* 绝不将 `Optional` 用作字段类型或方法参数

```java
// GOOD
return repository.findById(id)
    .map(ResponseDto::from)
    .orElseThrow(() -> new OrderNotFoundException(id));

// BAD — Optional as parameter
public void process(Optional<String> name) {}
```

## 错误处理

* 对于领域错误，优先使用非受检异常
* 创建扩展自 `RuntimeException` 的领域特定异常
* 避免宽泛的 `catch (Exception e)`，除非在最顶层的处理器中
* 在异常消息中包含上下文信息

```java
public class OrderNotFoundException extends RuntimeException {
    public OrderNotFoundException(Long id) {
        super("Order not found: id=" + id);
    }
}
```

## 流

* 使用流进行转换；保持流水线简短（最多 3-4 个操作）
* 在可读性好的情况下，优先使用方法引用：`.map(Order::getTotal)`
* 避免在流操作中产生副作用
* 对于复杂逻辑，优先使用循环而不是难以理解的流流水线

## 参考

完整编码标准及示例，请参阅技能：`java-coding-standards`。
JPA/Hibernate 实体设计模式，请参阅技能：`jpa-patterns`。
