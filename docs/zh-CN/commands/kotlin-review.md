---
description: 全面的Kotlin代码审查，涵盖惯用模式、空安全、协程安全和安全性。调用kotlin-reviewer代理。
---

# Kotlin 代码审查

此命令调用 **kotlin-reviewer** 代理进行全面的 Kotlin 专项代码审查。

## 此命令的功能

1. **识别 Kotlin 变更**：通过 `git diff` 查找修改过的 `.kt` 和 `.kts` 文件
2. **运行构建与静态分析**：执行 `./gradlew build`、`detekt`、`ktlintCheck`
3. **安全扫描**：检查 SQL 注入、命令注入、硬编码的密钥
4. **空安全审查**：分析 `!!` 的使用、平台类型处理、不安全的转换
5. **协程审查**：检查结构化并发、调度器使用、取消操作
6. **生成报告**：按严重性对问题分类

## 使用时机

在以下情况使用 `/kotlin-review`：

* 编写或修改 Kotlin 代码后
* 提交 Kotlin 变更前
* 审查包含 Kotlin 代码的拉取请求时
* 接手新的 Kotlin 代码库时
* 学习 Kotlin 惯用模式时

## 审查类别

### 严重（必须修复）

* SQL/命令注入漏洞
* 无正当理由强制解包 `!!`
* 平台类型空安全违规
* 使用 GlobalScope（违反结构化并发）
* 硬编码的凭证
* 不安全的反序列化

### 高（应该修复）

* 可变状态，而不可变状态即可满足
* 在协程上下文中进行阻塞调用
* 长循环中缺少取消检查
* 对密封类型使用非穷举的 `when`
* 函数过大（>50 行）
* 嵌套过深（>4 层）

### 中（考虑修复）

* 非 Kotlin 惯用写法（Java 风格模式）
* 缺少尾随逗号
* 误用或嵌套作用域函数
* 大型集合链中缺少序列化
* 冗余的显式类型声明

## 运行的自动化检查

```bash
# Build check
./gradlew build

# Static analysis
./gradlew detekt

# Formatting check
./gradlew ktlintCheck

# Tests
./gradlew test
```

## 使用示例

````text
User: /kotlin-review

Agent:
# Kotlin Code Review Report

## Files Reviewed
- src/main/kotlin/com/example/service/UserService.kt (modified)
- src/main/kotlin/com/example/routes/UserRoutes.kt (modified)

## Static Analysis Results
✓ Build: Successful
✓ detekt: No issues
WARNING: ktlint: 2 formatting warnings

## Issues Found

[CRITICAL] Force-Unwrap Null Safety
File: src/main/kotlin/com/example/service/UserService.kt:28
Issue: Using !! on nullable repository result
```kotlin
val user = repository.findById(id)!!  // NPE risk
```
Fix: Use safe call with error handling
```kotlin
val user = repository.findById(id)
    ?: throw UserNotFoundException("User $id not found")
```

[HIGH] GlobalScope Usage
File: src/main/kotlin/com/example/routes/UserRoutes.kt:45
Issue: Using GlobalScope breaks structured concurrency
```kotlin
GlobalScope.launch {
    notificationService.sendWelcome(user)
}
```
Fix: Use the call's coroutine scope
```kotlin
launch {
    notificationService.sendWelcome(user)
}
```

## Summary
- CRITICAL: 1
- HIGH: 1
- MEDIUM: 0

Recommendation: FAIL: Block merge until CRITICAL issue is fixed
````

## 批准标准

| 状态 | 条件 |
|--------|-----------|
| PASS: 批准 | 无严重或高优先级问题 |
| WARNING: 警告 | 仅存在中优先级问题（谨慎合并） |
| FAIL: 阻止 | 发现严重或高优先级问题 |

## 与其他命令的集成

* 首先使用 `/kotlin-test` 确保测试通过
* 如果构建出错，使用 `/kotlin-build`
* 提交前使用 `/kotlin-review`
* 对于非 Kotlin 专项问题，使用 `/code-review`

## 相关

* 代理：`agents/kotlin-reviewer.md`
* 技能：`skills/kotlin-patterns/`、`skills/kotlin-testing/`
