---
paths:
  - "**/*.pl"
  - "**/*.pm"
  - "**/*.t"
  - "**/*.psgi"
  - "**/*.cgi"
---

# Perl 钩子

> 本文件在 [common/hooks.md](../common/hooks.md) 的基础上扩展了 Perl 相关的内容。

## PostToolUse 钩子

在 `~/.claude/settings.json` 中配置：

* **perltidy**：编辑后自动格式化 `.pl` 和 `.pm` 文件
* **perlcritic**：编辑 `.pm` 文件后运行代码检查

## 警告

* 警告在非脚本 `.pm` 文件中使用 `print` — 应使用 `say` 或日志模块（例如，`Log::Any`）
