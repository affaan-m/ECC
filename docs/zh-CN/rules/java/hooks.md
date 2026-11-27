---
paths:
  - "**/*.java"
  - "**/pom.xml"
  - "**/build.gradle"
  - "**/build.gradle.kts"
---

# Java 钩子

> 本文件在[common/hooks.md](../common/hooks.md)的基础上扩展了Java相关的内容。

## PostToolUse 钩子

在 `~/.claude/settings.json` 中配置：

* **google-java-format**：编辑后自动格式化 `.java` 文件
* **checkstyle**：编辑Java文件后运行样式检查
* **./mvnw compile** 或 **./gradlew compileJava**：变更后验证编译
