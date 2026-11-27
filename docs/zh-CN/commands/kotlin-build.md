---
description: 逐步修复 Kotlin/Gradle 构建错误、编译器警告和依赖项问题。调用 kotlin-build-resolver 代理进行最小化、精准的修复。
---

# Kotlin 构建与修复

此命令调用 **kotlin-build-resolver** 代理，以最小的改动增量修复 Kotlin 构建错误。

## 此命令的作用

1. **运行诊断**：执行 `./gradlew build`、`detekt`、`ktlintCheck`
2. **解析错误**：按文件分组并按严重性排序
3. **增量修复**：每次修复一个错误
4. **验证每次修复**：每次更改后重新运行构建
5. **报告摘要**：显示已修复的内容和剩余问题

## 何时使用

在以下情况使用 `/kotlin-build`：

* `./gradlew build` 因错误而失败
* Kotlin 编译器报告错误
* `./gradlew detekt` 报告违规
* Gradle 依赖项解析失败
* 拉取更改后导致构建失败

## 运行的诊断命令

```bash
# Primary build check
./gradlew build 2>&1

# Static analysis
./gradlew detekt 2>&1 || echo "detekt not configured"
./gradlew ktlintCheck 2>&1 || echo "ktlint not configured"

# Dependency issues
./gradlew dependencies --configuration runtimeClasspath 2>&1 | head -100

# Optional deep refresh when caches or dependency metadata are suspect
./gradlew build --refresh-dependencies
```

## 示例会话

````text
User: /kotlin-build

Agent:
# Kotlin Build Resolution

## Initial Diagnostics

```bash
$ ./gradlew build
e: src/main/kotlin/com/example/service/UserService.kt:25:15 Unresolved reference: UserRepository
e: src/main/kotlin/com/example/routes/UserRoutes.kt:42:9 Type mismatch: inferred type is String but Int was expected
e: src/main/kotlin/com/example/routes/UserRoutes.kt:58:5 'when' expression must be exhaustive
```

Errors found: 3

## Fix 1: Unresolved Reference

File: src/main/kotlin/com/example/service/UserService.kt:25
Error: Unresolved reference: UserRepository
Cause: Missing import

```kotlin
// Added import
import com.example.repository.UserRepository
```

```bash
$ ./gradlew build
# 2 errors remaining
```

## Fix 2: Type Mismatch

File: src/main/kotlin/com/example/routes/UserRoutes.kt:42
Error: Type mismatch: inferred type is String but Int was expected

```kotlin
// Changed
val count = call.parameters["count"]
// To
val count = call.parameters["count"]?.toIntOrNull()
    ?: return@get call.respond(HttpStatusCode.BadRequest, "Invalid count")
```

```bash
$ ./gradlew build
# 1 error remaining
```

## Fix 3: Non-Exhaustive When

File: src/main/kotlin/com/example/routes/UserRoutes.kt:58
Error: 'when' expression must be exhaustive

```kotlin
// Added missing branch
when (user.role) {
    Role.ADMIN -> handleAdmin(user)
    Role.USER -> handleUser(user)
    Role.MODERATOR -> handleModerator(user) // Added
}
```

```bash
$ ./gradlew build
# Build successful!
```

## Final Verification

```bash
$ ./gradlew detekt
# No issues

$ ./gradlew test
# All tests passed
```

## Summary

| Metric | Count |
|--------|-------|
| Build errors fixed | 3 |
| Detekt issues fixed | 0 |
| Files modified | 2 |
| Remaining issues | 0 |

Build Status: PASS: SUCCESS
````

## 常见的已修复错误

| 错误 | 典型修复方法 |
|-------|-------------|
| `Unresolved reference: X` | 添加导入或依赖项 |
| `Type mismatch` | 修复类型转换或赋值 |
| `'when' must be exhaustive` | 添加缺失的密封类分支 |
| `Suspend function can only be called from coroutine` | 添加 `suspend` 修饰符 |
| `Smart cast impossible` | 使用局部 `val` 或 `let` |
| `None of the following candidates is applicable` | 修复参数类型 |
| `Could not resolve dependency` | 修复版本或添加仓库 |

## 修复策略

1. **首先修复构建错误** - 代码必须能够编译
2. **其次修复 Detekt 违规** - 修复代码质量问题
3. **再次修复 ktlint 警告** - 修复格式问题
4. **一次修复一个** - 验证每次更改
5. **最小化改动** - 不进行重构，仅修复问题

## 停止条件

代理将在以下情况下停止并报告：

* 同一错误尝试修复 3 次后仍然存在
* 修复引入了更多错误
* 需要进行架构性更改
* 缺少外部依赖项

## 相关命令

* `/kotlin-test` - 构建成功后运行测试
* `/kotlin-review` - 审查代码质量
* `/verify` - 完整的验证循环

## 相关

* 代理：`agents/kotlin-build-resolver.md`
* 技能：`skills/kotlin-patterns/`
