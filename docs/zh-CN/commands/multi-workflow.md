# 工作流程 - 多模型协同开发

多模型协同开发工作流程（研究 → 构思 → 规划 → 执行 → 优化 → 审查），带有智能路由：前端 → Gemini，后端 → Codex。

> **前提条件：** 此命令需要外部的 `ccg-workflow` 运行时，它**不**包含在基础 ECC 安装中。请运行 `npx ccg-workflow` 进行初始化，以配置此命令所依赖的 `~/.claude/bin/codeagent-wrapper` 和 `~/.claude/.ccg/prompts/*` 角色文件。没有该运行时，此命令将无法正常运行。

结构化开发工作流程，包含质量门控、MCP 服务和多模型协作。

## 使用方法

```bash
/workflow <task description>
```

## 上下文

* 待开发任务：$ARGUMENTS
* 结构化的 6 阶段工作流程，带有质量关卡
* 多模型协作：Codex（后端） + Gemini（前端） + Claude（编排）
* 集成 MCP 服务（ace-tool，可选）以增强能力

## 你的角色

你是**编排者**，协调一个多模型协作系统（研究 → 构思 → 规划 → 执行 → 优化 → 审查）。为有经验的开发者进行简洁、专业的沟通。

**协作模型**：

* **ace-tool MCP**（可选） – 代码检索 + 提示增强
* **Codex** – 后端逻辑、算法、调试（**后端权威，值得信赖**）
* **Gemini** – 前端 UI/UX、视觉设计（**前端专家，后端意见仅供参考**）
* **Claude（自身）** – 编排、规划、执行、交付

***

## 多模型调用规范

**调用语法**（并行：`run_in_background: true`，串行：`false`）：

```
# 新会话调用
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> {{GEMINI_MODEL_FLAG}}- \"$PWD\" <<'EOF'
ROLE_FILE: <角色提示文件路径>
<TASK>
需求: <增强后的需求（如未增强则为$ARGUMENTS）>
上下文: <来自先前阶段的项目上下文和分析>
</TASK>
OUTPUT: 期望的输出格式
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "简要描述"
})

# 恢复会话调用
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> {{GEMINI_MODEL_FLAG}}resume <SESSION_ID> - \"$PWD\" <<'EOF'
ROLE_FILE: <角色提示文件路径>
<TASK>
需求: <增强后的需求（如未增强则为$ARGUMENTS）>
上下文: <来自先前阶段的项目上下文和分析>
</TASK>
OUTPUT: 期望的输出格式
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "简要描述"
})
```

**模型参数说明**：

* `{{GEMINI_MODEL_FLAG}}`: 当使用 `--backend gemini` 时，替换为 `--gemini-model gemini-3-pro-preview`（注意末尾空格）；对于 codex 使用空字符串

**角色提示词**：

| 阶段 | Codex | Gemini |
|-------|-------|--------|
| 分析 | `~/.claude/.ccg/prompts/codex/analyzer.md` | `~/.claude/.ccg/prompts/gemini/analyzer.md` |
| 规划 | `~/.claude/.ccg/prompts/codex/architect.md` | `~/.claude/.ccg/prompts/gemini/architect.md` |
| 审查 | `~/.claude/.ccg/prompts/codex/reviewer.md` | `~/.claude/.ccg/prompts/gemini/reviewer.md` |

**会话复用**：每次调用返回 `SESSION_ID: xxx`，在后续阶段使用 `resume xxx` 子命令（注意：`resume`，而非 `--resume`）。

**并行调用**：使用 `run_in_background: true` 启动，使用 `TaskOutput` 等待结果。**必须等待所有模型返回后才能进入下一阶段**。

**等待后台任务**（使用最大超时 600000ms = 10 分钟）：

```
TaskOutput({ task_id: "<task_id>", block: true, timeout: 600000 })
```

**重要**：

* 必须指定 `timeout: 600000`，否则默认 30 秒会导致过早超时。
* 如果 10 分钟后仍未完成，继续使用 `TaskOutput` 轮询，**切勿终止进程**。
* 如果因超时而跳过等待，**必须调用 `AskUserQuestion` 询问用户是继续等待还是终止任务。切勿直接终止。**

