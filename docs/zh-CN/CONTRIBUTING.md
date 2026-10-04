# 为 ECC 做贡献

感谢您想要贡献！这个仓库是 Claude Code 用户的社区资源。

## 目录

* [我们寻找的内容](#我们寻找什么)
* [快速开始](#快速开始)
* [贡献技能](#贡献技能)
* [贡献智能体](#贡献智能体)
* [贡献钩子](#贡献钩子)
* [贡献命令](#贡献命令)
* [MCP 和文档（例如 Context7）](#mcp-和文档例如-context7)
* [跨工具链和翻译](#跨平台与翻译)
* [拉取请求流程](#拉取请求流程)

***

## 我们寻找什么

### 智能体

能够很好地处理特定任务的新智能体：

* 语言特定的审查员（Python、Go、Rust）
* 框架专家（Django、Rails、Laravel、Spring）
* DevOps 专家（Kubernetes、Terraform、CI/CD）
* 领域专家（ML 流水线、数据工程、移动端）

### 技能

工作流定义和领域知识：

* 语言最佳实践
* 框架模式
* 测试策略
* 架构指南

### 钩子

有用的自动化：

* 代码检查/格式化钩子
* 安全检查
* 验证钩子
* 通知钩子

### 命令

调用有用工作流的斜杠命令：

* 部署命令
* 测试命令
* 代码生成命令

***

## 快速开始

```bash
# 1. Fork and clone
gh repo fork affaan-m/ECC --clone
cd ECC

# 2. Create a branch
git checkout -b feat/my-contribution

# 3. Add your contribution (see sections below)

# 4. Test locally
cp -r skills/my-skill ~/.claude/skills/  # for skills
# Then test with Claude Code

# 5. Submit PR
git add . && git commit -m "feat: add my-skill" && git push -u origin feat/my-contribution
```

***

## 贡献技能

技能是 Claude Code 根据上下文加载的知识模块。

### 目录结构

```
skills/
└── your-skill-name/
    └── SKILL.md
```

### SKILL.md 模板

````markdown
---
name: your-skill-name
description: Brief description shown in skill list
origin: ECC
---

# 你的技能标题

简要概述此技能涵盖的内容。

## 核心概念

解释关键模式和指导原则。

## 代码示例

```typescript
// 包含实用、经过测试的示例
function example() {
  // 注释良好的代码
}
````

### 技能清单

* \[ ] 专注于一个领域/技术
* \[ ] 包含实用的代码示例
* \[ ] 少于 500 行
* \[ ] 使用清晰的章节标题
* \[ ] 已通过 Claude Code 测试

### 技能示例

| 技能 | 目的 |
|-------|---------|
| `coding-standards/` | TypeScript/JavaScript 模式 |
| `frontend-patterns/` | React 和 Next.js 最佳实践 |
| `backend-patterns/` | API 和数据库模式 |
| `security-review/` | 安全检查清单 |

***

## 贡献智能体

智能体是通过任务工具调用的专业助手。

### 文件位置

```
agents/your-agent-name.md
```

### 智能体模板

```markdown
---
name: 你的代理名称
description: 该代理的作用以及 Claude 应在何时调用它。请具体说明！
tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"]
model: sonnet
---

你是一名 [角色] 专家。

## 你的角色

- 主要职责
- 次要职责
- 你不做的事情（界限）

## 工作流程

### 步骤 1：理解
你如何着手处理任务。

### 步骤 2：执行
你如何开展工作。

### 步骤 3：验证
你如何验证结果。

## 输出格式

你返回给用户的内容。

## 示例

### 示例：[场景]
输入：[用户提供的内容]
操作：[你做了什么]
输出：[你返回的内容]

```

### 智能体字段

| 字段 | 描述 | 选项 |
|-------|-------------|---------|
| `name` | 小写，连字符连接 | `code-reviewer` |
| `description` | 用于决定何时调用 | 请具体说明！ |
| `tools` | 仅包含必需内容 | `Read, Write, Edit, Bash, Grep, Glob, WebFetch, Task`，或当智能体使用 MCP 时的 MCP 工具名称（例如 `mcp__context7__resolve-library-id`, `mcp__context7__query-docs`） |
| `model` | 复杂度级别 | `haiku`（简单），`sonnet`（编码），`opus`（复杂） |

### 智能体示例

| 智能体 | 目的 |
|-------|---------|
| `tdd-guide.md` | 测试驱动开发 |
| `code-reviewer.md` | 代码审查 |
| `security-reviewer.md` | 安全扫描 |
| `build-error-resolver.md` | 修复构建错误 |

***

## 贡献钩子

钩子是由 Claude Code 事件触发的自动行为。

### 文件位置

```
hooks/hooks.json
```

### 钩子类型

| 类型 | 触发条件 | 用例 |
|------|---------|----------|
| `PreToolUse` | 工具运行前 | 验证、警告、阻止 |
| `PostToolUse` | 工具运行后 | 格式化、检查、通知 |
| `SessionStart` | 会话开始时 | 加载上下文 |
| `Stop` | 会话结束时 | 清理、审计 |

### 钩子格式

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "tool == \"Bash\" && tool_input.command matches \"rm -rf /\"",
        "hooks": [
          {
            "type": "command",
            "command": "echo '[Hook] BLOCKED: Dangerous command' && exit 1"
          }
        ],
        "description": "Block dangerous rm commands"
      }
    ]
  }
}
```

### 匹配器语法

```javascript
// Match specific tools
tool == "Bash"
tool == "Edit"
tool == "Write"

// Match input patterns
tool_input.command matches "npm install"
tool_input.file_path matches "\\.tsx?$"

// Combine conditions
tool == "Bash" && tool_input.command matches "git push"
```

### 钩子示例

```json
// Block dev servers outside tmux
{
  "matcher": "tool == \"Bash\" && tool_input.command matches \"npm run dev\"",
  "hooks": [{"type": "command", "command": "echo 'Use tmux for dev servers' && exit 1"}],
  "description": "Ensure dev servers run in tmux"
}

// Auto-format after editing TypeScript
{
  "matcher": "tool == \"Edit\" && tool_input.file_path matches \"\\.tsx?$\"",
  "hooks": [{"type": "command", "command": "npx prettier --write \"$file_path\""}],
  "description": "Format TypeScript files after edit"
}

// Warn before git push
{
  "matcher": "tool == \"Bash\" && tool_input.command matches \"git push\"",
  "hooks": [{"type": "command", "command": "echo '[Hook] Review changes before pushing'"}],
  "description": "Reminder to review before push"
}
```

### 钩子清单

* \[ ] 匹配器具体（不过于宽泛）
* \[ ] 包含清晰的错误/信息消息
* \[ ] 使用正确的退出代码 (`exit 1` 阻止, `exit 0` 允许)
* \[ ] 经过充分测试
* \[ ] 有描述

***

## 贡献命令

命令是用户通过 `/command-name` 调用的操作。

### 文件位置

```
commands/your-command.md
```

### 命令模板

```markdown
---
description: 在 /help 中显示的简要描述
---

# 命令名称

## 目的

此命令的功能。

## 用法

```

/your-command [args]
```


## 工作流程

1. 第一步
2. 第二步
3. 最后一步

## 输出

用户将收到的内容。

```

### 命令示例

| 命令 | 目的 |
|---------|---------|
| `commit.md` | 创建 git 提交 |
| `code-review.md` | 审查代码变更 |
| `tdd.md` | TDD 工作流 |
| `e2e.md` | E2E 测试 |

***

## MCP 和文档（例如 Context7）

技能和智能体可以使用 **MCP（模型上下文协议）** 工具来获取最新数据，而不仅仅是依赖训练数据。这对于文档尤其有用。

* **Context7** 是一个暴露 `resolve-library-id` 和 `query-docs` 的 MCP 服务器。当用户询问库、框架或 API 时，请使用它，以便答案能反映最新的文档和代码示例。
* 在贡献依赖于实时文档的**技能**时（例如设置、API 使用），请描述如何使用相关的 MCP 工具（例如，解析库 ID，然后查询文档），并指向 `documentation-lookup` 技能或 Context7 作为参考模式。
* 在贡献能回答文档/API 问题的**智能体**时，请在智能体的工具中包含 Context7 MCP 工具名称（例如 `mcp__context7__resolve-library-id`, `mcp__context7__query-docs`），并记录解析 → 查询的工作流程。
* **mcp-configs/mcp-servers.json** 包含一个 Context7 条目；用户在其工具链（例如 Claude Code, Cursor）中启用它，以使用文档查找技能（位于 `skills/documentation-lookup/`）和 `/docs` 命令。

***

## 跨平台与翻译

### 技能子集 (Codex 和 Cursor)

ECC 为其他平台提供了技能子集：

* **Codex:** `.agents/skills/` — `agents/openai.yaml` 中列出的技能会被 Codex 加载。
* **Cursor:** `.cursor/skills/` — 为 Cursor 打包了一个技能子集。

当您**添加一个新技能**，并且希望它在 Codex 或 Cursor 上可用时：

1. 像往常一样，在 `skills/your-skill-name/` 下添加该技能。
2. 如果它应该在 **Codex** 上可用，请将其添加到 `.agents/skills/`（复制技能目录或添加引用），并在需要时确保它在 `agents/openai.yaml` 中被引用。
3. 如果它应该在 **Cursor** 上可用，请根据 Cursor 的布局，将其添加到 `.cursor/skills/` 下。

请参考这些目录中现有技能的结构。保持这些子集同步是手动操作；如果您更新了它们，请在您的 PR 中说明。

### 翻译

翻译文件位于 `docs/` 下（例如 `docs/zh-CN`、`docs/zh-TW`、`docs/ja-JP`）。如果您更改了已被翻译的智能体、命令或技能，请考虑更新相应的翻译文件，或创建一个问题，以便维护者或翻译人员可以更新它们。

***

## 拉取请求流程

### 1. PR 标题格式

```
feat(skills): 新增 Rust 模式技能
feat(agents): 新增 API 设计器代理
feat(hooks): 新增自动格式化钩子
fix(skills): 更新 React 模式
docs: 完善贡献指南
```

### 2. PR 描述

```markdown
## 摘要
你正在添加什么以及为什么添加。

## 类型
- [ ] 技能
- [ ] 代理
- [ ] 钩子
- [ ] 命令

## 测试
你是如何测试这个的。

## 检查清单
- [ ] 遵循格式指南
- [ ] 已使用 Claude Code 进行测试
- [ ] 无敏感信息（API 密钥、路径）
- [ ] 描述清晰

```

### 3. 审查流程

1. 维护者在 48 小时内审查
2. 如有要求，请处理反馈
3. 一旦批准，合并到主分支

***

## 指导原则

### 应该做的

* 保持贡献内容专注和模块化
* 包含清晰的描述
* 提交前进行测试
* 遵循现有模式
* 记录依赖项

### 不应该做的

* 包含敏感数据（API 密钥、令牌、路径）
* 添加过于复杂或小众的配置
* 提交未经测试的贡献
* 创建现有功能的重复项

***

## 文件命名

* 使用小写和连字符：`python-reviewer.md`
* 描述性要强：`tdd-workflow.md` 而不是 `workflow.md`
* 名称与文件名匹配

***

## 有问题吗？

* **问题：** [github.com/affaan-m/ECC/issues](https://github.com/affaan-m/ECC/issues)
* **X/Twitter：** [@affaanmustafa](https://x.com/affaanmustafa)

***

感谢您的贡献！让我们共同构建一个出色的资源。
