# 执行 - 多模型协同执行

多模型协同执行 - 从计划获取原型 → Claude 重构并实施 → 多模型审计与交付。

> **前提条件：** 此命令需要外部的 `ccg-workflow` 运行时，它**不**包含在基础 ECC 安装中。请运行 `npx ccg-workflow` 进行初始化，以配置此命令所依赖的 `~/.claude/bin/codeagent-wrapper` 和 `~/.claude/.ccg/prompts/*` 角色文件。没有该运行时，此命令将无法正常运行。

$ARGUMENTS

***

## 核心协议

* **语言协议**：与工具/模型交互时使用**英语**，与用户沟通时使用用户的语言
* **代码主权**：外部模型**零文件系统写入权限**，所有修改由 Claude 执行
* **脏原型重构**：将 Codex/Gemini 统一差异视为“脏原型”，必须重构为生产级代码
* **止损机制**：当前阶段输出未经验证前，不得进入下一阶段
* **前提条件**：仅在用户明确回复“Y”到 `/ccg:plan` 输出后执行（如果缺失，必须先确认）

***

## 多模型调用规范

**调用语法**（并行：使用 `run_in_background: true`）：

```
# 恢复会话调用（推荐）- 实现原型
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> {{GEMINI_MODEL_FLAG}}resume <SESSION_ID> - \"$PWD\" <<'EOF'
ROLE_FILE: <role prompt path>
<TASK>
Requirement: <task description>
Context: <plan content + target files>
</TASK>
OUTPUT: Unified Diff Patch ONLY. Strictly prohibit any actual modifications.
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "简要描述"
})

# 新建会话调用 - 实现原型
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> {{GEMINI_MODEL_FLAG}}- \"$PWD\" <<'EOF'
ROLE_FILE: <role prompt path>
<TASK>
Requirement: <task description>
Context: <plan content + target files>
</TASK>
OUTPUT: Unified Diff Patch ONLY. Strictly prohibit any actual modifications.
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "简要描述"
})
```

**审计调用语法**（代码审查 / 审计）：

```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> {{GEMINI_MODEL_FLAG}}resume <SESSION_ID> - \"$PWD\" <<'EOF'
ROLE_FILE: <role prompt path>
<TASK>
Scope: 审计最终的代码变更。
Inputs:
- 已应用的补丁 (git diff / final unified diff)
- 涉及的文件 (必要时提供相关摘录)
Constraints:
- 请勿修改任何文件。
- 请勿输出假设有文件系统访问权限的工具命令。
</TASK>
OUTPUT:
1) 一个按优先级排序的问题列表 (严重程度, 文件, 理由)
2) 具体的修复方案；如果需要更改代码，请包含在一个用围栏代码块包裹的 Unified Diff Patch 中。
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "简要描述"
})
```

**模型参数说明**：

* `{{GEMINI_MODEL_FLAG}}`：当使用 `--backend gemini` 时，替换为 `--gemini-model gemini-3-pro-preview`（注意尾随空格）；对于 codex 使用空字符串

**角色提示**：

| 阶段 | Codex | Gemini |
|-------|-------|--------|
| 实施 | `~/.claude/.ccg/prompts/codex/architect.md` | `~/.claude/.ccg/prompts/gemini/frontend.md` |
| 审查 | `~/.claude/.ccg/prompts/codex/reviewer.md` | `~/.claude/.ccg/prompts/gemini/reviewer.md` |

**会话重用**：如果 `/ccg:plan` 提供了 SESSION\_ID，使用 `resume <SESSION_ID>` 来重用上下文。

**等待后台任务**（最大超时 600000ms = 10 分钟）：

```
TaskOutput({ task_id: "<task_id>", block: true, timeout: 600000 })
```

**重要**：

* 必须指定 `timeout: 600000`，否则默认 30 秒会导致过早超时
* 如果 10 分钟后仍未完成，继续使用 `TaskOutput` 轮询，**切勿终止进程**
* 如果因超时而跳过等待，**必须调用 `AskUserQuestion` 询问用户是继续等待还是终止任务**

***

## 执行工作流

**执行任务**：$ARGUMENTS

### 阶段 0：读取计划

`[Mode: Prepare]`

1. **识别输入类型**：
   * 计划文件路径（例如 `.claude/plan/xxx.md`）
   * 直接任务描述

2. **读取计划内容**：
   * 如果提供了计划文件路径，读取并解析
   * 提取：任务类型、实施步骤、关键文件、SESSION\_ID

3. **执行前确认**：
   * 如果输入是“直接任务描述”或计划缺少 `SESSION_ID` / 关键文件：先与用户确认
   * 如果无法确认用户已回复“Y”到计划：在继续前必须再次确认

4. **任务类型路由**：

   | 任务类型 | 检测 | 路由 |
   |-----------|-----------|-------|
   | **前端** | 页面、组件、UI、样式、布局 | Gemini |
   | **后端** | API、接口、数据库、逻辑、算法 | Codex |
   | **全栈** | 包含前端和后端 | Codex ∥ Gemini 并行 |

***

### 阶段 1：快速上下文检索

`[Mode: Retrieval]`

**如果 ace-tool MCP 可用**，使用它进行快速上下文检索：

基于计划中的“关键文件”列表，调用 `mcp__ace-tool__search_context`：

```
mcp__ace-tool__search_context({
  query: "<基于计划内容的语义查询，包括关键文件、模块、函数名>",
  project_root_path: "$PWD"
})
```

**检索策略**：

* 从计划的“关键文件”表中提取目标路径
* 构建语义查询，涵盖：入口文件、依赖模块、相关类型定义
* 如果结果不足，添加 1-2 次递归检索

**如果 ace-tool MCP 不可用**，使用 Claude Code 内置工具作为后备方案：

