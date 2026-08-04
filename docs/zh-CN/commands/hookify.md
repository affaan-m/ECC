---
description: 创建钩子以防止对话分析或明确指令产生的不当行为
---

创建钩子规则，通过分析对话模式或明确的用户指令，防止 Claude Code 出现不期望的行为。

## 用法

`/hookify [description of behavior to prevent]`

如果不提供参数，则分析当前对话以找出值得阻止的行为。

## 工作流程

### 第一步：收集行为信息

* 带参数：解析用户对不期望行为的描述
* 不带参数：使用 `conversation-analyzer` 智能体查找：
  * 明确的纠正
  * 对重复错误的沮丧反应
  * 被撤销的更改
  * 反复出现的类似问题

### 第二步：展示发现

向用户展示：

* 行为描述
* 建议的事件类型
* 建议的模式或匹配器
* 建议的操作

### 第三步：生成规则文件

为每个批准的规则，在 `.claude/hookify.{name}.local.md` 创建文件：

```yaml
---
name: rule-name
enabled: true
event: bash|file|stop|prompt|all
action: block|warn
pattern: "regex pattern"
---
Message shown when rule triggers.
```

### 第四步：确认

报告已创建的规则，以及如何使用 `/hookify-list` 和 `/hookify-configure` 管理这些规则。
