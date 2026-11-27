---
paths:
  - "**/*.kt"
  - "**/*.kts"
  - "**/build.gradle.kts"
---

# Kotlin Hooks

> 此文件在 [common/hooks.md](../common/hooks.md) 的基础上扩展了 Kotlin 相关内容。

## PostToolUse Hooks

在 `~/.claude/settings.json` 中配置：

* **ktfmt/ktlint**: 在编辑后自动格式化 `.kt` 和 `.kts` 文件
* **detekt**: 在编辑 Kotlin 文件后运行静态分析
* **./gradlew build**: 在更改后验证编译
