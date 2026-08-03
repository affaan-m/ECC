# Everything Claude Code 长篇指南

![头图：Everything Claude Code 长篇指南](./assets/images/longform/01-header.png)

---

> **前置要求**：本指南建立在 [Everything Claude Code 速成指南](./the-shortform-guide.zhCN.md) 的基础上。如果你还没有设置技能、钩子、子代理、MCP 和插件，请先阅读那篇指南。

![速成指南参考](./assets/images/longform/02-shortform-reference.png)
*速成指南 - 请先阅读*

在速成指南中，我介绍了基础设置：技能和命令、钩子、子代理、MCP、插件，以及构成有效 Claude Code 工作流骨干的配置模式。那是设置指南和基础架构。

这篇长篇指南将深入探讨那些将高效会话与低效会话区分开来的技术。如果你还没有阅读速成指南，请返回并先设置好你的配置。以下内容假设你已经配置并运行了技能、代理、钩子和 MCP。

这里的主题包括：Token 经济学、记忆持久化、验证模式、并行化策略，以及构建可重用工作流的复合效应。这些是我在 10 个多月的日常使用中提炼出来的模式，它们决定了你是在第一个小时内就被上下文腐化所困扰，还是能够维持数小时的高效会话。

速成指南和长篇指南中涵盖的所有内容都可以在 GitHub 上找到：`github.com/affaan-m/everything-claude-code`

---

## 技巧与窍门

### 某些 MCP 可以被替换，从而释放你的上下文窗口

对于版本控制（GitHub）、数据库（Supabase）、部署（Vercel、Railway）等 MCP——这些平台中的大多数都已经有了强大的 CLI，MCP 本质上只是在包装它们。MCP 是一个不错的包装器，但它是有代价的。

为了让 CLI 的功能更像 MCP，而不实际使用 MCP（以及随之而来的上下文窗口减少），可以考虑将功能打包到技能和命令中。剥离 MCP 暴露的使事情变得简单的工具，并将它们转化为命令。

例如：与其始终加载 GitHub MCP，不如创建一个 `/gh-pr` 命令，用你喜欢的选项包装 `gh pr create`。与其让 Supabase MCP 占用上下文，不如创建直接使用 Supabase CLI 的技能。

通过延迟加载，上下文窗口问题基本解决了。但 Token 使用和成本并没有以同样的方式解决。CLI + 技能方法仍然是一种 Token 优化方法。

---

## 重要内容

### 上下文和记忆管理

为了在会话之间共享记忆，最好的方法是使用一个技能或命令来总结并检查进度，然后保存到 `.claude` 文件夹中的 `.tmp` 文件，并在会话结束前持续追加。第二天，它可以将其用作上下文并从你离开的地方继续，为每个会话创建一个新文件，这样你就不会将旧的上下文污染到新的工作中。

![会话存储文件树](./assets/images/longform/03-session-storage.png)
*会话存储示例 -> <https://github.com/affaan-m/everything-claude-code/tree/main/examples/sessions>*

Claude 创建一个总结当前状态的文件。审查它，如果需要可以要求编辑，然后重新开始。对于新的对话，只需提供文件路径。当你达到上下文限制并需要继续复杂工作时，这特别有用。这些文件应该包含：
- 哪些方法有效（有可验证的证据）
- 尝试了哪些方法但不起作用
- 哪些方法尚未尝试，还剩下什么要做

**战略性地清除上下文：**

一旦你设置了计划并清除了上下文（现在 Claude Code 中计划模式的默认选项），你可以从计划开始工作。当你积累了大量与执行不再相关的探索上下文时，这很有用。对于战略性压缩，禁用自动压缩。在逻辑间隔手动压缩，或创建一个为你这样做的技能。

**高级：动态系统提示注入**

我学到的一个模式：与其将所有内容都放在每次会话都会加载的 CLAUDE.md（用户范围）或 `.claude/rules/`（项目范围）中，不如使用 CLI 标志动态注入上下文。

```bash
claude --system-prompt "$(cat memory.md)"
```

这让你可以更精确地控制何时加载什么上下文。系统提示内容比用户消息具有更高的权威性，而用户消息又比工具结果具有更高的权威性。

**实用设置：**

```bash
# 日常开发
alias claude-dev='claude --system-prompt "$(cat ~/.claude/contexts/dev.md)"'

# PR 审查模式
alias claude-review='claude --system-prompt "$(cat ~/.claude/contexts/review.md)"'

# 研究/探索模式
alias claude-research='claude --system-prompt "$(cat ~/.claude/contexts/research.md)"'
```

**高级：记忆持久化钩子**

有一些大多数人不知道的钩子可以帮助处理记忆：

- **PreCompact 钩子**：在上下文压缩发生之前，将重要状态保存到文件
- **Stop 钩子（会话结束）**：在会话结束时，将学习内容持久化到文件
- **SessionStart 钩子**：在新会话开始时，自动加载先前的上下文

