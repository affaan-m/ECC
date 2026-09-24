# 前端 - 前端聚焦开发

前端聚焦的工作流（研究 → 构思 → 规划 → 执行 → 优化 → 评审），由 Gemini 主导。

> **前提条件：** 此命令需要外部的 `ccg-workflow` 运行时，它**不**包含在基础 ECC 安装中。请运行 `npx ccg-workflow` 进行初始化，以配置此命令所依赖的 `~/.claude/bin/codeagent-wrapper` 和 `~/.claude/.ccg/prompts/*` 角色文件。没有该运行时，此命令将无法正常运行。

## 使用方法

```bash
/frontend <UI task description>
```

## 上下文

* 前端任务: $ARGUMENTS
* Gemini 主导，Codex 作为辅助参考
* 适用场景: 组件设计、响应式布局、UI 动画、样式优化

## 您的角色

您是 **前端协调器**，为 UI/UX 任务协调多模型协作（研究 → 构思 → 规划 → 执行 → 优化 → 评审）。

**协作模型**:

* **Gemini** – 前端 UI/UX（**前端权威，可信赖**）
* **Codex** – 后端视角（**前端意见仅供参考**）
* **Claude（自身）** – 协调、规划、执行、交付

***

## 多模型调用规范

**调用语法**:

```
# 新会话调用
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend gemini --gemini-model gemini-3-pro-preview - \"$PWD\" <<'EOF'
ROLE_FILE: <角色提示文件路径>
<TASK>
需求: <增强后的需求（若未增强则为$ARGUMENTS）>
上下文: <来自先前阶段的项目上下文与分析>
</TASK>
OUTPUT: 期望的输出格式
EOF",
  run_in_background: false,
  timeout: 3600000,
  description: "简要描述"
})

# 恢复会话调用
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend gemini --gemini-model gemini-3-pro-preview resume <SESSION_ID> - \"$PWD\" <<'EOF'
ROLE_FILE: <角色提示文件路径>
<TASK>
需求: <增强后的需求（若未增强则为$ARGUMENTS）>
上下文: <来自先前阶段的项目上下文与分析>
</TASK>
OUTPUT: 期望的输出格式
EOF",
  run_in_background: false,
  timeout: 3600000,
  description: "简要描述"
})
```

**角色提示词**:

| 阶段 | Gemini |
|-------|--------|
| 分析 | `~/.claude/.ccg/prompts/gemini/analyzer.md` |
| 规划 | `~/.claude/.ccg/prompts/gemini/architect.md` |
| 评审 | `~/.claude/.ccg/prompts/gemini/reviewer.md` |

**会话重用**: 每次调用返回 `SESSION_ID: xxx`，在后续阶段使用 `resume xxx`。在阶段 2 保存 `GEMINI_SESSION`，在阶段 3 和 5 使用 `resume`。

***

## 沟通指南

1. 以模式标签 `[Mode: X]` 开始响应，初始为 `[Mode: Research]`
2. 遵循严格顺序: `Research → Ideation → Plan → Execute → Optimize → Review`
3. 需要时（例如确认/选择/批准）使用 `AskUserQuestion` 工具进行用户交互

***

## 核心工作流

### 阶段 0: 提示词增强（可选）

`[Mode: Prepare]` - 如果 ace-tool MCP 可用，调用 `mcp__ace-tool__enhance_prompt`，**用增强后的结果替换原始的 $ARGUMENTS，供后续 Gemini 调用使用**。如果不可用，则按原样使用 `$ARGUMENTS`。

### 阶段 1: 研究

`[Mode: Research]` - 理解需求并收集上下文

1. **代码检索**（如果 ace-tool MCP 可用）：调用 `mcp__ace-tool__search_context` 来检索现有的组件、样式、设计系统。如果不可用，使用内置工具：`Glob` 用于文件发现，`Grep` 用于组件/样式搜索，`Read` 用于上下文收集，`Task`（探索代理）用于更深层次的探索。
2. 需求完整性评分（0-10分）：>=7 继续，<7 停止并补充

### 阶段 2: 构思

`[Mode: Ideation]` - Gemini 主导的分析

**必须调用 Gemini**（遵循上述调用规范）:

* ROLE\_FILE: `~/.claude/.ccg/prompts/gemini/analyzer.md`
* 需求: 增强后的需求（或未经增强的 $ARGUMENTS）
* 上下文: 来自阶段 1 的项目上下文
* 输出: UI 可行性分析、推荐解决方案（至少 2 个）、UX 评估

**保存 SESSION\_ID**（`GEMINI_SESSION`）以供后续阶段重用。

输出解决方案（至少 2 个），等待用户选择。

### 阶段 3: 规划

`[Mode: Plan]` - Gemini 主导的规划

**必须调用 Gemini**（使用 `resume <GEMINI_SESSION>` 来重用会话）:

* ROLE\_FILE: `~/.claude/.ccg/prompts/gemini/architect.md`
* 需求: 用户选择的解决方案
* 上下文: 阶段 2 的分析结果
* 输出: 组件结构、UI 流程、样式方案

Claude 综合规划，在用户批准后保存到 `.claude/plan/task-name.md`。

### 阶段 4: 实现

`[Mode: Execute]` - 代码开发

* 严格遵循批准的规划
* 遵循现有项目设计系统和代码标准
* 确保响应式设计、可访问性

### 阶段 5: 优化

`[Mode: Optimize]` - Gemini 主导的评审

**必须调用 Gemini**（遵循上述调用规范）:

* ROLE\_FILE: `~/.claude/.ccg/prompts/gemini/reviewer.md`
* 需求: 评审以下前端代码变更
* 上下文: git diff 或代码内容
* 输出: 可访问性、响应式设计、性能、设计一致性等问题列表

整合评审反馈，在用户确认后执行优化。

### 阶段 6: 质量评审

`[Mode: Review]` - 最终评估

* 对照规划检查完成情况
* 验证响应式设计和可访问性
* 报告问题与建议

***

## 关键规则

1. **Gemini 的前端意见是可信赖的**
2. **Codex 的前端意见仅供参考**
3. 外部模型**没有文件系统写入权限**
4. Claude 处理所有代码写入和文件操作
