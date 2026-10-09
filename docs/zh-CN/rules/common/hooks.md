# Hooks 系统

## Hook 类型

* **PreToolUse**：工具执行前（验证、参数修改）
* **PostToolUse**：工具执行后（自动格式化、检查）
* **Stop**：会话结束时（最终验证）

## 自动接受权限

谨慎使用：

* 为受信任、定义明确的计划启用
* 为探索性工作禁用
* 切勿使用 dangerously-skip-permissions 标志
* 改为在 `~/.claude/settings.json`（或项目的 `.claude/settings.json`）中配置 `permissions.allow` 规则

## TodoWrite 最佳实践

使用 TodoWrite 工具来：

* 跟踪多步骤任务的进度
* 验证对指令的理解
* 实现实时指导
* 展示详细的实现步骤

待办事项列表可揭示：

* 步骤顺序错误
* 缺失的项目
* 额外不必要的项目
* 粒度错误
* 对需求的理解有误
