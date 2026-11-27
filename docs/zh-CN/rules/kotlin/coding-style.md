---
paths:
  - "**/*.kt"
  - "**/*.kts"
---

# Kotlin 编码风格

> 本文档在 [common/coding-style.md](../common/coding-style.md) 的基础上扩展了 Kotlin 相关内容。

## 格式化

* 使用 **ktlint** 或 **Detekt** 进行风格检查
* 遵循官方 Kotlin 代码风格 (`kotlin.code.style=official` 在 `gradle.properties` 中)

## 不可变性

* 优先使用 `val` 而非 `var` — 默认使用 `val`，仅在需要可变性时使用 `var`
* 对值类型使用 `data class`；在公共 API 中使用不可变集合 (`List`, `Map`, `Set`)
* 状态更新使用写时复制：`state.copy(field = newValue)`

## 命名

遵循 Kotlin 约定：

* 函数和属性使用 `camelCase`
* 类、接口、对象和类型别名使用 `PascalCase`
* 常量 (`const val` 或 `@JvmStatic`) 使用 `SCREAMING_SNAKE_CASE`
* 接口以行为而非 `I` 为前缀：使用 `Clickable` 而非 `IClickable`

## 空安全

* 绝不使用 `!!` — 优先使用 `?.`, `?:`, `requireNotNull()` 或 `checkNotNull()`
* 使用 `?.let {}` 进行作用域内的空安全操作
* 对于确实可能没有结果的函数，返回可为空的类型

```kotlin
// BAD
val name = user!!.name

// GOOD
val name = user?.name ?: "Unknown"
val name = requireNotNull(user) { "User must be set before accessing name" }.name
```

## 密封类型

使用密封类/接口来建模封闭的状态层次结构：

```kotlin
sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Success<T>(val data: T) : UiState<T>
    data class Error(val message: String) : UiState<Nothing>
}
```

对密封类型始终使用详尽的 `when` — 不要使用 `else` 分支。

## 扩展函数

使用扩展函数实现工具操作，但要确保其可发现性：

* 放在以接收者类型命名的文件中 (`StringExt.kt`, `FlowExt.kt`)
* 限制作用域 — 不要向 `Any` 或过于泛化的类型添加扩展

## 作用域函数

使用合适的作用域函数：

* `let` — 空检查并转换：`user?.let { greet(it) }`
* `run` — 使用接收者计算结果：`service.run { fetch(config) }`
* `apply` — 配置对象：`builder.apply { timeout = 30 }`
* `also` — 副作用：`result.also { log(it) }`
* 避免深度嵌套作用域函数（最多 2 层）

## 错误处理

* 使用 `Result<T>` 或自定义密封类型
* 使用 `runCatching {}` 包装可能抛出异常的代码
* 绝不捕获 `CancellationException` — 始终重新抛出它
* 避免使用 `try-catch` 进行控制流

```kotlin
// BAD — using exceptions for control flow
val user = try { repository.getUser(id) } catch (e: NotFoundException) { null }

// GOOD — nullable return
val user: User? = repository.findUser(id)
```