1. **Glob**：从计划的“关键文件”表中查找目标文件（例如，`Glob("src/components/**/*.tsx")`）
2. **Grep**：在代码库中搜索关键符号、函数名、类型定义
3. **Read**：读取发现的文件以收集完整的上下文
4. **Task (探索代理)**：对于更广泛的探索，使用 `Task` 和 `subagent_type: "Explore"`

**检索后**：

* 组织检索到的代码片段
* 确认实施所需的完整上下文
* 进入阶段 3

***

### 阶段 3：原型获取

`[Mode: Prototype]`

**基于任务类型路由**：

#### 路由 A：前端/UI/样式 → Gemini

**限制**：上下文 < 32k 令牌

1. 调用 Gemini（使用 `~/.claude/.ccg/prompts/gemini/frontend.md`）
2. 输入：计划内容 + 检索到的上下文 + 目标文件
3. 输出：`Unified Diff Patch ONLY. Strictly prohibit any actual modifications.`
4. **Gemini 是前端设计权威，其 CSS/React/Vue 原型是最终的视觉基线**
5. **警告**：忽略 Gemini 的后端逻辑建议
6. 如果计划包含 `GEMINI_SESSION`：优先使用 `resume <GEMINI_SESSION>`

#### 路由 B：后端/逻辑/算法 → Codex

1. 调用 Codex（使用 `~/.claude/.ccg/prompts/codex/architect.md`）
2. 输入：计划内容 + 检索到的上下文 + 目标文件
3. 输出：`Unified Diff Patch ONLY. Strictly prohibit any actual modifications.`
4. **Codex 是后端逻辑权威，利用其逻辑推理和调试能力**
5. 如果计划包含 `CODEX_SESSION`：优先使用 `resume <CODEX_SESSION>`

#### 路由 C：全栈 → 并行调用

1. **并行调用**（`run_in_background: true`）：
   * Gemini：处理前端部分
   * Codex：处理后端部分
2. 使用 `TaskOutput` 等待两个模型的完整结果
3. 每个模型使用计划中相应的 `SESSION_ID` 作为 `resume`（如果缺失则创建新会话）

**遵循上面 `IMPORTANT` 中的 `Multi-Model Call Specification` 指令**

***

### 阶段 4：代码实施

`[Mode: Implement]`

**Claude 作为代码主权执行以下步骤**：

1. **读取差异**：解析 Codex/Gemini 返回的统一差异补丁

2. **心智沙盒**：
   * 模拟将差异应用到目标文件
   * 检查逻辑一致性
   * 识别潜在冲突或副作用

3. **重构与清理**：
   * 将“脏原型”重构为**高度可读、可维护、企业级代码**
   * 移除冗余代码
   * 确保符合项目现有代码标准
   * **除非必要，不要生成注释/文档**，代码应具有自解释性

4. **最小范围**：
   * 更改仅限于需求范围
   * **强制审查**副作用
   * 进行针对性修正

5. **应用更改**：
   * 使用编辑/写入工具执行实际修改
   * **仅修改必要代码**，绝不影响用户的其他现有功能

6. **自验证**（强烈推荐）：
   * 运行项目现有的 lint / 类型检查 / 测试（优先考虑最小相关范围）
   * 如果失败：先修复回归问题，然后进入阶段 5

***

### 阶段 5：审计与交付

`[Mode: Audit]`

#### 5.1 自动审计

**更改生效后，必须立即并行调用** Codex 和 Gemini 进行代码审查：

1. **Codex 审查**（`run_in_background: true`）：
   * ROLE\_FILE：`~/.claude/.ccg/prompts/codex/reviewer.md`
   * 输入：更改的差异 + 目标文件
   * 重点：安全性、性能、错误处理、逻辑正确性

2. **Gemini 审查**（`run_in_background: true`）：
   * ROLE\_FILE：`~/.claude/.ccg/prompts/gemini/reviewer.md`
   * 输入：更改的差异 + 目标文件
   * 重点：可访问性、设计一致性、用户体验

使用 `TaskOutput` 等待两个模型的完整审查结果。优先重用阶段 3 的会话（`resume <SESSION_ID>`）以确保上下文一致性。

#### 5.2 整合与修复

1. 综合 Codex + Gemini 的审查反馈
2. 按信任规则权衡：后端遵循 Codex，前端遵循 Gemini
3. 执行必要的修复
4. 根据需要重复阶段 5.1（直到风险可接受）

#### 5.3 交付确认

审计通过后，向用户报告：

```markdown
## 执行完成

### 变更摘要
| 文件 | 操作 | 描述 |
|------|-----------|-------------|
| path/to/file.ts | 已修改 | 描述 |

### 审计结果
- Codex: <通过/发现 N 个问题>
- Gemini: <通过/发现 N 个问题>

### 建议
1. [ ] <建议的测试步骤>
2. [ ] <建议的验证步骤>

```

***

## 关键规则

1. **代码主权** – 所有文件修改由 Claude 执行，外部模型零写入权限
2. **脏原型重构** – Codex/Gemini 输出视为草稿，必须重构
3. **信任规则** – 后端遵循 Codex，前端遵循 Gemini
4. **最小更改** – 仅修改必要代码，无副作用
5. **强制审计** – 更改后必须执行多模型代码审查

***

## 使用方法

```bash
# Execute plan file
/ccg:execute .claude/plan/feature-name.md

# Execute task directly (for plans already discussed in context)
/ccg:execute implement user authentication based on previous plan
```

***

## 与 /ccg:plan 的关系

1. `/ccg:plan` 生成计划 + SESSION\_ID
2. 用户用“Y”确认
3. `/ccg:execute` 读取计划，重用 SESSION\_ID，执行实施
