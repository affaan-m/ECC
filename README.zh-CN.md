# Everything Claude Code

[![Stars](https://img.shields.io/github/stars/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/stargazers)
[![Forks](https://img.shields.io/github/forks/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/network/members)
[![Contributors](https://img.shields.io/github/contributors/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/graphs/contributors)
[![npm ecc-universal](https://img.shields.io/npm/dw/ecc-universal?label=ecc-universal%20weekly%20downloads&logo=npm)](https://www.npmjs.com/package/ecc-universal)
[![npm ecc-agentshield](https://img.shields.io/npm/dw/ecc-agentshield?label=ecc-agentshield%20weekly%20downloads&logo=npm)](https://www.npmjs.com/package/ecc-agentshield)
[![GitHub App Install](https://img.shields.io/badge/GitHub%20App-150%20installs-2ea44f?logo=github)](https://github.com/marketplace/ecc-tools)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Shell](https://img.shields.io/badge/-Shell-4EAA25?logo=gnu-bash&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)
![Go](https://img.shields.io/badge/-Go-00ADD8?logo=go&logoColor=white)
![Java](https://img.shields.io/badge/-Java-ED8B00?logo=openjdk&logoColor=white)
![Perl](https://img.shields.io/badge/-Perl-39457E?logo=perl&logoColor=white)
![Markdown](https://img.shields.io/badge/-Markdown-000000?logo=markdown&logoColor=white)

> **140K+ stars** | **21K+ forks** | **170+ 贡献者** | **12+ 语言系统** | **Anthropic黑客松获胜者**

---

<div align="center">

**Language / 语言 / 語言 / Dil / Язык / Ngôn ngữ**

[**English**](README.md) | [Português (Brasil)](docs/pt-BR/README.md) | [简体中文](README.zh-CN.md) | [繁體中文](docs/zh-TW/README.md) | [日本語](docs/ja-JP/README.md) | [한국어](docs/ko-KR/README.md) | [Türkçe](docs/tr/README.md) | [Русский](docs/ru/README.md) | [Tiếng Việt](docs/vi-VN/README.md) | [ไทย](docs/th/README.md) | [Deutsch](docs/de-DE/README.md)

</div>

---

**来自 Anthropic 黑客马拉松获胜者的完整 Claude Code 配置集合。**

不止是配置文件，而是一整套完整系统：技能体系、本能行为、记忆优化、持续学习、安全扫描，以及研究优先的开发模式。
包含可直接用于生产环境的智能体、技能模块、钩子、规则、MCP 配置，以及兼容传统命令的适配层——所有内容均经过 10 个多月高强度日常使用与真实产品开发迭代打磨而成。

可在 **Claude Code**、**Codex**、**Cursor**、**OpenCode**、**Gemini** 及其他 AI 智能体框架中通用。

---

## 指南

这个仓库只包含原始代码。指南解释了一切。

<table>
<tr>
<td width="33%">
<a href="https://x.com/affaanmustafa/status/2012378465664745795">
<img src="https://github.com/user-attachments/assets/1a471488-59cc-425b-8345-5245c7efbcef" alt="The Shorthand Guide to Everything Claude Code" />
</a>
</td>
<td width="33%">
<a href="https://x.com/affaanmustafa/status/2014040193557471352">
<img src="https://github.com/user-attachments/assets/c9ca43bc-b149-427f-b551-af6840c368f0" alt="The Longform Guide to Everything Claude Code" />
</a>
</td>
<td width="33%">
<a href="https://x.com/affaanmustafa/status/2033263813387223421">
<img src="./assets/images/security/security-guide-header.png" alt="The Shorthand Guide to Everything Agentic Security" />
</a>
</td>
</tr>
<tr>
<td align="center"><b>精简指南</b><br/>设置、基础、理念。<b>先读这个。</b></td>
<td align="center"><b>详细指南</b><br/>Token 优化、内存持久化、评估、并行化。</td>
<td align="center"><b>安全指南</b><br/>攻击向量、沙箱技术、数据净化、CVE漏洞、Agent防护</td>
</tr>
</table>

| 主题 | 你将学到什么 |
|-------|-------------------|
| Token 优化 | 模型选择、系统提示精简、后台进程 |
| 内存持久化 | 自动跨会话保存/加载上下文的钩子 |
| 持续学习 | 从会话中自动提取模式到可重用的技能 |
| 验证循环 | 检查点 vs 持续评估、评分器类型、pass@k 指标 |
| 并行化 | Git worktrees、级联方法、何时扩展实例 |
| 子代理编排 | 上下文问题、迭代检索模式 |

---

## 最新动态

### v2.0.0 — 智能体 Harness 操作系统（2026年6月）

2.0 主线稳定版：261 个技能、control-pane 基底（会话适配器 + MCP 清单）、worktree 生命周期服务，以及 [ECC Discord 社区](https://discord.gg/36yGMHGFbR)。

### v2.0.0-rc.1 — 表面同步、运营工作流与 ECC 2.0 Alpha（2026年4月）

- **公共表面已与真实仓库同步** —— 元数据、目录数量、插件清单以及安装文档现在都与实际开源表面保持一致。
- **运营与外向型工作流扩展** —— `brand-voice`、`social-graph-ranker`、`customer-billing-ops`、`google-workspace-ops` 等运营型 skill 已纳入同一系统。
- **媒体与发布工具补齐** —— `manim-video`、`remotion-video-creation` 以及社媒发布能力让技术讲解和发布流程直接在同一仓库内完成。
- **框架与产品表面继续扩展** —— `nestjs-patterns`、更完整的 Codex/OpenCode 安装表面，以及跨 harness 打包改进，让仓库不再局限于 Claude Code。
- **ECC 2.0 alpha 已进入仓库** —— `ecc2/` 下的 Rust 控制层现已可在本地构建，并提供 `dashboard`、`start`、`sessions`、`status`、`stop`、`resume` 与 `daemon` 命令。
- **生态加固持续推进** —— AgentShield、ECC Tools 成本控制、计费门户工作与网站刷新仍围绕核心插件持续交付。

## 快速开始

在 2 分钟内快速上手：

### 第一步：安装插件

> 注意：插件安装方式较为便捷，但如果你的 Claude Code 版本无法正常解析自托管市场条目，建议使用下方的开源安装脚本，稳定性更高。

```bash
# 添加市场
/plugin marketplace add https://github.com/affaan-m/ECC

# 安装插件
/plugin install ecc@ecc
```

> 安装名称说明：较早的帖子里可能还会出现较长的旧标识符。Anthropic 的 marketplace/plugin 安装是按规范化插件标识符寻址的，因此 ECC 现在统一为 `ecc@ecc`，让工具名和 slash command 命名空间保持简短。

### 第二步：仅在需要时安装规则

> WARNING: **重要提示：** Claude Code 插件无法自动分发 `rules`。
>
> 如果你已经通过 `/plugin install` 安装了 ECC，**不要再运行 `./install.sh --profile full`、`.\install.ps1 --profile full` 或 `npx ecc-install --profile full`**。插件已经会自动加载 ECC 的技能、命令和 hooks；此时再执行完整安装，会把同一批内容再次复制到用户目录，导致技能重复以及运行时行为重复。
>
> 对于插件安装路径，请只手动复制你需要的 `rules/` 目录。只有在你完全不走插件安装、而是选择“纯手动安装 ECC”时，才应该使用完整安装器。

```bash
# 首先克隆仓库
git clone https://github.com/affaan-m/everything-claude-code.git
cd everything-claude-code

# 安装依赖（选择你常用的包管理器）
npm install        # 或：pnpm install | yarn install | bun install

# 插件安装路径：只复制规则
mkdir -p ~/.claude/rules
cp -R rules/common ~/.claude/rules/
cp -R rules/typescript ~/.claude/rules/

# 纯手动安装 ECC（不要和 /plugin install 叠加）
# ./install.sh --profile full
```

```powershell
# Windows 系统（PowerShell）

# 插件安装路径：只复制规则
New-Item -ItemType Directory -Force -Path "$HOME/.claude/rules" | Out-Null
Copy-Item -Recurse rules/common "$HOME/.claude/rules/"
Copy-Item -Recurse rules/typescript "$HOME/.claude/rules/"

# 纯手动安装 ECC（不要和 /plugin install 叠加）
# .\install.ps1 --profile full
# npx ecc-install --profile full
```

如需手动安装说明，请查看 `rules/` 文件夹中的 README 文档。手动复制规则文件时，请直接复制**整个语言目录**（例如 `rules/common` 或 `rules/golang`），而非目录内的单个文件，以保证相对路径引用正常、文件名不会冲突。

### 第三步：开始使用

```bash
# 尝试一个命令（插件安装使用命名空间形式）
/ecc:plan "添加用户认证"

# 手动安装（选项2）使用简短形式：
# /plan "添加用户认证"

# 查看可用命令
/plugin list ecc@ecc
```

**完成！** 你现在可以使用 64 个代理、262 个技能和 84 个命令。

### multi-* 命令需要额外配置

> WARNING: 上面的基础插件 / rules 安装**不包含** `multi-*` 命令所需的运行时。
>
> 如果要使用 `/multi-plan`、`/multi-execute`、`/multi-backend`、`/multi-frontend` 和 `/multi-workflow`，还需要额外安装 `ccg-workflow` 运行时。
>
> 可通过 `npx ccg-workflow` 完成初始化安装。
>
> 该运行时会提供这些命令依赖的关键组件，包括：
> - `~/.claude/bin/codeagent-wrapper`
> - `~/.claude/.ccg/prompts/*`
>
> 未安装 `ccg-workflow` 时，这些 `multi-*` 命令将无法正常运行。

---

## 跨平台支持

该插件现已**全面支持 Windows、macOS 和 Linux**，并与主流 IDE（Cursor、OpenCode、Antigravity）及命令行工具深度集成。所有钩子与脚本均已使用 Node.js 重写，以实现最佳兼容性。

### 包管理器检测

插件自动检测你首选的包管理器（npm、pnpm、yarn 或 bun），优先级如下：

1. **环境变量**: `CLAUDE_PACKAGE_MANAGER`
2. **项目配置**: `.claude/package-manager.json`
3. **package.json**: `packageManager` 字段
4. **锁文件**: 从 package-lock.json、yarn.lock、pnpm-lock.yaml 或 bun.lockb 检测
5. **全局配置**: `~/.claude/package-manager.json`
6. **回退**: 第一个可用的包管理器

要设置你首选的包管理器：

```bash
# 通过环境变量
export CLAUDE_PACKAGE_MANAGER=pnpm

# 通过全局配置
node scripts/setup-package-manager.js --global pnpm

# 通过项目配置
node scripts/setup-package-manager.js --project bun

# 检测当前设置
node scripts/setup-package-manager.js --detect
```

或在 Claude Code 中使用 `/setup-pm` 命令。

### 钩子运行时控制

使用运行时标记调整严格度或临时禁用特定钩子：

```bash
# 钩子严格度配置文件（默认值：standard）
export ECC_HOOK_PROFILE=standard

# 以英文逗号分隔的钩子 ID 列表，用于禁用指定钩子
export ECC_DISABLED_HOOKS="pre:bash:tmux-reminder,post:edit:typecheck"
```

---

## 里面有什么

这个仓库是一个 **Claude Code 插件** - 直接安装或手动复制组件。

```
everything-claude-code/
|-- .claude-plugin/   # 插件与应用商店清单
|   |-- plugin.json         # 插件元数据与组件路径
|   |-- marketplace.json    # 用于 /plugin marketplace add 的自托管应用商店目录
|
|-- agents/           # 36 个专用子智能体，用于任务委派
|   |-- planner.md           # 功能实现规划
|   |-- architect.md         # 系统架构设计决策
|   |-- tdd-guide.md         # 测试驱动开发
|   |-- code-reviewer.md     # 代码质量与安全审查
|   |-- security-reviewer.md # 漏洞分析
|   |-- build-error-resolver.md # 构建错误修复
|   |-- e2e-runner.md        # Playwright 端到端测试
|   |-- refactor-cleaner.md  # 无效代码清理
|   |-- doc-updater.md       # 文档同步更新
|   |-- docs-lookup.md       # 文档 / API 查阅
|   |-- chief-of-staff.md    # 沟通梳理与文稿起草
|   |-- loop-operator.md     # 自主循环执行
|   |-- harness-optimizer.md # 执行框架配置调优
|   |-- cpp-reviewer.md      # C++ 代码审查
|   |-- cpp-build-resolver.md # C++ 构建错误修复
|   |-- go-reviewer.md       # Go 代码审查
|   |-- go-build-resolver.md # Go 构建错误修复
|   |-- python-reviewer.md   # Python 代码审查
|   |-- database-reviewer.md # 数据库 / Supabase 审查
|   |-- typescript-reviewer.md # TypeScript/JavaScript 代码审查
|   |-- java-reviewer.md     # Java/Spring Boot 代码审查
|   |-- java-build-resolver.md # Java/Maven/Gradle 构建错误修复
|   |-- kotlin-reviewer.md   # Kotlin/Android/KMP 代码审查
|   |-- kotlin-build-resolver.md # Kotlin/Gradle 构建错误修复
|   |-- rust-reviewer.md     # Rust 代码审查
|   |-- rust-build-resolver.md # Rust 构建错误修复
|   |-- pytorch-build-resolver.md # PyTorch/CUDA 训练错误修复
|
|-- skills/           # 工作流定义与领域知识库
|   |-- coding-standards/           # 各语言最佳实践
|   |-- clickhouse-io/              # ClickHouse 分析、查询与数据工程
|   |-- backend-patterns/           # API、数据库、缓存设计模式
|   |-- frontend-patterns/          # React、Next.js 开发模式
|   |-- frontend-slides/            # HTML 幻灯片与 PPTX 转网页工作流（新增）
|   |-- article-writing/            # 长文本写作，保留指定风格、避免通用 AI 腔调（新增）
|   |-- content-engine/             # 多平台社交内容创作与复用工作流（新增）
|   |-- market-research/            # 带来源引用的市场、竞品与投资方研究（新增）
|   |-- investor-materials/         # 融资路演 PPT、单页摘要、备忘录与财务模型（新增）
|   |-- investor-outreach/          # 定制化融资触达与跟进（新增）
|   |-- continuous-learning/        # 从会话中自动提取模式（长文本指南）
|   |-- continuous-learning-v2/     # 基于本能的学习，附带置信度评分
|   |-- iterative-retrieval/        # 为子智能体渐进式优化上下文
|   |-- strategic-compact/          # 手动上下文精简建议（长文本指南）
|   |-- tdd-workflow/               # 测试驱动开发方法论
|   |-- security-review/            # 安全检查清单
|   |-- eval-harness/               # 验证循环评估（长文本指南）
|   |-- verification-loop/          # 持续验证机制（长文本指南）
|   |-- videodb/                    # 音视频采集、检索、编辑、生成与推流（新增）
|   |-- golang-patterns/            # Go 语言惯用写法与最佳实践
|   |-- golang-testing/             # Go 测试模式、TDD 与基准测试
|   |-- cpp-coding-standards/       # 遵循 C++ Core Guidelines 的编码规范（新增）
|   |-- cpp-testing/                # 基于 GoogleTest、CMake/CTest 的 C++ 测试（新增）
|   |-- django-patterns/            # Django 模式、模型与视图（新增）
|   |-- django-security/            # Django 安全最佳实践（新增）
|   |-- django-tdd/                 # Django TDD 工作流（新增）
|   |-- django-verification/        # Django 验证循环（新增）
|   |-- laravel-patterns/           # Laravel 架构模式（新增）
|   |-- laravel-security/           # Laravel 安全最佳实践（新增）
|   |-- laravel-tdd/                # Laravel TDD 工作流（新增）
|   |-- laravel-verification/       # Laravel 验证循环（新增）
|   |-- python-patterns/            # Python 惯用写法与最佳实践（新增）
|   |-- python-testing/             # 基于 pytest 的 Python 测试（新增）
|   |-- quarkus-patterns/            # Java Quarkus 模式（新增）
|   |-- quarkus-security/            # Quarkus 安全（新增）
|   |-- quarkus-tdd/                 # Quarkus TDD（新增）
|   |-- quarkus-verification/        # Quarkus 验证（新增）
|   |-- springboot-patterns/        # Java Spring Boot 模式（新增）
|   |-- springboot-security/        # Spring Boot 安全（新增）
|   |-- springboot-tdd/             # Spring Boot TDD（新增）
|   |-- springboot-verification/    # Spring Boot 验证（新增）
|   |-- configure-ecc/              # 交互式安装向导（新增）
|   |-- security-scan/              # 集成 AgentShield 安全审计（新增）
|   |-- java-coding-standards/      # Java 编码规范（新增）
|   |-- jpa-patterns/               # JPA/Hibernate 模式（新增）
|   |-- postgres-patterns/          # PostgreSQL 优化模式（新增）
|   |-- nutrient-document-processing/ # 基于 Nutrient API 的文档处理（新增）
|   |-- docs/examples/project-guidelines-template.md  # 项目专属技能模板
|   |-- database-migrations/        # 数据库迁移模式（Prisma、Drizzle、Django、Go）（新增）
|   |-- api-design/                 # REST API 设计、分页、错误响应（新增）
|   |-- deployment-patterns/        # CI/CD、Docker、健康检查、回滚（新增）
|   |-- docker-patterns/            # Docker Compose、网络、数据卷、容器安全（新增）
|   |-- e2e-testing/                # Playwright E2E 模式与页面对象模型（新增）
|   |-- content-hash-cache-pattern/  # 用于文件处理的 SHA-256 内容哈希缓存（新增）
|   |-- cost-aware-llm-pipeline/     # LLM 成本优化、模型路由、预算跟踪（新增）
|   |-- regex-vs-llm-structured-text/ # 文本解析：正则与 LLM 选型决策框架（新增）
|   |-- swift-actor-persistence/     # 基于 Actor 的 Swift 线程安全数据持久化（新增）
|   |-- swift-protocol-di-testing/   # 基于协议的依赖注入，实现可测试 Swift 代码（新增）
|   |-- search-first/               # 先调研再编码工作流（新增）
|   |-- skill-stocktake/            # 技能与命令质量审计（新增）
|   |-- liquid-glass-design/         # iOS 26 Liquid Glass 设计系统（新增）
|   |-- foundation-models-on-device/ # 基于 Apple FoundationModels 的端侧大模型（新增）
|   |-- swift-concurrency-6-2/       # Swift 6.2 简洁并发编程（新增）
|   |-- perl-patterns/              # 现代 Perl 5.36+ 惯用写法与最佳实践（新增）
|   |-- perl-security/              # Perl 安全模式、污点模式、安全 I/O（新增）
|   |-- perl-testing/               # 基于 Test2::V0、prove、Devel::Cover 的 Perl TDD（新增）
|   |-- autonomous-loops/           # 自主循环模式：顺序流水线、PR 循环、DAG 编排（新增）
|   |-- plankton-code-quality/      # 基于 Plankton 钩子的实时代码质量管控（新增）
|
|-- commands/         # 维护中的斜杠命令兼容层；优先使用 skills/
|   |-- plan.md             # /plan - 实现规划
|   |-- code-review.md      # /code-review - 代码质量审查
|   |-- build-fix.md        # /build-fix - 修复构建错误
|   |-- quality-gate.md     # /quality-gate - 验证门禁
|   |-- refactor-clean.md   # /refactor-clean - 清理无效代码
|   |-- learn.md            # /learn - 会话中提取模式（长文本指南）
|   |-- learn-eval.md       # /learn-eval - 提取、评估并保存模式（新增）
|   |-- checkpoint.md       # /checkpoint - 保存验证状态（长文本指南）
|   |-- setup-pm.md         # /setup-pm - 配置包管理器
|   |-- go-review.md        # /go-review - Go 代码审查（新增）
|   |-- go-test.md          # /go-test - Go TDD 工作流（新增）
|   |-- go-build.md         # /go-build - 修复 Go 构建错误（新增）
|   |-- skill-create.md     # /skill-create - 从 Git 历史生成技能（新增）
|   |-- instinct-status.md  # /instinct-status - 查看已学习本能（新增）
|   |-- instinct-import.md  # /instinct-import - 导入本能（新增）
|   |-- instinct-export.md  # /instinct-export - 导出本能（新增）
|   |-- evolve.md           # /evolve - 将本能聚类为技能
|   |-- prune.md            # /prune - 删除过期待处理本能（新增）
|   |-- pm2.md              # /pm2 - PM2 服务生命周期管理（新增）
|   |-- multi-plan.md       # /multi-plan - 多智能体任务拆解（新增）
|   |-- multi-execute.md    # /multi-execute - 多智能体工作流编排（新增）
|   |-- multi-backend.md    # /multi-backend - 后端多服务编排（新增）
|   |-- multi-frontend.md   # /multi-frontend - 前端多服务编排（新增）
|   |-- multi-workflow.md   # /multi-workflow - 通用多服务工作流（新增）
|   |-- sessions.md         # /sessions - 会话历史管理
|   |-- test-coverage.md    # /test-coverage - 测试覆盖率分析
|   |-- update-docs.md      # /update-docs - 更新文档
|   |-- update-codemaps.md  # /update-codemaps - 更新代码映射
|   |-- python-review.md    # /python-review - Python 代码审查（新增）
|-- legacy-command-shims/   # 已退役短命令的按需归档，例如 /tdd 和 /eval
|   |-- tdd.md              # /tdd - 优先使用 tdd-workflow 技能
|   |-- e2e.md              # /e2e - 优先使用 e2e-testing 技能
|   |-- eval.md             # /eval - 优先使用 eval-harness 技能
|   |-- verify.md           # /verify - 优先使用 verification-loop 技能
|   |-- orchestrate.md      # /orchestrate - 优先使用 dmux-workflows 或 multi-workflow
|
|-- rules/            # 必须遵守的规范（复制到 ~/.claude/rules/）
|   |-- README.md            # 结构概览与安装指南
|   |-- common/              # 与语言无关的通用原则
|   |   |-- coding-style.md    # 不可变性、文件组织规范
|   |   |-- git-workflow.md    # 提交格式、PR 流程
|   |   |-- testing.md         # TDD、80% 覆盖率要求
|   |   |-- performance.md     # 模型选型、上下文管理
|   |   |-- patterns.md        # 设计模式、项目骨架
|   |   |-- hooks.md           # 钩子架构、TodoWrite
|   |   |-- agents.md          # 子智能体委派时机
|   |   |-- security.md        # 强制安全检查
|   |-- typescript/          # TypeScript/JavaScript 专属规范
|   |-- python/              # Python 专属规范
|   |-- golang/              # Go 专属规范
|   |-- swift/               # Swift 专属规范
|   |-- php/                 # PHP 专属规范（新增）
|
|-- hooks/            # 基于触发器的自动化逻辑
|   |-- README.md                 # 钩子文档、使用示例与自定义指南
|   |-- hooks.json                # 全部钩子配置（PreToolUse、PostToolUse、Stop 等）
|   |-- memory-persistence/       # 会话生命周期钩子（长文本指南）
|   |-- strategic-compact/        # 上下文精简建议（长文本指南）
|
|-- scripts/          # 跨平台 Node.js 脚本（新增）
|   |-- lib/                     # 通用工具库
|   |   |-- utils.js             # 跨平台文件 / 路径 / 系统工具
|   |   |-- package-manager.js   # 包管理器检测与选择
|   |-- hooks/                   # 钩子实现
|   |   |-- session-start.js     # 会话启动时加载上下文
|   |   |-- session-end.js       # 会话结束时保存状态
|   |   |-- pre-compact.js       # 上下文精简前状态保存
|   |   |-- suggest-compact.js   # 策略性精简建议
|   |   |-- evaluate-session.js  # 从会话中提取模式
|   |-- setup-package-manager.js # 交互式包管理器设置
|
|-- tests/            # 测试套件（新增）
|   |-- lib/                     # 工具库测试
|   |-- hooks/                   # 钩子测试
|   |-- run-all.js               # 运行全部测试
|
|-- contexts/         # 动态注入的系统提示上下文（长文本指南）
|   |-- dev.md              # 开发模式上下文
|   |-- review.md           # 代码审查模式上下文
|   |-- research.md         # 研究 / 探索模式上下文
|
|-- examples/         # 配置与会话示例
|   |-- CLAUDE.md             # 项目级配置示例
|   |-- user-CLAUDE.md        # 用户级配置示例
|   |-- saas-nextjs-CLAUDE.md   # 真实 SaaS 项目（Next.js + Supabase + Stripe）
|   |-- go-microservice-CLAUDE.md # 真实 Go 微服务（gRPC + PostgreSQL）
|   |-- django-api-CLAUDE.md      # 真实 Django REST API（DRF + Celery）
|   |-- laravel-api-CLAUDE.md     # 真实 Laravel API（PostgreSQL + Redis）（新增）
|   |-- rust-api-CLAUDE.md        # 真实 Rust API（Axum + SQLx + PostgreSQL）（新增）
|
|-- mcp-configs/      # MCP 服务端配置
|   |-- mcp-servers.json    # GitHub、Supabase、Vercel、Railway 等配置
|
|-- marketplace.json  # 自托管应用商店配置（用于 /plugin marketplace add）
```

---

## 生态系统工具

### 技能创建器

两种从你的仓库生成 Claude Code 技能的方法：

#### 选项 A：本地分析（内置）

使用 `/skill-create` 命令进行本地分析，无需外部服务：

```bash
/skill-create                    # 分析当前仓库
/skill-create --instincts        # 还为 continuous-learning 生成直觉
```

这在本地分析你的 git 历史并生成 SKILL.md 文件。

#### 选项 B：GitHub 应用（高级）

用于高级功能（10k+ 提交、自动 PR、团队共享）：

[安装 GitHub 应用](https://github.com/apps/skill-creator) | [ecc.tools](https://ecc.tools)

```bash
# 在任何问题上评论：
/skill-creator analyze

# 或在推送到默认分支时自动触发
```

两个选项都创建：
- **SKILL.md 文件** - 可直接用于 Claude Code 的技能
- **直觉集合** - 用于 continuous-learning-v2
- **模式提取** - 从你的提交历史中学习

### AgentShield — 安全审计工具

> 于 Claude Code 黑客松（Cerebral Valley x Anthropic，2026 年 2 月）开发完成。包含 1282 项测试、98% 覆盖率、102 条静态分析规则。

扫描你的 Claude Code 配置，检测漏洞、错误配置与注入风险。

```bash
# 快速扫描（无需安装）
npx ecc-agentshield scan

# 自动修复安全问题
npx ecc-agentshield scan --fix

# 调用 3 个 Opus 4.6 智能体进行深度分析
npx ecc-agentshield scan --opus --stream

# 从零生成安全配置
npx ecc-agentshield init
```

**扫描范围：** CLAUDE.md、settings.json、MCP 配置、钩子、智能体定义与技能模块，覆盖 5 大类别 —— 密钥检测（14 种模式）、权限审计、钩子注入分析、MCP 服务风险评估、智能体配置审查。

**`--opus` 参数**：启动 3 个 Claude Opus 4.6 智能体组成红队/蓝队/审计管道。攻击者寻找利用链，防御者评估防护机制，审计者综合生成优先级风险报告。采用对抗推理，而非单纯模式匹配。

**输出格式：** 终端（彩色等级 A-F）、JSON（CI 流水线）、Markdown、HTML。发现严重问题时返回退出码 2，可用于构建门禁。

在 Claude Code 中使用 `/security-scan` 运行，或通过 [GitHub Action](https://github.com/affaan-m/agentshield) 集成到 CI。

[GitHub](https://github.com/affaan-m/agentshield) | [npm](https://www.npmjs.com/package/ecc-agentshield)

### 持续学习 v2

基于直觉的学习系统自动学习你的模式：

```bash
/instinct-status        # 显示带有置信度的学习直觉
/instinct-import <file> # 从他人导入直觉
/instinct-export        # 导出你的直觉以供分享
/evolve                 # 将相关直觉聚类到技能中
/promote                # 将项目级直觉提升为全局直觉
/projects               # 查看已识别项目与直觉统计
```

完整文档见 `skills/continuous-learning-v2/`。

---

## 环境要求

### Claude Code 命令行版本
**最低版本：v2.1.0 或更高**

由于插件系统处理钩子的机制发生变更，本插件要求 Claude Code CLI 版本不低于 v2.1.0。

查看当前版本：
```bash
claude --version
```

### 重要提示：钩子自动加载机制
> 警告：**贡献者请注意**：请勿在 `.claude-plugin/plugin.json` 中添加 `"hooks"` 字段。回归测试已强制禁止该操作。

Claude Code v2.1+ 会**按照约定自动加载**已安装插件中的 `hooks/hooks.json`。若在 `plugin.json` 中显式声明该文件，会触发重复检测错误：
```
检测到重复的钩子文件：./hooks/hooks.json 指向已加载的文件
```

**历史说明**：该问题曾在本仓库中引发多次「修复-回滚」循环（[#29](https://github.com/affaan-m/everything-claude-code/issues/29)、[#52](https://github.com/affaan-m/everything-claude-code/issues/52)、[#103](https://github.com/affaan-m/everything-claude-code/issues/103)）。因 Claude Code 版本间行为变更导致混淆，现已添加回归测试，防止该问题再次出现。

---

## 安装

### 选项 1：作为插件安装（推荐）

使用此仓库的最简单方法 - 作为 Claude Code 插件安装：

```bash
# 将此仓库添加为市场
/plugin marketplace add https://github.com/affaan-m/ECC

# 安装插件
/plugin install ecc@ecc
```

或直接添加到你的 `~/.claude/settings.json`：

```json
{
  "extraKnownMarketplaces": {
    "ecc": {
      "source": {
        "source": "github",
        "repo": "affaan-m/everything-claude-code"
      }
    }
  },
  "enabledPlugins": {
    "ecc@ecc": true
  }
}
```

这让你可以立即访问所有命令、代理、技能和钩子。

> **注意：** Claude Code 插件系统不支持通过插件分发 `rules`（[上游限制](https://code.claude.com/docs/en/plugins-reference)）。你需要手动安装规则：
>
> ```bash
> # 首先克隆仓库
> git clone https://github.com/affaan-m/everything-claude-code.git
>
> # 方案 A：用户级规则（对所有项目生效）
> mkdir -p ~/.claude/rules
> cp -r everything-claude-code/rules/common ~/.claude/rules/
> cp -r everything-claude-code/rules/typescript ~/.claude/rules/   # 选择你使用的技术栈
> cp -r everything-claude-code/rules/python ~/.claude/rules/
> cp -r everything-claude-code/rules/golang ~/.claude/rules/
> cp -r everything-claude-code/rules/php ~/.claude/rules/
>
> # 方案 B：项目级规则（仅对当前项目生效）
> mkdir -p .claude/rules
> cp -r everything-claude-code/rules/common .claude/rules/
> cp -r everything-claude-code/rules/typescript .claude/rules/     # 选择你使用的技术栈
> ```

---

### 选项 2：手动安装

如果你希望手动控制安装内容，可按以下步骤操作：

```bash
# 克隆仓库
git clone https://github.com/affaan-m/everything-claude-code.git

# 将智能体文件复制到 Claude 配置目录
cp everything-claude-code/agents/*.md ~/.claude/agents/

# 复制规则目录（通用规则 + 特定语言规则）
mkdir -p ~/.claude/rules
cp -r everything-claude-code/rules/common ~/.claude/rules/
cp -r everything-claude-code/rules/typescript ~/.claude/rules/   # 选择你使用的技术栈
cp -r everything-claude-code/rules/python ~/.claude/rules/
cp -r everything-claude-code/rules/golang ~/.claude/rules/
cp -r everything-claude-code/rules/php ~/.claude/rules/

# 优先复制技能模块（核心工作流）
# 新用户推荐：仅复制核心/通用技能
cp -r everything-claude-code/.agents/skills/* ~/.claude/skills/
cp -r everything-claude-code/skills/search-first ~/.claude/skills/

# 可选：仅在需要时添加细分领域/框架专属技能
# for s in django-patterns django-tdd laravel-patterns springboot-patterns quarkus-patterns; do
# cp -r everything-claude-code/skills/$s ~/.claude/skills/
# done

# 可选：迁移期间保留维护中的斜杠命令兼容
mkdir -p ~/.claude/commands
cp everything-claude-code/commands/*.md ~/.claude/commands/

# 已退役短命令位于 legacy-command-shims/commands/。
# 仅在仍需要 /tdd 等旧名称时，单独复制对应文件。
```

#### 将钩子配置添加到 settings.json
仅适用于手动安装：如果你没有通过 Claude 插件方式安装 ECC，可以将 `hooks/hooks.json` 中的钩子配置复制到你的 `~/.claude/settings.json` 文件中。

如果你是通过 `/plugin install` 安装 ECC，请不要再把这些钩子复制到 `settings.json`。Claude Code v2.1+ 会自动加载插件中的 `hooks/hooks.json`，重复注册会导致重复执行以及 `${CLAUDE_PLUGIN_ROOT}` 无法解析。

#### 配置 MCP 服务
从 `mcp-configs/mcp-servers.json` 中复制需要的 MCP 服务定义，粘贴到官方 Claude Code 配置文件 `~/.claude/settings.json` 中；
若需要仓库本地的 MCP 访问权限，可粘贴到项目级配置文件 `.mcp.json` 中。

如果你已自行运行 ECC 捆绑的 MCP 服务，设置以下环境变量：
```bash
export ECC_DISABLED_MCPS="github,context7,exa,playwright,sequential-thinking,memory"
```
ECC 托管的安装程序和 Codex 同步流程将跳过或移除这些服务，避免重复添加。

**重要提示**：将配置中的 `YOUR_*_HERE` 占位符替换为你真实的 API 密钥。

---

## 关键概念

### 代理

子代理以有限范围处理委托的任务。示例：

```markdown
---
name: code-reviewer
description: 审查代码的质量、安全性和可维护性
tools: ["Read", "Grep", "Glob", "Bash"]
model: opus
---

你是一名高级代码审查员...
```

### 技能

技能是由命令或代理调用的工作流定义：

```markdown
# TDD 工作流

1. 首先定义接口
2. 编写失败的测试（RED）
3. 实现最少的代码（GREEN）
4. 重构（IMPROVE）
5. 验证 80%+ 的覆盖率
```

### 钩子

钩子在工具事件时触发。示例 - 警告 console.log：

```json
{
  "matcher": "tool == \"Edit\" && tool_input.file_path matches \"\\\\.(ts|tsx|js|jsx)$\"",
  "hooks": [{
    "type": "command",
    "command": "#!/bin/bash\ngrep -n 'console\\.log' \"$file_path\" && echo '[Hook] 移除 console.log' >&2"
  }]
}
```

### 规则

规则是始终遵循的指南，分为 `common/`（通用）+ 语言特定目录：

```
~/.claude/rules/
  common/          # 通用原则（必装）
  typescript/      # TS/JS 特定模式和工具
  python/          # Python 特定模式和工具
  golang/          # Go 特定模式和工具
  perl/            # Perl 特定模式和工具
```

---

## 运行测试

插件包含一个全面的测试套件：

```bash
# 运行所有测试
node tests/run-all.js

# 运行单个测试文件
node tests/lib/utils.test.js
node tests/lib/package-manager.test.js
node tests/hooks/hooks.test.js
```

---

## 贡献

**欢迎并鼓励贡献。**

这个仓库旨在成为社区资源。如果你有：
- 有用的代理或技能
- 聪明的钩子
- 更好的 MCP 配置
- 改进的规则

请贡献！请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解指南。

### 贡献想法

- 特定语言技能（Rust、C#、Kotlin、Java）—— Go、Python、Perl、Swift 和 TypeScript 已内置
- 特定框架配置（Rails、FastAPI）—— Django、NestJS、Spring Boot 和 Laravel 已内置
- DevOps 智能体（Kubernetes、Terraform、AWS、Docker）
- 测试策略（多种测试框架、视觉回归测试）
- 领域专属知识库（机器学习、数据工程、移动端开发）

---

## 背景

自实验性推出以来，我一直在使用 Claude Code。2025 年 9 月，与 [@DRodriguezFX](https://x.com/DRodriguezFX) 一起使用 Claude Code 构建 [zenith.chat](https://zenith.chat)，赢得了 Anthropic x Forum Ventures 黑客马拉松。

这些配置在多个生产应用中经过了实战测试。

---

## WARNING: 重要说明

### 上下文窗口管理

**关键：** 不要一次启用所有 MCP。如果启用了太多工具，你的 200k 上下文窗口可能会缩小到 70k。

经验法则：
- 配置 20-30 个 MCP
- 每个项目保持启用少于 10 个
- 活动工具少于 80 个

在项目配置中使用 `disabledMcpServers` 来禁用未使用的。

### 定制化

这些配置适用于我的工作流。你应该：
1. 从适合你的开始
2. 为你的技术栈进行修改
3. 删除你不使用的
4. 添加你自己的模式

---

## 社区项目

基于 Everything Claude Code 构建或受其启发的项目：

| 项目 | 介绍 |
|------|------|
| [EVC](https://github.com/SaigonXIII/evc) | 营销智能体工作区 — 包含 42 条命令，面向内容运营、品牌管控与多渠道发布。[可视化概览](https://saigonxiii.github.io/evc)。 |

如果你用 ECC 做了项目，欢迎提交 PR 添加到这里。

---

## 赞助者

本项目免费开源。赞助支持项目持续维护与功能迭代。

[成为赞助者](https://github.com/sponsors/affaan-m) | [赞助档位](SPONSORS.md) | [赞助计划](SPONSORING.md)

---

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=affaan-m/everything-claude-code&type=Date)](https://star-history.com/#affaan-m/everything-claude-code&Date)

---

## 链接

- **快速上手指南（入门首选）：** [Everything Claude Code 简明指南](https://x.com/affaanmustafa/status/2012378465664745795)
- **长文指南（高阶进阶）：** [Everything Claude Code 完整版深度指南](https://x.com/affaanmustafa/status/2014040193557471352)
- **安全指南：** [安全指南](./the-security-guide.md) | [推文详解](https://x.com/affaanmustafa/status/2033263813387223421)
- **关注作者：** [@affaanmustafa](https://x.com/affaanmustafa)

---

## 许可证

MIT - 自由使用，根据需要修改，如果可以请回馈。

---

**如果这个仓库有帮助，请给它一个 Star。阅读两个指南。构建一些很棒的东西。**
