---
paths:
  - "**/*.php"
  - "**/composer.json"
  - "**/phpstan.neon"
  - "**/phpstan.neon.dist"
  - "**/psalm.xml"
---

# PHP 钩子

> 此文件在 [common/hooks.md](../common/hooks.md) 的基础上扩展了 PHP 相关的内容。

## PostToolUse 钩子

在 `~/.claude/settings.json` 中配置：

* **Pint / PHP-CS-Fixer**：自动格式化编辑过的 `.php` 文件。
* **PHPStan / Psalm**：在类型化代码库中对编辑过的 PHP 文件运行静态分析。
* **PHPUnit / Pest**：当编辑影响到行为时，为被修改的文件或模块运行针对性测试。

## 警告

* 当编辑过的文件中存在 `var_dump`、`dd`、`dump` 或 `die()` 时发出警告。
* 当编辑的 PHP 文件添加了原始 SQL 或禁用了 CSRF/会话保护时发出警告。