我已经构建了这些钩子，它们位于仓库中：`github.com/affaan-m/everything-claude-code/tree/main/hooks/memory-persistence`

---

### 持续学习 / 记忆

如果你不得不重复多次提示，而 Claude 遇到了同样的问题或给了你以前听过的回复——这些模式必须附加到技能中。

**问题：** 浪费 Token、浪费上下文、浪费时间。

**解决方案：** 当 Claude Code 发现了一些非平凡的东西——一种调试技术、一种解决方法、一些项目特定的模式——它会将这些知识保存为新技能。下次出现类似问题时，技能会自动加载。

我已经构建了一个持续学习技能来做到这一点：`github.com/affaan-m/everything-claude-code/tree/main/skills/continuous-learning`

**为什么使用 Stop 钩子（而不是 UserPromptSubmit）：**

关键的设计决策是使用 **Stop 钩子** 而不是 UserPromptSubmit。UserPromptSubmit 在每条消息上运行——为每个提示增加延迟。Stop 在会话结束时运行一次——轻量级，不会在会话期间拖慢你的速度。

---

### Token 优化

**主要策略：子代理架构**

优化你使用的工具和子代理架构，旨在为任务委派最便宜的足够模型。

**模型选择快速参考：**

![模型选择表](./assets/images/longform/04-model-selection.png)
*各种常见任务上子代理的假设设置及选择背后的理由*

| 任务类型 | 模型 | 原因 |
|---------|------|------|
| 探索/搜索 | Haiku | 快速、便宜，足以查找文件 |
| 简单编辑 | Haiku | 单文件更改，清晰的指令 |
| 多文件实现 | Sonnet | 编码的最佳平衡 |
| 复杂架构 | Opus | 需要深度推理 |
| PR 审查 | Sonnet | 理解上下文，捕捉细微差别 |
| 安全分析 | Opus | 不能错过漏洞 |
| 编写文档 | Haiku | 结构简单 |
| 调试复杂 Bug | Opus | 需要在脑海中保持整个系统 |

对于 90% 的编码任务，默认使用 Sonnet。当第一次尝试失败、任务跨越 5 个以上文件、架构决策或安全关键代码时，升级到 Opus。

**定价参考：**

![Claude 模型定价](./assets/images/longform/05-pricing-table.png)
*来源：<https://platform.claude.com/docs/en/about-claude/pricing>*

**工具特定优化：**

用 mgrep 替换 grep——与传统 grep 或 ripgrep 相比，平均减少约 50% 的 Token：

![mgrep 基准测试](./assets/images/longform/06-mgrep-benchmark.png)
*在我们的 50 任务基准测试中，mgrep + Claude Code 使用的 Token 比基于 grep 的工作流少约 2 倍，质量相似或更好。来源：@mixedbread-ai 的 mgrep*

**模块化代码库的好处：**

拥有更模块化的代码库，主文件在数百行而不是数千行，有助于 Token 优化成本，并在第一次尝试时就正确完成任务。

---

### 验证循环和评估

**基准测试工作流：**

比较使用和不使用技能时要求相同内容的输出差异：

分叉对话，在其中一个中启动没有技能的新工作树，最后拉取差异，查看记录了什么。

**评估模式类型：**

- **基于检查点的评估**：设置明确的检查点，根据定义的标准验证，在继续之前修复
- **持续评估**：每 N 分钟或重大更改后运行，完整的测试套件 + lint

**关键指标：**

```
pass@k: k 次尝试中至少有一次成功
        k=1: 70%  k=3: 91%  k=5: 97%

pass^k: 所有 k 次尝试都必须成功
        k=1: 70%  k=3: 34%  k=5: 17%
```

当你只需要它能工作时使用 **pass@k**。当一致性至关重要时使用 **pass^k**。

---

## 并行化

在多 Claude 终端设置中分叉对话时，确保分叉和原始对话中的操作范围定义明确。在代码更改方面，目标是最小化重叠。

**我偏好的模式：**

主聊天用于代码更改，分叉用于关于代码库及其当前状态的问题，或对外部服务的研究。

**关于任意终端数量：**

![Boris 关于并行终端](./assets/images/longform/07-boris-parallel.png)
*Boris（Anthropic）关于运行多个 Claude 实例的建议*

Boris 有关于并行化的建议。他建议过在本地运行 5 个 Claude 实例，在上游运行 5 个。我建议不要设置任意的终端数量。增加终端应该出于真正的必要性。

你的目标应该是：**用最小可行的并行化量完成多少工作。**

**用于并行实例的 Git 工作树：**

```bash
# 为并行工作创建工作树
git worktree add ../project-feature-a feature-a
git worktree add ../project-feature-b feature-b
git worktree add ../project-refactor refactor-branch

# 每个工作树获得自己的 Claude 实例
cd ../project-feature-a && claude
```

