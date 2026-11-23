# 性能优化

## 模型选择策略

**Haiku 4.5** (具备 Sonnet 90% 的能力，节省 3 倍成本):

* 频繁调用的轻量级智能体
* 结对编程和代码生成
* 多智能体系统中的工作智能体

**Sonnet 5** (最佳编码模型):

* 主要的开发工作
* 编排多智能体工作流
* 复杂的编码任务

**Opus 5** (最深的推理能力):

* 复杂的架构决策
* 最高级别的推理需求
* 研究和分析任务

## 上下文窗口管理

避免使用上下文窗口的最后 20% 进行:

* 大规模重构
* 跨多个文件的功能实现
* 调试复杂的交互

上下文敏感性较低的任务:

* 单文件编辑
* 创建独立的实用工具
* 文档更新
* 简单的错误修复

## 扩展思考 + 计划模式

在 Claude Code 中，自适应推理让模型为每个任务自行决定思考量。对于 Fable 模型、Sonnet 5 及更高版本、Opus 4.7 及更高版本，应通过 effort 控制推理，而不是固定的令牌预算。可用级别取决于模型。

通过以下方式控制思考：

* **Effort（努力级别）**：在会话中使用 `/effort`，在启动时使用 `--effort <level>`，或设置 `CLAUDE_CODE_EFFORT_LEVEL`；环境变量优先于这两者，因此在改用其他方式前，请先从来源中移除它，并在启动 Claude Code 的 shell 中取消设置（或打开新的 shell），然后重启 Claude Code。在 `~/.claude/settings.json` 的 `modelSettings` 中按模型保存级别；较早的用户级 `effortLevel` 键不适用于 Opus 5.5 或更新的模型。
* **切换**：Option+T (macOS) / Alt+T (Windows/Linux)，或在设置中启用 `alwaysThinkingEnabled`。在 Opus 5.5、Sonnet 5.5 或 Fable 模型上，这些方式无法禁用思考。
* **固定预算**：在自适应推理模型上，Claude Code 会忽略正的 `MAX_THINKING_TOKENS` 值。在 Opus 4.6 或 Sonnet 4.6 上，设置 `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` 即可配合 `MAX_THINKING_TOKENS` 使用固定预算。
* **详细模式**：Ctrl+O 查看思考输出

支持的配置项参见 [Claude Code 模型配置](https://code.claude.com/docs/en/model-config#adjust-effort-level) 和 [环境变量](https://code.claude.com/docs/en/env-vars)。

对于需要深度推理的复杂任务:

1. 先确认当前级别，再用 `/effort` 选择支持范围内更高的级别；Opus 4.7 默认已是 `xhigh`，用 `high` 反而会降低级别
2. 启用 **计划模式** 以获得结构化方法
3. 使用多轮批判进行彻底分析
4. 使用分割角色子代理以获得多元视角

## 构建故障排除

如果构建失败:

1. 使用 **build-error-resolver** 智能体
2. 分析错误信息
3. 逐步修复
4. 每次修复后进行验证
