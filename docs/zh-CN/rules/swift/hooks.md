---
paths:
  - "**/*.swift"
  - "**/Package.swift"
---

# Swift 钩子

> 此文件扩展了 [common/hooks.md](../common/hooks.md) 的内容，添加了 Swift 特定内容。

## PostToolUse 钩子

在 `~/.claude/settings.json` 中配置：

* **SwiftFormat**: 在编辑后自动格式化 `.swift` 文件
* **SwiftLint**: 在编辑 `.swift` 文件后运行代码检查
* **swift build**: 在编辑后对修改的包进行类型检查

## 警告

标记 `print()` 语句 — 在生产代码中请改用 `os.Logger` 或结构化日志记录。