如果你要开始扩展实例，并且你有多个 Claude 实例在相互重叠的代码上工作，那么你必须使用 git 工作树，并为每个实例制定非常明确的计划。使用 `/rename <名称>` 来命名你的所有聊天。

![双终端设置](./assets/images/longform/08-two-terminals.png)
*起始设置：左终端用于编码，右终端用于提问 - 使用 /rename 和 /fork*

**级联方法：**

当运行多个 Claude Code 实例时，使用"级联"模式组织：

- 在新标签页中打开新任务到右侧
- 从左到右扫描，从最旧到最新
- 一次最多专注于 3-4 个任务

---

## 基础工作

**双实例启动模式：**

对于我自己的工作流管理，我喜欢用 2 个打开的 Claude 实例启动一个空仓库。

**实例 1：脚手架代理**
- 铺设脚手架和基础工作
- 创建项目结构
- 设置配置（CLAUDE.md、规则、代理）

**实例 2：深度研究代理**
- 连接到你的所有服务、网络搜索
- 创建详细的 PRD
- 创建架构 mermaid 图
- 编译带有实际文档片段的参考资料

**llms.txt 模式：**

如果可用，你可以在许多文档参考上通过到达其文档页面后执行 `/llms.txt` 来找到 `llms.txt`。这为你提供了干净的、LLM 优化的文档版本。

**理念：构建可重用模式**

来自 @omarsar0："早期，我花时间构建可重用的工作流/模式。构建起来很繁琐，但随着模型和代理工具的改进，这产生了惊人的复合效应。"

**投资什么：**

- 子代理
- 技能
- 命令
- 规划模式
- MCP 工具
- 上下文工程模式

---

## 代理和子代理的最佳实践

**子代理上下文问题：**

子代理的存在是通过返回摘要而不是转储所有内容来节省上下文。但编排器拥有子代理缺乏的语义上下文。子代理只知道字面查询，不知道请求背后的目的。

**迭代检索模式：**

1. 编排器评估每个子代理的返回
2. 在接受之前提出后续问题
3. 子代理返回源，获取答案，返回
4. 循环直到充分（最多 3 个周期）

**关键：** 传递目标上下文，而不仅仅是查询。

**具有顺序阶段的编排器：**

```markdown
阶段 1：研究（使用 Explore 代理）→ research-summary.md
阶段 2：计划（使用 planner 代理）→ plan.md
阶段 3：实现（使用 tdd-guide 代理）→ 代码更改
阶段 4：审查（使用 code-reviewer 代理）→ review-comments.md
阶段 5：验证（如果需要，使用 build-error-resolver）→ 完成或循环返回
```

**关键规则：**

1. 每个代理获得一个明确的输入并产生一个明确的输出
2. 输出成为下一阶段的输入
3. 永远不要跳过阶段
4. 在代理之间使用 `/clear`
5. 将中间输出存储在文件中

---

## 有趣的内容 / 非关键只是有趣的提示

### 自定义状态栏

你可以使用 `/statusline` 设置它——然后 Claude 会说你没有但可以为你设置，并询问你想要什么。

另见：ccstatusline（自定义 Claude Code 状态栏的社区项目）

### 语音转录

用你的声音与 Claude Code 交谈。对许多人来说比打字更快。

- Mac 上的 superwhisper、MacWhisper
- 即使有转录错误，Claude 也能理解意图

### 终端别名

```bash
alias c='claude'
alias gb='github'
alias co='code'
alias q='cd ~/Desktop/projects'
```

---

## 里程碑

![25k+ GitHub Stars](./assets/images/longform/09-25k-stars.png)
*不到一周内获得 25,000+ GitHub stars*

---

## 资源

**代理编排：**

- claude-flow — 社区构建的企业编排平台，拥有 54+ 个专业代理

**自我改进记忆：**

- 参见本仓库中的 `skills/continuous-learning/`
- rlancemartin.github.io/2025/12/01/claude_diary/ - 会话反思模式

**系统提示参考：**

- system-prompts-and-models-of-ai-tools — AI 系统提示的社区集合（110k+ stars）

**官方：**

- Anthropic Academy：anthropic.skilljar.com

---

## 参考资料

- [Anthropic：为 AI 代理揭秘评估](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [YK：32 个 Claude Code 技巧](https://agenticcoding.substack.com/p/32-claude-code-tips-from-basics-to)
- [RLanceMartin：会话反思模式](https://rlancemartin.github.io/2025/12/01/claude_diary/)
- @PerceptualPeak：子代理上下文协商
- @menhguin：代理抽象层次列表
- @omarsar0：复合效应理念

---

*两份指南中涵盖的所有内容都可以在 GitHub 上的 [everything-claude-code](https://github.com/affaan-m/everything-claude-code) 找到*