***

## 沟通指南

1. 回复以模式标签 `[Mode: X]` 开头，初始为 `[Mode: Research]`。
2. 遵循严格顺序：`Research → Ideation → Plan → Execute → Optimize → Review`。
3. 每个阶段完成后请求用户确认。
4. 当评分 < 7 或用户不批准时强制停止。
5. 需要时（例如确认/选择/批准）使用 `AskUserQuestion` 工具进行用户交互。

## 何时使用外部编排

当工作必须拆分给需要隔离的 git 状态、独立终端或独立构建/测试执行的并行工作器时，请使用外部 tmux/工作树编排。对于轻量级分析、规划或审查（其中主会话是唯一的写入者），请使用进程内子代理。

```bash
node scripts/orchestrate-worktrees.js .claude/plan/workflow-e2e-test.json --execute
```

***

## 执行工作流程

**任务描述**：$ARGUMENTS

### 阶段 1：研究与分析

`[Mode: Research]` - 理解需求并收集上下文：

1. **提示增强**（如果 ace-tool MCP 可用）：调用 `mcp__ace-tool__enhance_prompt`，**用增强后的结果替换原始的 $ARGUMENTS，用于所有后续的 Codex/Gemini 调用**。如果不可用，直接使用 `$ARGUMENTS`。
2. **上下文检索**（如果 ace-tool MCP 可用）：调用 `mcp__ace-tool__search_context`。如果不可用，使用内置工具：`Glob` 用于文件发现，`Grep` 用于符号搜索，`Read` 用于上下文收集，`Task`（探索代理）用于更深入的探索。
3. **需求完整性评分**（0-10）：
   * 目标清晰度（0-3）、预期结果（0-3）、范围边界（0-2）、约束条件（0-2）
   * ≥7：继续 | <7：停止，询问澄清性问题

### 阶段 2：解决方案构思

`[Mode: Ideation]` - 多模型并行分析：

**并行调用** (`run_in_background: true`)：

* Codex：使用分析器提示词，输出技术可行性、解决方案、风险
* Gemini：使用分析器提示词，输出 UI 可行性、解决方案、UX 评估

使用 `TaskOutput` 等待结果。**保存 SESSION\_ID** (`CODEX_SESSION` 和 `GEMINI_SESSION`)。

**遵循上方 `Multi-Model Call Specification` 中的 `IMPORTANT` 说明**

综合两项分析，输出解决方案比较（至少 2 个选项），等待用户选择。

### 阶段 3：详细规划

`[Mode: Plan]` - 多模型协作规划：

**并行调用**（使用 `resume <SESSION_ID>` 恢复会话）：

* Codex：使用架构师提示词 + `resume $CODEX_SESSION`，输出后端架构
* Gemini：使用架构师提示词 + `resume $GEMINI_SESSION`，输出前端架构

使用 `TaskOutput` 等待结果。

**遵循上方 `Multi-Model Call Specification` 中的 `IMPORTANT` 说明**

**Claude 综合**：采纳 Codex 后端计划 + Gemini 前端计划，在用户批准后保存到 `.claude/plan/task-name.md`。

### 阶段 4：实施

`[Mode: Execute]` - 代码开发：

* 严格遵循批准的计划
* 遵循现有项目代码标准
* 在关键里程碑请求反馈

### 阶段 5：代码优化

`[Mode: Optimize]` - 多模型并行审查：

**并行调用**：

* Codex：使用审查者提示词，关注安全性、性能、错误处理
* Gemini：使用审查者提示词，关注可访问性、设计一致性

使用 `TaskOutput` 等待结果。整合审查反馈，在用户确认后执行优化。

**遵循上方 `Multi-Model Call Specification` 中的 `IMPORTANT` 说明**

### 阶段 6：质量审查

`[Mode: Review]` - 最终评估：

* 对照计划检查完成情况
* 运行测试以验证功能
* 报告问题和建议
* 请求最终用户确认

***

## 关键规则

1. 阶段顺序不可跳过（除非用户明确指示）
2. 外部模型**对文件系统零写入权限**，所有修改由 Claude 执行
3. 当评分 < 7 或用户不批准时**强制停止**
