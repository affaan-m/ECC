# Everything Claude Code 速成指南

![头图：Anthropic 黑客马拉松获奖者 - Claude Code 技巧与窍门](./assets/images/shortform/00-header.png)

---

**自 2 月实验性推出以来，我一直是 Claude Code 的狂热用户，并与 [@DRodriguezFX](https://x.com/DRodriguezFX) 一起使用 Claude Code 完全构建了 [zenith.chat](https://zenith.chat)，赢得了 Anthropic x Forum Ventures 黑客马拉松。**

以下是我在 10 个月日常使用后的完整设置：技能、钩子、子代理、MCP、插件，以及真正有效的东西。

---

## 技能和命令

技能是主要的工作流表面。它们的作用域工作流包：可重用的提示、结构、支持文件，以及当你需要特定执行模式时的代码图。

在使用 Opus 4.5 进行长时间编码后，你想清理死代码和散落的 .md 文件？运行 `/refactor-clean`。需要测试？`/tdd`、`/e2e`、`/test-coverage`。这些斜杠命令很方便，但真正持久的单元是底层技能。技能还可以包括代码图——一种让 Claude 快速导航你的代码库而不在探索上消耗上下文的方法。

![终端显示链式命令](./assets/images/shortform/02-chaining-commands.jpeg)
*将命令链接在一起*

ECC 仍然提供 `commands/` 层，但最好将其视为迁移期间的遗留斜杠命令兼容性。持久逻辑应该存在于技能中。

- **技能**：`~/.claude/skills/` - 规范的工作流定义
- **命令**：`~/.claude/commands/` - 当你仍然需要它们时的遗留斜杠命令垫片

```bash
# 示例技能结构
~/.claude/skills/
  pmx-guidelines.md      # 项目特定模式
  coding-standards.md    # 语言最佳实践
  tdd-workflow/          # 带有 SKILL.md 的多文件技能
  security-review/       # 基于清单的技能
```

---

## 钩子

钩子是基于触发的自动化，在特定事件上触发。与技能不同，它们局限于工具调用和生命周期事件。

**钩子类型：**

1. **PreToolUse** - 工具执行前（验证、提醒）
2. **PostToolUse** - 工具完成后（格式化、反馈循环）
3. **UserPromptSubmit** - 当你发送消息时
4. **Stop** - 当 Claude 完成响应时
5. **PreCompact** - 上下文压缩前
6. **Notification** - 权限请求

**示例：长时间运行命令前的 tmux 提醒**

```json
{
  "PreToolUse": [
    {
      "matcher": "tool == \"Bash\" && tool_input.command matches \"(npm|pnpm|yarn|cargo|pytest)\"",
      "hooks": [
        {
          "type": "command",
          "command": "if [ -z \"$TMUX\" ]; then echo '[Hook] Consider tmux for session persistence' >&2; fi"
        }
      ]
    }
  ]
}
```

![PostToolUse 钩子反馈](./assets/images/shortform/03-posttooluse-hook.png)
*运行 PostToolUse 钩子时你在 Claude Code 中获得的反馈示例*

**专业提示：** 使用 `hookify` 插件通过对话方式创建钩子，而不是手动编写 JSON。运行 `/hookify` 并描述你想要什么。

---

## 子代理

子代理是你的编排器（主 Claude）可以将任务委派给具有有限范围的进程。它们可以在后台或前台运行，为主代理释放上下文。

子代理与技能配合得很好——能够执行你技能子集的子代理可以被委派任务并自主使用这些技能。它们还可以使用特定工具权限进行沙箱化。

```bash
# 示例子代理结构
~/.claude/agents/
  planner.md           # 功能实现规划
  architect.md         # 系统设计决策
  tdd-guide.md         # 测试驱动开发
  code-reviewer.md     # 质量/安全审查
  security-reviewer.md # 漏洞分析
  build-error-resolver.md
  e2e-runner.md
  refactor-cleaner.md
```

为每个子代理配置允许的工具、MCP 和权限，以实现适当的范围界定。

---

## 规则和记忆

你的 `.rules` 文件夹包含 Claude 应该始终遵循的最佳实践的 `.md` 文件。两种方法：

1. **单个 CLAUDE.md** - 所有内容都在一个文件中（用户或项目级别）
2. **规则文件夹** - 按关注点分组的模块化 `.md` 文件

```bash
~/.claude/rules/
  security.md      # 无硬编码秘密，验证输入
  coding-style.md  # 不可变性，文件组织
  testing.md       # TDD 工作流，80% 覆盖率
  git-workflow.md  # 提交格式，PR 流程
  agents.md        # 何时委派给子代理
  performance.md   # 模型选择，上下文管理
```

**规则示例：**

- 代码库中不使用表情符号
- 前端避免使用紫色色调
- 部署前始终测试代码
- 优先选择模块化代码而非巨型文件
- 永远不要提交 console.log

---

## MCP（模型上下文协议）

MCP 将 Claude 直接连接到外部服务。不是 API 的替代品——它是围绕它们的提示驱动包装器，允许在导航信息时具有更大的灵活性。

**示例：** Supabase MCP 让 Claude 提取特定数据，直接在上游运行 SQL，无需复制粘贴。数据库、部署平台等也是如此。

![Supabase MCP 列出表](./assets/images/shortform/04-supabase-mcp.jpeg)
*Supabase MCP 列出 public 模式中的表示例*

**Claude 中的 Chrome：** 是一个内置插件 MCP，让 Claude 自主控制你的浏览器——点击周围查看事物如何工作。

**关键：上下文窗口管理**

对 MCP 要挑剔。我将所有 MCP 保留在用户配置中，但**禁用所有未使用的**。导航到 `/plugins` 并向下滚动或运行 `/mcp`。

![/plugins 界面](./assets/images/shortform/05-plugins-interface.jpeg)
*使用 /plugins 导航到 MCP 以查看当前安装了哪些及其状态*

你的 200k 上下文窗口在压缩前可能只有 70k，如果启用了太多工具。性能会显著下降。

**经验法则：** 在配置中拥有 20-30 个 MCP，但保持少于 10 个启用/少于 80 个工具活动。

```bash
# 检查启用的 MCP
/mcp

# 在 ~/.claude/settings.json 或当前仓库的 .mcp.json 中禁用未使用的
```

---

## 插件

插件打包工具以便于安装，而不是繁琐的手动设置。插件可以是技能 + MCP 组合，或钩子/工具捆绑在一起。

**安装插件：**

```bash
# 添加市场
# mgrep 插件，作者 @mixedbread-ai
claude plugin marketplace add https://github.com/mixedbread-ai/mgrep

# 打开 Claude，运行 /plugins，找到新市场，从那里安装
```

![显示 mgrep 的市场选项卡](./assets/images/shortform/06-marketplaces-mgrep.jpeg)
*显示新安装的 Mixedbread-Grep 市场*

**LSP 插件** 如果你经常在编辑器外运行 Claude Code，则特别有用。语言服务器协议为 Claude 提供实时类型检查、跳转到定义和智能补全，而无需打开 IDE。

```bash
# 启用的插件示例
typescript-lsp@claude-plugins-official  # TypeScript 智能
pyright-lsp@claude-plugins-official     # Python 类型检查
hookify@claude-plugins-official         # 通过对话创建钩子
mgrep@Mixedbread-Grep                   # 比 ripgrep 更好的搜索
```

与 MCP 相同的警告——注意你的上下文窗口。

---

## 技巧与窍门

### 键盘快捷键

- `Ctrl+U` - 删除整行（比连续退格更快）
- `!` - 快速 bash 命令前缀
- `@` - 搜索文件
- `/` - 启动斜杠命令
- `Shift+Enter` - 多行输入
- `Tab` - 切换思考显示
- `Esc Esc` - 中断 Claude / 恢复代码

### 并行工作流

- **分叉**（`/fork`）- 分叉对话以并行执行不重叠的任务，而不是发送排队的消息
- **Git 工作树** - 用于没有冲突的重叠并行 Claude。每个工作树都是独立的检出

```bash
git worktree add ../feature-branch feature-branch
# 现在在每个工作树中运行单独的 Claude 实例
```

### 用于长时间运行命令的 tmux

流式传输和观察 Claude 运行的日志/bash 进程：

[观看：tmux 会话流式传输长时间运行命令（视频）](./assets/images/shortform/07-tmux-video.mp4)

```bash
tmux new -s dev
# Claude 在这里运行命令，你可以分离和重新附加
tmux attach -t dev
```

### mgrep > grep

`mgrep` 是 ripgrep/grep 的重大改进。通过插件市场安装，然后使用 `/mgrep` 技能。适用于本地搜索和网络搜索。

```bash
mgrep "function handleSubmit"  # 本地搜索
mgrep --web "Next.js 15 app router changes"  # 网络搜索
```

### 其他有用命令

- `/rewind` - 返回到先前状态
- `/statusline` - 自定义分支、上下文 %、待办事项
- `/checkpoints` - 文件级撤销点
- `/compact` - 手动触发上下文压缩

### GitHub Actions CI/CD

使用 GitHub Actions 在你的 PR 上设置代码审查。配置后，Claude 可以自动审查 PR。

![Claude 机器人批准 PR](./assets/images/shortform/08-github-pr-review.jpeg)
*Claude 批准错误修复 PR*

### 沙箱化

对风险操作使用沙箱模式——Claude 在受限环境中运行，不会影响你的实际系统。

---

## 关于编辑器

你的编辑器选择显著影响 Claude Code 工作流。虽然 Claude Code 可以从任何终端工作，但将其与功能强大的编辑器配对可以解锁实时文件跟踪、快速导航和集成命令执行。

### Zed（我的偏好）

我使用 [Zed](https://zed.dev) - 用 Rust 编写，所以它真的很快。瞬间打开，处理大型代码库毫不费力，几乎不占用系统资源。

**为什么 Zed + Claude Code 是一个很好的组合：**

- **速度** - 基于 Rust 的性能意味着当 Claude 快速编辑文件时没有延迟。你的编辑器跟得上
- **代理面板集成** - Zed 的 Claude 集成让你实时跟踪 Claude 编辑时的文件更改。在编辑器中跳转 Claude 引用的文件，而无需离开
- **CMD+Shift+R 命令面板** - 快速访问所有自定义斜杠命令、调试器、构建脚本，在可搜索的 UI 中
- **最小资源使用** - 在重操作期间不会与 Claude 竞争 RAM/CPU。运行 Opus 时很重要
- **Vim 模式** - 如果你喜欢，完整的 vim 键绑定

![带有自定义命令的 Zed 编辑器](./assets/images/shortform/09-zed-editor.jpeg)
*使用 CMD+Shift+R 的 Zed 编辑器自定义命令下拉菜单。右下角显示跟随模式作为靶心。*

**编辑器无关提示：**

1. **分屏** - 一侧是带有 Claude Code 的终端，另一侧是编辑器
2. **Ctrl + G** - 在 Zed 中快速打开 Claude 当前正在处理的文件
3. **自动保存** - 启用自动保存，以便 Claude 的文件读取始终是最新的
4. **Git 集成** - 使用编辑器的 git 功能在提交前审查 Claude 的更改
5. **文件观察器** - 大多数编辑器自动重新加载更改的文件，验证这已启用

### VSCode / Cursor

这也是一个可行的选择，与 Claude Code 配合良好。你可以使用终端格式，使用 `\ide` 与编辑器自动同步，启用 LSP 功能（现在与插件有些冗余）。或者你可以选择扩展，它与编辑器更集成，具有匹配的 UI。

![VS Code Claude Code 扩展](./assets/images/shortform/10-vscode-extension.jpeg)
*VS Code 扩展为 Claude Code 提供本地图形界面，直接集成到你的 IDE 中。*

---

## 我的设置

### 插件

**已安装：**（我通常一次只启用 4-5 个）

```markdown
ralph-wiggum@claude-code-plugins       # 循环自动化
frontend-patterns@claude-code-plugins  # UI/UX 模式
commit-commands@claude-code-plugins    # Git 工作流
security-guidance@claude-code-plugins  # 安全检查
pr-review-toolkit@claude-code-plugins  # PR 自动化
typescript-lsp@claude-plugins-official # TS 智能
hookify@claude-plugins-official        # 钩子创建
code-simplifier@claude-plugins-official
feature-dev@claude-code-plugins
explanatory-output-style@claude-code-plugins
code-review@claude-code-plugins
context7@claude-plugins-official       # 实时文档
pyright-lsp@claude-plugins-official    # Python 类型
mgrep@Mixedbread-Grep                  # 更好的搜索
```

### MCP 服务器

**已配置（用户级别）：**

```json
{
  "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] },
  "firecrawl": { "command": "npx", "args": ["-y", "firecrawl-mcp"] },
  "supabase": {
    "command": "npx",
    "args": ["-y", "@supabase/mcp-server-supabase@latest", "--project-ref=YOUR_REF"]
  },
  "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] },
  "sequential-thinking": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
  },
  "vercel": { "type": "http", "url": "https://mcp.vercel.com" },
  "railway": { "command": "npx", "args": ["-y", "@railway/mcp-server"] },
  "cloudflare-docs": { "type": "http", "url": "https://docs.mcp.cloudflare.com/mcp" },
  "cloudflare-workers-bindings": {
    "type": "http",
    "url": "https://bindings.mcp.cloudflare.com/mcp"
  },
  "clickhouse": { "type": "http", "url": "https://mcp.clickhouse.cloud/mcp" },
  "AbletonMCP": { "command": "uvx", "args": ["ableton-mcp"] },
  "magic": { "command": "npx", "args": ["-y", "@magicuidesign/mcp@latest"] }
}
```

这是关键——我配置了 14 个 MCP，但每个项目只启用约 5-6 个。保持上下文窗口健康。

### 关键钩子

```json
{
  "PreToolUse": [
    { "matcher": "npm|pnpm|yarn|cargo|pytest", "hooks": ["tmux reminder"] },
    { "matcher": "Write && .md file", "hooks": ["block unless README/CLAUDE"] },
    { "matcher": "git push", "hooks": ["open editor for review"] }
  ],
  "PostToolUse": [
    { "matcher": "Edit && .ts/.tsx/.js/.jsx", "hooks": ["prettier --write"] },
    { "matcher": "Edit && .ts/.tsx", "hooks": ["tsc --noEmit"] },
    { "matcher": "Edit", "hooks": ["grep console.log warning"] }
  ],
  "Stop": [
    { "matcher": "*", "hooks": ["check modified files for console.log"] }
  ]
}
```

### 自定义状态栏

显示用户、目录、带有脏指示器的 git 分支、剩余上下文 %、模型、时间和待办事项计数：

![自定义状态栏](./assets/images/shortform/11-statusline.jpeg)
*我的 Mac 根目录中的示例状态栏*

```
affoon:~ ctx:65% Opus 4.5 19:52
▌▌ plan mode on (shift+tab to cycle)
```

### 规则结构

```
~/.claude/rules/
  security.md      # 强制安全检查
  coding-style.md  # 不可变性，文件大小限制
  testing.md       # TDD，80% 覆盖率
  git-workflow.md  # 约定式提交
  agents.md        # 子代理委派规则
  patterns.md      # API 响应格式
  performance.md   # 模型选择（Haiku vs Sonnet vs Opus）
  hooks.md         # 钩子文档
```

### 子代理

```
~/.claude/agents/
  planner.md           # 分解功能
  architect.md         # 系统设计
  tdd-guide.md         # 先写测试
  code-reviewer.md     # 质量审查
  security-reviewer.md # 漏洞扫描
  build-error-resolver.md
  e2e-runner.md        # Playwright 测试
  refactor-cleaner.md  # 死代码移除
  doc-updater.md       # 保持文档同步
```

---

## 关键要点

1. **不要过度复杂化** - 将配置视为微调，而不是架构
2. **上下文窗口很宝贵** - 禁用未使用的 MCP 和插件
3. **并行执行** - 分叉对话，使用 git 工作树
4. **自动化重复** - 用于格式化、lint、提醒的钩子
5. **限定子代理范围** - 有限的工具 = 专注的执行

---

## 参考资料

- [插件参考](https://code.claude.com/docs/en/plugins-reference)
- [钩子文档](https://code.claude.com/docs/en/hooks)
- [检查点](https://code.claude.com/docs/en/checkpointing)
- [交互模式](https://code.claude.com/docs/en/interactive-mode)
- [记忆系统](https://code.claude.com/docs/en/memory)
- [子代理](https://code.claude.com/docs/en/sub-agents)
- [MCP 概述](https://code.claude.com/docs/en/mcp-overview)

---

**注意：** 这是细节的子集。有关高级模式，请参阅[长篇指南](./the-longform-guide.zhCN.md)。

---

*在纽约市与 [@DRodriguezFX](https://x.com/DRodriguezFX) 一起使用 Claude Code 构建 [zenith.chat](https://zenith.chat) 赢得了 Anthropic x Forum Ventures 黑客马拉松*
