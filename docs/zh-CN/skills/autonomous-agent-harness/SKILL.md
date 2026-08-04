---
name: autonomous-agent-harness
description: 将 Claude Code 转变为具有持久记忆、定时操作、计算机使用和任务队列的完全自主代理系统。通过利用 Claude Code 的原生定时任务、调度、MCP 工具和记忆，取代独立的代理框架（Hermes、AutoGPT）。当用户需要持续自主操作、定时任务或自我导向的代理循环时使用。
origin: ECC
---

# 自主代理框架

仅使用原生功能和 MCP 服务器，将 Claude Code 转变为持久化、自我导向的代理系统。

## 同意与安全边界

自主操作必须由用户明确请求并划定范围。除非用户已批准该能力以及当前设置的目标工作空间，否则不得创建计划、调度远程代理、写入持久化内存、使用计算机控制、发布外部内容、修改第三方资源或处理私人通信。

在启用定期或事件驱动操作之前，优先使用预演计划和本地队列文件。将凭据、私有工作空间导出、个人数据集和账户特定自动化排除在可复用的 ECC 工件之外。

## 何时激活

* 用户需要一个持续运行或按计划运行的代理
* 设置定期触发的自动化工作流
* 构建一个跨会话记住上下文的个人 AI 助手
* 用户说“每天运行这个”、“定期检查这个”、“持续监控”
* 希望复制 Hermes、AutoGPT 或类似自主代理框架的功能
* 需要计算机使用与计划执行相结合

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│                    Claude Code 运行时                         │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │  定时任务 │  │  远程调度 │  │  记忆存储 │  │  计算机使用  │ │
│  │  调度器   │  │  代理    │  │          │  │             │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬──────┘ │
│       │              │             │                │        │
│       ▼              ▼             ▼                ▼        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              ECC 技能 + 代理层                        │    │
│  │                                                      │    │
│  │  skills/     agents/     commands/     hooks/        │    │
│  └──────────────────────────────────────────────────────┘    │
│       │              │             │                │        │
│       ▼              ▼             ▼                ▼        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              MCP 服务器层                             │    │
│  │                                                      │    │
│  │  memory    github    exa    supabase    browser-use  │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. 持久化内存

使用 Claude Code 的内置内存系统，并通过 MCP 内存服务器增强以处理结构化数据。

**内置内存**（`~/.claude/projects/*/memory/`）：

* 用户偏好、反馈、项目上下文
* 存储为带有前置元数据的 Markdown 文件
* 在会话启动时自动加载

**MCP 内存服务器**（结构化知识图谱）：

* 实体、关系、观察
* 可查询的图结构
* 跨会话持久化

**内存模式：**

```
# 短期：当前会话上下文
使用 TodoWrite 进行会话内任务追踪

# 中期：项目记忆文件
写入 ~/.claude/projects/*/memory/ 以实现跨会话回忆

# 长期：MCP 知识图谱
使用 mcp__memory__create_entities 创建永久结构化数据
使用 mcp__memory__create_relations 进行关系映射
使用 mcp__memory__add_observations 添加关于已知实体的新事实
```

### 2. 计划操作（定时任务）

使用 Claude Code 的计划任务创建定期代理操作。

**设置定时任务：**

```
# Via MCP tool
mcp__scheduled-tasks__create_scheduled_task({
  name: "daily-pr-review",
  schedule: "0 9 * * 1-5",  # 工作日上午9点
  prompt: "Review all open PRs in affaan-m/everything-claude-code. For each: check CI status, review changes, flag issues. Post summary to memory.",
  project_dir: "/path/to/repo"
})

# Via claude -p (程序化模式)
echo "Review open PRs and summarize" | claude -p --project /path/to/repo
```

**有用的定时任务模式：**

| 模式 | 计划 | 用例 |
|---------|----------|----------|
| 每日站会 | `0 9 * * 1-5` | 审查 PR、问题、部署状态 |
| 每周回顾 | `0 10 * * 1` | 代码质量指标、测试覆盖率 |
| 每小时监控 | `0 * * * *` | 生产健康、错误率检查 |
| 夜间构建 | `0 2 * * *` | 运行完整测试套件、安全扫描 |
| 会前准备 | `*/30 * * * *` | 为即将到来的会议准备上下文 |

### 3. 调度 / 远程代理

远程触发 Claude Code 代理以进行事件驱动的工作流。

**调度模式：**

