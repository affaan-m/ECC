---
description: 修复 Android 和 KMP 项目的 Gradle 构建错误
---

# Gradle 构建修复

逐步修复 Android 和 Kotlin 多平台项目的 Gradle 构建和编译错误。

## 步骤 1：检测构建配置

识别项目类型并运行相应的构建：

| 指示符 | 构建命令 |
|-----------|---------------|
| `build.gradle.kts` + `composeApp/` (KMP) | `./gradlew composeApp:compileKotlinMetadata 2>&1` |
| `build.gradle.kts` + `app/` (Android) | `./gradlew app:compileDebugKotlin 2>&1` |
| `settings.gradle.kts` 包含模块 | `./gradlew assemble 2>&1` |
| 配置了 Detekt | `./gradlew detekt 2>&1` |

同时检查 `gradle.properties` 和 `local.properties` 以获取配置信息。

## 步骤 2：解析并分组错误

1. 运行构建命令并捕获输出
2. 将 Kotlin 编译错误与 Gradle 配置错误分开
3. 按模块和文件路径分组
4. 排序：先处理配置错误，然后按依赖顺序处理编译错误

## 步骤 3：修复循环

针对每个错误：

1. **读取文件** — 错误行周围的完整上下文
2. **诊断** — 常见类别：
   * 缺少导入或无法解析的引用
   * 类型不匹配或不兼容的类型
   * `build.gradle.kts` 中缺少依赖项
   * Expect/actual 不匹配 (KMP)
   * Compose 编译器错误
3. **最小化修复** — 解决错误所需的最小改动
4. **重新运行构建** — 验证修复并检查新错误
5. **继续** — 处理下一个错误

## 步骤 4：防护措施

如果出现以下情况，请停止并询问用户：

* 修复引入的错误比解决的错误多
* 同一错误在 3 次尝试后仍然存在
* 错误需要添加新的依赖项或更改模块结构
* Gradle 同步本身失败（配置阶段错误）
* 错误出现在生成的代码中（Room、SQLDelight、KSP）

## 步骤 5：总结

报告：

* 已修复的错误（模块、文件、描述）
* 剩余的错误
* 引入的新错误（应为零）
* 建议的后续步骤

## 常见的 Gradle/KMP 修复方案

| 错误 | 修复方法 |
|-------|-----|
| `commonMain` 中无法解析的引用 | 检查依赖项是否在 `commonMain.dependencies {}` 中 |
| Expect 声明没有 actual 实现 | 在每个平台源码集中添加 `actual` 实现 |
| Compose 编译器版本不匹配 | 在 `libs.versions.toml` 中统一 Kotlin 和 Compose 编译器版本 |
| 重复类 | 使用 `./gradlew dependencies` 检查是否存在冲突的依赖项 |
| KSP 错误 | 运行 `./gradlew kspCommonMainKotlinMetadata` 重新生成 |
| 配置缓存问题 | 检查是否存在不可序列化的任务输入 |
