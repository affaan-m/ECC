---
description: 检索Jira工单，分析需求，更新状态或添加评论。使用jira-integration技能和MCP或REST API。
---

# Jira 命令

直接从工作流中与 Jira 工单交互——获取工单、分析需求、添加评论以及变更状态。

## 用法

```
/jira get <TICKET-KEY>          # 获取并分析工单
/jira comment <TICKET-KEY>      # 添加进度评论
/jira transition <TICKET-KEY>   # 更改工单状态
/jira search <JQL>              # 使用JQL搜索问题
```

## 此命令的功能

1. **获取与分析** — 获取 Jira 工单并提取需求、验收标准、测试场景和依赖项
2. **评论** — 向工单添加结构化的进度更新
3. **状态变更** — 在工作流状态间移动工单（待办 → 进行中 → 已完成）
4. **搜索** — 使用 JQL 查询查找问题

## 工作原理

### `/jira get <TICKET-KEY>`

1. 从 Jira 获取工单（通过 MCP `jira_get_issue` 或 REST API）
2. 提取所有字段：摘要、描述、验收标准、优先级、标签、关联问题
3. 可选地获取评论以获取更多上下文
4. 生成结构化分析：

```
Ticket: PROJ-1234
Summary: [标题]
Status: [状态]
Priority: [优先级]
Type: [故事/缺陷/任务]

Requirements:
1. [提取的需求]
2. [提取的需求]

Acceptance Criteria:
- [ ] [工单中的验收标准]

Test Scenarios:
- Happy Path: [描述]
- Error Case: [描述]
- Edge Case: [描述]

Dependencies:
- [关联的问题、API、服务]

Recommended Next Steps:
- /plan 创建实施计划
- `tdd-workflow` 技能以测试驱动开发方式实现
```

### `/jira comment <TICKET-KEY>`

1. 总结当前会话进度（已构建、已测试、已提交的内容）
2. 格式化为结构化评论
3. 发布到 Jira 工单

### `/jira transition <TICKET-KEY>`

1. 获取工单的可用状态变更
2. 向用户显示选项
3. 执行所选的状态变更

### `/jira search <JQL>`

1. 对 Jira 执行 JQL 查询
2. 返回匹配问题的摘要表格

## 前提条件

此命令需要 Jira 凭据。请选择以下方式之一：

**选项 A — MCP 服务器（推荐）：**
将 `jira` 添加到您的 `mcpServers` 配置中（请参阅 `mcp-configs/mcp-servers.json` 获取模板）。

**选项 B — 环境变量：**

```bash
export JIRA_URL="https://yourorg.atlassian.net"
export JIRA_EMAIL="your.email@example.com"
export JIRA_API_TOKEN="your-api-token"
```

如果缺少凭据，请停止并引导用户进行设置。

## 与其他命令的集成

分析工单后：

* 使用 `/plan` 根据需求创建实施计划
* 使用 `tdd-workflow` 技能进行测试驱动开发实施
* 实施后使用 `/code-review`
* 使用 `/jira comment` 将进度发布回工单
* 工作完成后使用 `/jira transition` 移动工单

## 相关

* **技能：** `skills/jira-integration/`
* **MCP 配置：** `mcp-configs/mcp-servers.json` → `jira`
