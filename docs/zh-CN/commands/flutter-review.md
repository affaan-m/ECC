---
description: 审查 Flutter/Dart 代码，检查惯用模式、小部件最佳实践、状态管理、性能、可访问性和安全性。调用 flutter-reviewer 代理。
---

# Flutter 代码审查

此命令调用 **flutter-reviewer** 智能体来审查 Flutter/Dart 代码变更。

## 此命令的功能

1. **收集上下文**：审查 `git diff --staged` 和 `git diff`
2. **检查项目**：检查 `pubspec.yaml`、`analysis_options.yaml`、状态管理方案
3. **安全预扫描**：检查硬编码密钥和关键安全问题
4. **全面审查**：应用完整的审查清单
5. **报告发现**：按严重程度分组输出问题，并附带修复指导

## 前置条件

在运行 `/flutter-review` 之前，请确保：

1. **构建通过** — 先运行 `/flutter-build`；对损坏的代码进行审查是不完整的
2. **测试通过** — 运行 `/flutter-test` 以确认没有回归问题
3. **无合并冲突** — 解决所有冲突，使差异仅反映有意的更改
4. **`flutter analyze` 干净** — 在审查前修复分析器警告

## 使用时机

在以下情况下使用 `/flutter-review`：

* 提交包含 Flutter/Dart 变更的 PR 之前（在构建和测试通过后）
* 实现新功能后，尽早发现问题
* 审查他人的 Flutter 代码时
* 审计 widget、状态管理组件或服务类时
* 生产发布之前

## 审查领域

| 领域 | 严重程度 |
|------|----------|
| 硬编码密钥、明文 HTTP | 严重 |
| 架构违规、状态管理反模式 | 严重 |
| Widget 重建问题、资源泄漏 | 高 |
| `dispose()`、`BuildContext` 后缺少 await | 高 |
| Dart 空安全、缺少错误/加载状态 | 高 |
| Const 传播、Widget 组合 | 高 |
| 性能：`build()` 中的耗时操作 | 高 |
| 无障碍、语义标签 | 中 |
| 缺少状态转换测试 | 高 |
| 硬编码字符串（l10n） | 中 |
| Pub 依赖卫生 | 低 |

## 示例会话

```text
用户：/flutter-review

代理：
# Flutter 代码审查

## 上下文

变更文件：
- lib/features/auth/presentation/login_page.dart
- lib/features/auth/data/auth_repository_impl.dart

状态管理：Riverpod（从 pubspec.yaml 检测到）
架构：功能优先

## 安全预扫描

✓ 未检测到硬编码密钥
✓ 未检测到明文 HTTP 调用

## 审查发现

[高] 异步间隙后使用 BuildContext 但未进行 mounted 检查
文件：lib/features/auth/presentation/login_page.dart:67
问题：`context.go('/home')` 在 `await auth.login(...)` 之后调用，但未进行 `mounted` 检查。
修复：在所有 await 之后的导航前添加 `if (!context.mounted) return;`（Flutter 3.7+）。

[高] AsyncValue 错误状态未处理
文件：lib/features/auth/presentation/login_page.dart:42
问题：`ref.watch(authProvider)` 在 switch 中处理了 loading/data 状态，但没有 `error` 分支。
修复：在 switch 表达式或 `when()` 调用中添加错误情况，以显示面向用户的错误消息。

[中] 硬编码字符串未本地化
文件：lib/features/auth/presentation/login_page.dart:89
问题：`Text('Login')` — 用户可见字符串未使用本地化系统。
修复：使用项目的 l10n 访问器：`Text(context.l10n.loginButton)`。

## 审查总结

| 严重程度 | 数量 | 状态 |
|----------|------|------|
| 严重     | 0    | 通过 |
| 高       | 2    | 阻塞 |
| 中       | 1    | 信息 |
| 低       | 0    | 备注 |

结论：阻塞 — 高严重性问题必须在合并前修复。
```

## 批准标准

* **批准**：无严重或高等级问题
* **阻止**：任何严重或高等级问题必须在合并前修复

## 相关命令

* `/flutter-build` — 先修复构建错误
* `/flutter-test` — 审查前运行测试
* `/code-review` — 通用代码审查（语言无关）

## 相关

* 智能体：`agents/flutter-reviewer.md`
* 技能：`skills/flutter-dart-code-review/`
* 规则：`rules/dart/`