```bash
# Trigger from CI/CD
curl -X POST "https://api.anthropic.com/dispatch" \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -d '{"prompt": "Build failed on main. Diagnose and fix.", "project": "/repo"}'

# Trigger from webhook
# GitHub webhook → dispatch → Claude agent → fix → PR

# Trigger from another agent
claude -p "Analyze the output of the security scan and create issues for findings"
```

### 4. 计算机使用

利用 Claude 的计算机使用 MCP 进行物理世界交互。

**能力：**

* 浏览器自动化（导航、点击、填写表单、截图）
* 桌面控制（打开应用、输入、鼠标控制）
* 超越 CLI 的文件系统操作

**在框架内的用例：**

* Web UI 的自动化测试
* 表单填写和数据录入
* 基于截图的监控
* 多应用工作流

### 5. 任务队列

管理一个跨会话边界的持久化任务队列。

**实现：**

```
# 通过记忆实现任务持久化
将任务队列写入 ~/.claude/projects/*/memory/task-queue.md

# 任务格式
---
name: task-queue
type: project
description: 用于自主操作的持久化任务队列
---

## 活跃任务
- [ ] PR #123: 审查并在CI通过后批准
- [ ] 监控部署：每30分钟检查一次 /health，持续2小时
- [ ] 调研：在AI工具领域寻找5个潜在客户

## 已完成
- [x] 每日站会：审查了3个PR，2个问题
```

## 替换 Hermes

| Hermes 组件 | ECC 等效组件 | 如何实现 |
|------------------|---------------|-----|
| 网关/路由器 | Claude Code 调度 + 定时任务 | 计划任务触发代理会话 |
| 内存系统 | Claude 内存 + MCP 内存服务器 | 内置持久化 + 知识图谱 |
| 工具注册表 | MCP 服务器 | 动态加载的工具提供者 |
| 编排 | ECC 技能 + 代理 | 技能定义指导代理行为 |
| 计算机使用 | 计算机使用 MCP | 原生浏览器和桌面控制 |
| 上下文管理器 | 会话管理 + 内存 | ECC 2.0 会话生命周期 |
| 任务队列 | 内存持久化任务列表 | TodoWrite + 内存文件 |

## 设置指南

### 步骤 1：配置 MCP 服务器

确保这些在 `~/.claude.json` 中：

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@anthropic/memory-mcp-server"]
    },
    "scheduled-tasks": {
      "command": "npx",
      "args": ["-y", "@anthropic/scheduled-tasks-mcp-server"]
    },
    "computer-use": {
      "command": "npx",
      "args": ["-y", "@anthropic/computer-use-mcp-server"]
    }
  }
}
```

### 步骤 2：创建基础定时任务

```bash
# Daily morning briefing
claude -p "Create a scheduled task: every weekday at 9am, review my GitHub notifications, open PRs, and calendar. Write a morning briefing to memory."

# Continuous learning
claude -p "Create a scheduled task: every Sunday at 8pm, extract patterns from this week's sessions and update the learned skills."
```

### 步骤 3：初始化内存图谱

```bash
# Bootstrap your identity and context
claude -p "Create memory entities for: me (user profile), my projects, my key contacts. Add observations about current priorities."
```

### 步骤 4：启用计算机使用（可选）

授予计算机使用 MCP 浏览器和桌面控制所需的权限。

## 示例工作流

### 自主 PR 审查员

```
Cron: 工作时间内每30分钟执行一次
1. 检查关注仓库的新PR
2. 对每个新PR：
   - 在本地拉取分支
   - 运行测试
   - 使用代码审查代理审查变更
   - 通过GitHub MCP发布审查评论
3. 更新审查状态到记忆库
```

### 个人研究代理

```
Cron: 每天上午6点执行
1. 检查内存中保存的搜索查询
2. 对每个查询运行Exa搜索
3. 总结新发现
4. 与昨日结果进行对比
5. 将摘要写入内存
6. 标记高优先级项目供晨间审阅
```

### 会议准备代理

```
触发条件：每个日历事件前30分钟
1. 读取日历事件详情
2. 搜索记忆中关于参会者的背景信息
3. 提取与参会者近期的邮件/Slack讨论记录
4. 准备谈话要点和议程建议
5. 将准备文档写入记忆
```

## 约束

* 定时任务在隔离的会话中运行——除非通过内存，否则它们不与交互式会话共享上下文。
* 计算机使用需要明确的权限授予。不要假设可以访问。
* 远程调度可能有速率限制。设计定时任务时使用适当的间隔。
* 内存文件应保持简洁。归档旧数据，而不是让文件无限增长。
* 始终验证计划任务是否成功完成。在定时任务提示中添加错误处理。
