**语言：** [English](../../README.md) | [Português (Brasil)](../pt-BR/README.md) | [简体中文](../../README.zh-CN.md) | [繁體中文](../zh-TW/README.md) | [日本語](../ja-JP/README.md) | [한국어](../ko-KR/README.md) | [Türkçe](../tr/README.md) | [Русский](../ru/README.md) | [Tiếng Việt](../vi-VN/README.md) | [ไทย](../th/README.md)

# Everything Claude Code

[![Stars](https://img.shields.io/github/stars/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/stargazers)
[![Forks](https://img.shields.io/github/forks/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/network/members)
[![Contributors](https://img.shields.io/github/contributors/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/graphs/contributors)
[![npm ecc-universal](https://img.shields.io/npm/dw/ecc-universal?label=ecc-universal%20weekly%20downloads\&logo=npm)](https://www.npmjs.com/package/ecc-universal)
[![npm ecc-agentshield](https://img.shields.io/npm/dw/ecc-agentshield?label=ecc-agentshield%20weekly%20downloads\&logo=npm)](https://www.npmjs.com/package/ecc-agentshield)
[![GitHub App Install](https://img.shields.io/endpoint?url=https%3A%2F%2Fapi.ecc.tools%2Fbadge%2Finstalls&logo=github)](https://github.com/marketplace/ecc-tools)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Shell](https://img.shields.io/badge/-Shell-4EAA25?logo=gnu-bash\&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript\&logoColor=white)
![Python](https://img.shields.io/badge/-Python-3776AB?logo=python\&logoColor=white)
![Go](https://img.shields.io/badge/-Go-00ADD8?logo=go\&logoColor=white)
![Java](https://img.shields.io/badge/-Java-ED8B00?logo=openjdk\&logoColor=white)
![Perl](https://img.shields.io/badge/-Perl-39457E?logo=perl\&logoColor=white)
![Markdown](https://img.shields.io/badge/-Markdown-000000?logo=markdown\&logoColor=white)

> **140K+ stars** | **21K+ forks** | **170+ contributors** | **12+ language ecosystems** | **Anthropic Hackathon Winner**

***

<div align="center">

**语言 / Language / 語言 / Dil / Язык / Ngôn ngữ**

[**English**](../../README.md) | [Português (Brasil)](../pt-BR/README.md) | [简体中文](../../README.zh-CN.md) | [繁體中文](../zh-TW/README.md) | [日本語](../ja-JP/README.md) | [한국어](../ko-KR/README.md) | [Türkçe](../tr/README.md) | [Русский](../ru/README.md) | [Tiếng Việt](../vi-VN/README.md) | [ไทย](../th/README.md)

</div>

***

**适用于 AI 智能体平台的性能优化系统。来自 Anthropic 黑客马拉松的获奖作品。**

不仅仅是配置。一个完整的系统：技能、本能、内存优化、持续学习、安全扫描以及研究优先的开发。经过 10 多个月的密集日常使用和构建真实产品的经验，演进出生产就绪的智能体、钩子、命令、规则和 MCP 配置。

适用于 **Claude Code**、**Codex**、**Cursor**、**OpenCode**、**Gemini** 以及其他 AI 智能体平台。

***

## 指南

此仓库仅包含原始代码。指南解释了一切。

<table>
<tr>
<td width="33%">
<a href="https://x.com/affaanmustafa/status/2012378465664745795">
<img src="../../assets/images/guides/shorthand-guide.png" alt="Claude代码简明指南/>
</a>
</td>
<td width="33%">
<a href="https://x.com/affaanmustafa/status/2014040193557471352">
<img src="../../assets/images/guides/longform-guide.png" alt="Claude代码详细指南" />
</a>
</td>
<td width="33%">
<a href="https://x.com/affaanmustafa/status/2033263813387223421">
<img src="../../assets/images/security/security-guide-header.png" alt="Agentic安全简明指南" />
</a>
</td>
</tr>
<tr>
<td align="center"><b>Shorthand Guide</b><br/>设置、基础、理念。 <b>首先阅读此内容。</b></td>
<td align="center"><b>详细指南</b><br/>令牌优化、内存持久化、评估、并行化。</td>
<td align="center"><b>安全指南</b><br/>攻击向量、沙盒化、净化、CVE、AgentShield。</td>
</tr>
</table>

| 主题 | 你将学到什么 |
|-------|-------------------|
| 令牌优化 | 模型选择，系统提示精简，后台进程 |
| 内存持久化 | 自动跨会话保存/加载上下文的钩子 |
| 持续学习 | 从会话中自动提取模式为可重用技能 |
| 验证循环 | 检查点与持续评估，评分器类型，pass@k 指标 |
| 并行化 | Git 工作树，级联方法，何时扩展实例 |
| 子智能体编排 | 上下文问题，迭代检索模式 |

***

## 最新动态

### v2.0.0 — 智能体 Harness 操作系统（2026年6月）

2.0 主线稳定版：261 个技能、control-pane 基底（会话适配器 + MCP 清单）、worktree 生命周期服务，以及 [ECC Discord 社区](https://discord.gg/36yGMHGFbR)。

### v2.0.0-rc.1 — 表面同步、运营工作流与 ECC 2.0 Alpha（2026年4月）

* **公共表面已与真实仓库同步** —— 元数据、目录数量、插件清单以及安装文档现在都与实际开源表面保持一致。
* **运营与外向型工作流扩展** —— `brand-voice`、`social-graph-ranker`、`customer-billing-ops`、`google-workspace-ops` 等运营型 skill 已纳入同一系统。
* **媒体与发布工具补齐** —— `manim-video`、`remotion-video-creation` 以及社媒发布能力让技术讲解和发布流程直接在同一仓库内完成。
* **框架与产品表面继续扩展** —— `nestjs-patterns`、更完整的 Codex/OpenCode 安装表面，以及跨 harness 打包改进，让仓库不再局限于 Claude Code。
* **ECC 2.0 alpha 已进入仓库** —— `ecc2/` 下的 Rust 控制层现已可在本地构建，并提供 `dashboard`、`start`、`sessions`、`status`、`stop`、`resume` 与 `daemon` 命令。
* **生态加固持续推进** —— AgentShield、ECC Tools 成本控制、计费门户工作与网站刷新仍围绕核心插件持续交付。

### v1.9.0 — 选择性安装与语言扩展 (2026年3月)

* **选择性安装架构** — 基于清单的安装流程，使用 `install-plan.js` 和 `install-apply.js` 进行针对性组件安装。状态存储跟踪已安装内容并支持增量更新。
* **新增 6 个智能体** — `typescript-reviewer`, `pytorch-build-resolver`, `java-build-resolver`, `java-reviewer`, `kotlin-reviewer`, `kotlin-build-resolver` 将语言覆盖范围扩展至 10 种。
* **新技能** — `pytorch-patterns` 用于深度学习工作流，`documentation-lookup` 用于 API 参考研究，`bun-runtime` 和 `nextjs-turbopack` 用于现代 JS 工具链，外加 8 个操作领域技能以及 `mcp-server-patterns`。
* **会话与状态基础设施** — 带查询 CLI 的 SQLite 状态存储、用于结构化记录的会话适配器、为自进化技能奠定基础的技能演进框架。
* **编排系统大修** — 使治理审核评分具有确定性，强化编排状态和启动器兼容性，通过 5 层防护防止观察者循环。
* **观察者可靠性** — 通过节流和尾部采样修复内存爆炸问题，修复沙箱访问，实现延迟启动逻辑，并增加重入防护。
* **12 个语言生态系统** — 新增 Java、PHP、Perl、Kotlin/Android/KMP、C++ 和 Rust 规则，与现有的 TypeScript、Python、Go 及通用规则并列。
* **社区贡献** — 韩语和中文翻译，biome 钩子优化，VideoDB 技能，Evos 操作技能，PowerShell 安装程序，Antigravity IDE 支持。
* **CI 强化** — 修复 19 个测试失败问题，强制执行目录计数，验证安装清单，并使完整测试套件通过。

### v1.8.0 — 平台性能系统（2026 年 3 月）

* **平台优先发布** — ECC 现在被明确构建为一个智能体平台性能系统，而不仅仅是一个配置包。
* **钩子可靠性大修** — SessionStart 根回退、Stop 阶段会话摘要，以及用基于脚本的钩子替换脆弱的单行内联钩子。
* **钩子运行时控制** — `ECC_HOOK_PROFILE=minimal|standard|strict` 和 `ECC_DISABLED_HOOKS=...` 用于运行时门控，无需编辑钩子文件。
* **新平台命令** — `/harness-audit`、`/loop-start`、`/loop-status`、`/quality-gate`、`/model-route`。
* **NanoClaw v2** — 模型路由、技能热加载、会话分支/搜索/导出/压缩/指标。
* **跨平台一致性** — 在 Claude Code、Cursor、OpenCode 和 Codex 应用/CLI 中行为更加统一。
* **997 项内部测试通过** — 钩子/运行时重构和兼容性更新后，完整套件全部通过。

### v1.7.0 — 跨平台扩展与演示文稿生成器（2026年2月）

* **Codex 应用 + CLI 支持** — 基于 `AGENTS.md` 的直接 Codex 支持、安装器目标定位以及 Codex 文档
* **`frontend-slides` 技能** — 零依赖的 HTML 演示文稿生成器，附带 PPTX 转换指导和严格的视口适配规则
* **5个新的通用业务/内容技能** — `article-writing`、`content-engine`、`market-research`、`investor-materials`、`investor-outreach`
* **更广泛的工具覆盖** — 加强了对 Cursor、Codex 和 OpenCode 的支持，使得同一代码仓库可以在所有主要平台上干净地部署
* **992项内部测试** — 在插件、钩子、技能和打包方面扩展了验证和回归测试覆盖

### v1.6.0 — Codex CLI、AgentShield 与市场（2026年2月）

* **Codex CLI 支持** — 新的 `/codex-setup` 命令生成 `codex.md` 以实现 OpenAI Codex CLI 兼容性
* **7个新技能** — `search-first`、`swift-actor-persistence`、`swift-protocol-di-testing`、`regex-vs-llm-structured-text`、`content-hash-cache-pattern`、`cost-aware-llm-pipeline`、`skill-stocktake`
* **AgentShield 集成** — `/security-scan` 技能直接从 Claude Code 运行 AgentShield；1282 项测试，102 条规则
* **GitHub 市场** — ECC Tools GitHub 应用已在 [github.com/marketplace/ecc-tools](https://github.com/marketplace/ecc-tools) 上线，提供免费/专业/企业版
* **合并了 30+ 个社区 PR** — 来自 6 种语言的 30 位贡献者的贡献
* **978项内部测试** — 在代理、技能、命令、钩子和规则方面扩展了验证套件

### v1.4.1 — 错误修复 (2026年2月)

* **修复了直觉导入内容丢失问题** — `parse_instinct_file()` 在 `/instinct-import` 期间会静默丢弃 frontmatter 之后的所有内容（Action, Evidence, Examples 部分）。已由社区贡献者 @ericcai0814 修复 ([#148](https://github.com/affaan-m/everything-claude-code/issues/148), [#161](https://github.com/affaan-m/everything-claude-code/pull/161))

### v1.4.0 — 多语言规则、安装向导 & PM2 (2026年2月)

* **交互式安装向导** — 新的 `configure-ecc` 技能提供了带有合并/覆盖检测的引导式设置
* **PM2 & 多智能体编排** — 6 个新命令 (`/pm2`, `/multi-plan`, `/multi-execute`, `/multi-backend`, `/multi-frontend`, `/multi-workflow`) 用于管理复杂的多服务工作流
* **多语言规则架构** — 规则从扁平文件重组为 `common/` + `typescript/` + `python/` + `golang/` 目录。仅安装您需要的语言
* **中文 (zh-CN) 翻译** — 所有智能体、命令、技能和规则的完整翻译 (80+ 个文件)
* **GitHub Sponsors 支持** — 通过 GitHub Sponsors 赞助项目
* **增强的 CONTRIBUTING.md** — 针对每种贡献类型的详细 PR 模板

### v1.3.0 — OpenCode 插件支持 (2026年2月)

* **完整的 OpenCode 集成** — 12 个智能体，24 个命令，16 个技能，通过 OpenCode 的插件系统支持钩子 (20+ 种事件类型)
* **3 个原生自定义工具** — run-tests, check-coverage, security-audit
* **LLM 文档** — `llms.txt` 用于获取全面的 OpenCode 文档

### v1.2.0 — 统一的命令和技能 (2026年2月)

* **Python/Django 支持** — Django 模式、安全、TDD 和验证技能
* **Java Spring Boot 技能** — Spring Boot 的模式、安全、TDD 和验证
* **会话管理** — `/sessions` 命令用于查看会话历史
* **持续学习 v2** — 基于直觉的学习，带有置信度评分、导入/导出、进化

完整的更新日志请参见 [Releases](https://github.com/affaan-m/everything-claude-code/releases)。

***

## 快速开始

在 2 分钟内启动并运行：

### 步骤 1：安装插件

```bash
# Add marketplace
/plugin marketplace add https://github.com/affaan-m/ECC

# Install plugin
/plugin install ecc@ecc
```

### 步骤 2：安装规则（必需）

> WARNING: **重要提示：** Claude Code 插件无法自动分发 `rules`。
>
> 如果你已经通过 `/plugin install` 安装了 ECC，**不要再运行 `./install.sh --profile full`、`.\install.ps1 --profile full` 或 `npx ecc-install --profile full`**。插件已经会自动加载 ECC 的技能、命令和 hooks；此时再执行完整安装，会把同一批内容再次复制到用户目录，导致技能重复以及运行时行为重复。
>
> 对于插件安装路径，请只手动复制你需要的 `rules/` 目录。只有在你完全不走插件安装、而是选择“纯手动安装 ECC”时，才应该使用完整安装器。

```bash
# Clone the repo first
git clone https://github.com/affaan-m/everything-claude-code.git
cd everything-claude-code

# Install dependencies (pick your package manager)
npm install        # or: pnpm install | yarn install | bun install

# Plugin install path: copy rules only
mkdir -p ~/.claude/rules
cp -R rules/common ~/.claude/rules/
cp -R rules/typescript ~/.claude/rules/

# Fully manual ECC install path (do this instead of /plugin install)
# ./install.sh --profile full
```

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force -Path "$HOME/.claude/rules" | Out-Null
Copy-Item -Recurse rules/common "$HOME/.claude/rules/"
Copy-Item -Recurse rules/typescript "$HOME/.claude/rules/"

# Fully manual ECC install path (do this instead of /plugin install)
# .\install.ps1 --profile full
# npx ecc-install --profile full
```

手动安装说明请参阅 `rules/` 文件夹中的 README。

### 步骤 3：开始使用

```bash
# Try a command (plugin install uses namespaced form)
/ecc:plan "Add user authentication"

# Manual install (Option 2) uses the shorter form:
# /plan "Add user authentication"

# Check available commands
/plugin list ecc@ecc
```

**搞定！** 你现在可以使用 65 个智能体、262 项技能和 84 个命令了。

***

## 跨平台支持

此插件现已完全支持 **Windows、macOS 和 Linux**，并与主流 IDE（Cursor、OpenCode、Antigravity）和 CLI 平台紧密集成。所有钩子和脚本都已用 Node.js 重写，以实现最大兼容性。

### 包管理器检测

插件会自动检测您首选的包管理器（npm、pnpm、yarn 或 bun），优先级如下：

1. **环境变量**：`CLAUDE_PACKAGE_MANAGER`
2. **项目配置**：`.claude/package-manager.json`
3. **package.json**：`packageManager` 字段
4. **锁文件**：从 package-lock.json、yarn.lock、pnpm-lock.yaml 或 bun.lockb 检测
5. **全局配置**：`~/.claude/package-manager.json`
6. **回退方案**：第一个可用的包管理器

要设置您首选的包管理器：

```bash
# Via environment variable
export CLAUDE_PACKAGE_MANAGER=pnpm

# Via global config
node scripts/setup-package-manager.js --global pnpm

# Via project config
node scripts/setup-package-manager.js --project bun

# Detect current setting
node scripts/setup-package-manager.js --detect
```

或者在 Claude Code 中使用 `/setup-pm` 命令。

### 钩子运行时控制

使用运行时标志来调整严格性或临时禁用特定钩子：

```bash
# Hook strictness profile (default: standard)
export ECC_HOOK_PROFILE=standard

# Comma-separated hook IDs to disable
export ECC_DISABLED_HOOKS="pre:bash:tmux-reminder,post:edit:typecheck"
```

***

## 包含内容

此仓库是一个 **Claude Code 插件** - 可以直接安装或手动复制组件。

```
everything-claude-code/
|-- .claude-plugin/   # 插件和市场清单
|   |-- plugin.json         # 插件元数据和组件路径
|   |-- marketplace.json    # 用于 /plugin marketplace add 的市场目录
|
|-- agents/           # 28 个用于委托任务的专用子代理
|   |-- planner.md           # 功能实现规划
|   |-- architect.md         # 系统设计决策
|   |-- tdd-guide.md         # 测试驱动开发
|   |-- code-reviewer.md     # 质量与安全审查
|   |-- security-reviewer.md # 漏洞分析
|   |-- build-error-resolver.md
|   |-- e2e-runner.md        # Playwright 端到端测试
|   |-- refactor-cleaner.md  # 无用代码清理
|   |-- doc-updater.md       # 文档同步
|   |-- docs-lookup.md       # 文档/API 查询
|   |-- chief-of-staff.md    # 沟通分流与草稿生成
|   |-- loop-operator.md     # 自动化循环执行
|   |-- harness-optimizer.md # Harness 配置优化
|   |-- cpp-reviewer.md      # C++ 代码审查
|   |-- cpp-build-resolver.md # C++ 构建错误修复
|   |-- go-reviewer.md       # Go 代码审查
|   |-- go-build-resolver.md # Go 构建错误修复
|   |-- python-reviewer.md   # Python 代码审查
|   |-- database-reviewer.md # 数据库/Supabase 审查
|   |-- typescript-reviewer.md # TypeScript/JavaScript 代码审查
|   |-- java-reviewer.md     # Java/Spring Boot 代码审查
|   |-- java-build-resolver.md # Java/Maven/Gradle 构建错误修复
|   |-- kotlin-reviewer.md   # Kotlin/Android/KMP 代码审查
|   |-- kotlin-build-resolver.md # Kotlin/Gradle 构建错误修复
|   |-- rust-reviewer.md     # Rust 代码审查
|   |-- rust-build-resolver.md # Rust 构建错误修复
|   |-- pytorch-build-resolver.md # PyTorch/CUDA 训练错误修复
|
|-- skills/           # 工作流定义与领域知识
|   |-- coding-standards/           # 语言最佳实践
|   |-- clickhouse-io/              # ClickHouse 分析、查询与数据工程
|   |-- backend-patterns/           # API、数据库与缓存模式
|   |-- frontend-patterns/          # React、Next.js 模式
|   |-- frontend-slides/            # HTML 幻灯片与 PPTX 转 Web 演示工作流（新增）
|   |-- article-writing/            # 按指定风格撰写长文，避免通用 AI 语气（新增）
|   |-- content-engine/             # 多平台内容生成与复用工作流（新增）
|   |-- market-research/            # 带来源引用的市场、竞品与投资人研究（新增）
|   |-- investor-materials/         # 融资演示文稿、单页材料、备忘录与财务模型（新增）
|   |-- investor-outreach/          # 个性化融资沟通与跟进（新增）
|   |-- continuous-learning/        # 从会话中自动提取模式（长文指南）
|   |-- continuous-learning-v2/     # 基于直觉的学习与置信度评分
|   |-- iterative-retrieval/        # 子代理渐进式上下文优化
|   |-- strategic-compact/          # 手动压缩建议（长文指南）
|   |-- tdd-workflow/               # TDD 方法论
|   |-- security-review/            # 安全检查清单
|   |-- eval-harness/               # 验证循环评估（长文指南）
|   |-- verification-loop/          # 持续验证（长文指南）
|   |-- videodb/                   # 视频与音频：导入、搜索、编辑、生成与流式处理（新增）
|   |-- golang-patterns/            # Go 习惯用法与最佳实践
|   |-- golang-testing/             # Go 测试模式、TDD 与基准测试
|   |-- cpp-coding-standards/         # 基于 C++ Core Guidelines 的 C++ 编码规范（新增）
|   |-- cpp-testing/                # 使用 GoogleTest 与 CMake/CTest 的 C++ 测试（新增）
|   |-- django-patterns/            # Django 模式、模型与视图（新增）
|   |-- django-security/            # Django 安全最佳实践（新增）
|   |-- django-tdd/                 # Django TDD 工作流（新增）
|   |-- django-verification/        # Django 验证循环（新增）
|   |-- laravel-patterns/           # Laravel 架构模式（新增）
|   |-- laravel-security/           # Laravel 安全最佳实践（新增）
|   |-- laravel-tdd/                # Laravel TDD 工作流（新增）
|   |-- laravel-verification/       # Laravel 验证循环（新增）
|   |-- python-patterns/            # Python 习惯用法与最佳实践（新增）
|   |-- python-testing/             # 使用 pytest 的 Python 测试（新增）
|   |-- quarkus-patterns/            # Java Quarkus 模式（新增）
|   |-- quarkus-security/            # Quarkus 安全（新增）
|   |-- quarkus-tdd/                 # Quarkus TDD（新增）
|   |-- quarkus-verification/        # Quarkus 验证（新增）
|   |-- springboot-patterns/        # Java Spring Boot 模式（新增）
|   |-- springboot-security/        # Spring Boot 安全（新增）
|   |-- springboot-tdd/             # Spring Boot TDD（新增）
|   |-- springboot-verification/    # Spring Boot 验证（新增）
|   |-- configure-ecc/              # 交互式安装向导（新增）
|   |-- security-scan/              # AgentShield 安全审计集成（新增）
|   |-- java-coding-standards/     # Java 编码规范（新增）
|   |-- jpa-patterns/              # JPA/Hibernate 模式（新增）
|   |-- postgres-patterns/         # PostgreSQL 优化模式（新增）
|   |-- nutrient-document-processing/ # 使用 Nutrient API 的文档处理（新增）
|   |-- docs/examples/project-guidelines-template.md  # 项目专用技能模板
|   |-- database-migrations/         # 迁移模式（Prisma、Drizzle、Django、Go）（新增）
|   |-- api-design/                  # REST API 设计、分页与错误响应（新增）
|   |-- deployment-patterns/         # CI/CD、Docker、健康检查与回滚（新增）
|   |-- docker-patterns/            # Docker Compose、网络、卷与容器安全（新增）
|   |-- e2e-testing/                 # Playwright 端到端模式与页面对象模型（新增）
|   |-- content-hash-cache-pattern/  # 文件处理中的 SHA-256 内容哈希缓存模式（新增）
|   |-- cost-aware-llm-pipeline/     # LLM 成本优化、模型路由与预算跟踪（新增）
|   |-- regex-vs-llm-structured-text/ # 文本解析决策框架：正则 vs LLM（新增）
|   |-- swift-actor-persistence/     # 使用 Actor 的线程安全 Swift 数据持久化（新增）
|   |-- swift-protocol-di-testing/   # 基于 Protocol 的依赖注入用于可测试 Swift 代码（新增）
|   |-- search-first/               # 先调研后编码的工作流（新增）
|   |-- skill-stocktake/            # 审计技能与命令质量（新增）
|   |-- liquid-glass-design/         # iOS 26 Liquid Glass 设计系统（新增）
|   |-- foundation-models-on-device/ # Apple 设备端 LLM（FoundationModels）（新增）
|   |-- swift-concurrency-6-2/       # Swift 6.2 易用并发（新增）
|   |-- perl-patterns/             # 现代 Perl 5.36+ 习惯用法与最佳实践（新增）
|   |-- perl-security/             # Perl 安全模式、taint 模式与安全 I/O（新增）
|   |-- perl-testing/              # 使用 Test2::V0、prove、Devel::Cover 的 Perl TDD（新增）
|   |-- autonomous-loops/           # 自主循环模式：顺序流水线、PR 循环与 DAG 编排（新增）
|   |-- plankton-code-quality/      # 使用 Plankton hooks 的编写期代码质量控制（新增）
|
|-- commands/         # 维护中的斜杠命令兼容层；优先使用 skills/
|   |-- plan.md             # /plan - 实现规划
|   |-- code-review.md      # /code-review - 质量审查
|   |-- build-fix.md        # /build-fix - 修复构建错误
|   |-- refactor-clean.md   # /refactor-clean - 无用代码清理
|   |-- quality-gate.md     # /quality-gate - 验证门禁
|   |-- learn.md            # /learn - 会话中提取模式（长文指南）
|   |-- learn-eval.md       # /learn-eval - 提取、评估并保存模式（新增）
|   |-- checkpoint.md       # /checkpoint - 保存验证状态（长文指南）
|   |-- setup-pm.md         # /setup-pm - 配置包管理器
|   |-- go-review.md        # /go-review - Go 代码审查（新增）
|   |-- go-test.md          # /go-test - Go TDD 工作流（新增）
|   |-- go-build.md         # /go-build - 修复 Go 构建错误（新增）
|   |-- skill-create.md     # /skill-create - 从 git 历史生成技能（新增）
|   |-- instinct-status.md  # /instinct-status - 查看学习到的直觉（新增）
|   |-- instinct-import.md  # /instinct-import - 导入直觉（新增）
|   |-- instinct-export.md  # /instinct-export - 导出直觉（新增）
|   |-- evolve.md           # /evolve - 将直觉聚类为技能
|   |-- pm2.md              # /pm2 - PM2 服务生命周期管理（新增）
|   |-- multi-plan.md       # /multi-plan - 多代理任务拆解（新增）
|   |-- multi-execute.md    # /multi-execute - 编排的多代理工作流（新增）
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
|-- rules/            # 必须遵循的规则（复制到 ~/.claude/rules/）
|   |-- README.md            # 结构说明与安装指南
|   |-- common/              # 与语言无关的原则
|   |   |-- coding-style.md    # 不可变性与文件组织
|   |   |-- git-workflow.md    # 提交格式与 PR 流程
|   |   |-- testing.md         # TDD 与 80% 覆盖率要求
|   |   |-- performance.md     # 模型选择与上下文管理
|   |   |-- patterns.md        # 设计模式与骨架项目
|   |   |-- hooks.md           # Hook 架构与 TodoWrite
|   |   |-- agents.md          # 何时委托给子代理
|   |   |-- security.md        # 强制安全检查
|   |-- typescript/          # TypeScript/JavaScript 专用
|   |-- python/              # Python 专用
|   |-- golang/              # Go 专用
|   |-- swift/               # Swift 专用
|   |-- php/                 # PHP 专用（新增）
|
|-- hooks/            # 基于触发器的自动化
|   |-- README.md                 # Hook 文档、示例与自定义指南
|   |-- hooks.json                # 所有 Hook 配置（PreToolUse、PostToolUse、Stop 等）
|   |-- memory-persistence/       # 会话生命周期 Hook（长文指南）
|   |-- strategic-compact/        # 压缩建议（长文指南）
|
|-- scripts/          # 跨平台 Node.js 脚本（新增）
|   |-- lib/                     # 公共工具
|   |   |-- utils.js             # 跨平台文件/路径/系统工具
|   |   |-- package-manager.js   # 包管理器检测与选择
|   |-- hooks/                   # Hook 实现
|   |   |-- session-start.js     # 会话开始时加载上下文
|   |   |-- session-end.js       # 会话结束时保存状态
|   |   |-- pre-compact.js       # 压缩前状态保存
|   |   |-- suggest-compact.js   # 战略压缩建议
|   |   |-- evaluate-session.js  # 从会话中提取模式
|   |-- setup-package-manager.js # 交互式包管理器设置
|
|-- tests/            # 测试套件（新增）
|   |-- lib/                     # 库测试
|   |-- hooks/                   # Hook 测试
|   |-- run-all.js               # 运行所有测试
|
|-- contexts/         # 动态系统提示上下文（长文指南）
|   |-- dev.md              # 开发模式上下文
|   |-- review.md           # 代码审查模式上下文
|   |-- research.md         # 研究/探索模式上下文
|
|-- examples/         # 示例配置与会话
|   |-- CLAUDE.md             # 项目级配置示例
|   |-- user-CLAUDE.md        # 用户级配置示例
|   |-- saas-nextjs-CLAUDE.md   # 实际 SaaS 示例（Next.js + Supabase + Stripe）
|   |-- go-microservice-CLAUDE.md # 实际 Go 微服务示例（gRPC + PostgreSQL）
|   |-- django-api-CLAUDE.md      # 实际 Django REST API 示例（DRF + Celery）
|   |-- laravel-api-CLAUDE.md     # 实际 Laravel API 示例（PostgreSQL + Redis）（新增）
|   |-- rust-api-CLAUDE.md        # 实际 Rust API 示例（Axum + SQLx + PostgreSQL）（新增）
|
|-- mcp-configs/      # MCP 服务器配置
|   |-- mcp-servers.json    # GitHub、Supabase、Vercel、Railway 等
|
|-- marketplace.json  # 自托管市场配置（用于 /plugin marketplace add）
```

***

## 生态系统工具

### 技能创建器

从您的仓库生成 Claude Code 技能的两种方式：

#### 选项 A：本地分析（内置）

使用 `/skill-create` 命令进行本地分析，无需外部服务：

```bash
/skill-create                    # Analyze current repo
/skill-create --instincts        # Also generate instincts for continuous-learning
```

这会在本地分析您的 git 历史记录并生成 SKILL.md 文件。

#### 选项 B：GitHub 应用（高级）

适用于高级功能（10k+ 提交、自动 PR、团队共享）：

[安装 GitHub 应用](https://github.com/apps/skill-creator) | [ecc.tools](https://ecc.tools)

```bash
# Comment on any issue:
/skill-creator analyze

# Or auto-triggers on push to default branch
```

两种选项都会创建：

* **SKILL.md 文件** - 可供 Claude Code 使用的即用型技能
* **Instinct 集合** - 用于 continuous-learning-v2
* **模式提取** - 从您的提交历史中学习

### AgentShield — 安全审计器

> 在 Claude Code 黑客马拉松（Cerebral Valley x Anthropic，2026年2月）上构建。1282 项测试，98% 覆盖率，102 条静态分析规则。

扫描您的 Claude Code 配置，查找漏洞、错误配置和注入风险。

```bash
# Quick scan (no install needed)
npx ecc-agentshield scan

# Auto-fix safe issues
npx ecc-agentshield scan --fix

# Deep analysis with three Opus 4.6 agents
npx ecc-agentshield scan --opus --stream

# Generate secure config from scratch
npx ecc-agentshield init
```

**它扫描什么：** CLAUDE.md、settings.json、MCP 配置、钩子、代理定义以及 5 个类别的技能 —— 密钥检测（14 种模式）、权限审计、钩子注入分析、MCP 服务器风险剖析和代理配置审查。

**`--opus` 标志** 在红队/蓝队/审计员管道中运行三个 Claude Opus 4.6 代理。攻击者寻找利用链，防御者评估保护措施，审计员将两者综合成优先风险评估。对抗性推理，而不仅仅是模式匹配。

**输出格式：** 终端（按颜色分级的 A-F）、JSON（CI 管道）、Markdown、HTML。在关键发现时退出代码 2，用于构建门控。

在 Claude Code 中使用 `/security-scan` 来运行它，或者通过 [GitHub Action](https://github.com/affaan-m/agentshield) 添加到 CI。

[GitHub](https://github.com/affaan-m/agentshield) | [npm](https://www.npmjs.com/package/ecc-agentshield)

### Plankton — 编写时代码质量强制执行

Plankton（致谢：@alxfazio）是用于编写时代码质量强制执行的推荐伴侣。它通过 PostToolUse 钩子在每次文件编辑时运行格式化程序和 20 多个代码检查器，然后生成 Claude 子进程（根据违规复杂度路由到 Haiku/Sonnet/Opus）来修复主智能体遗漏的问题。采用三阶段架构：静默自动格式化（解决 40-50% 的问题），将剩余的违规收集为结构化 JSON，委托给子进程修复。包含配置保护钩子，防止智能体修改检查器配置以通过检查而非修复代码。支持 Python、TypeScript、Shell、YAML、JSON、TOML、Markdown 和 Dockerfile。与 AgentShield 结合使用，实现安全 + 质量覆盖。完整集成指南请参阅 `skills/plankton-code-quality/`。

### 持续学习 v2

基于本能的学习系统会自动学习您的模式：

```bash
/instinct-status        # Show learned instincts with confidence
/instinct-import <file> # Import instincts from others
/instinct-export        # Export your instincts for sharing
/evolve                 # Cluster related instincts into skills
```

完整文档请参阅 `skills/continuous-learning-v2/`。

***

## 要求

### Claude Code CLI 版本

**最低版本：v2.1.0 或更高版本**

此插件需要 Claude Code CLI v2.1.0+，因为插件系统处理钩子的方式发生了变化。

检查您的版本：

```bash
claude --version
```

### 重要提示：钩子自动加载行为

> WARNING: **对于贡献者：** 请勿向 `.claude-plugin/plugin.json` 添加 `"hooks"` 字段。这由回归测试强制执行。

Claude Code v2.1+ **会自动加载** 任何已安装插件中的 `hooks/hooks.json`（按约定）。在 `plugin.json` 中显式声明会导致重复检测错误：

```
重复的钩子文件检测到：./hooks/hooks.json 解析到已加载的文件
```

**历史背景：** 这已导致此仓库中多次修复/还原循环（[#29](https://github.com/affaan-m/everything-claude-code/issues/29), [#52](https://github.com/affaan-m/everything-claude-code/issues/52), [#103](https://github.com/affaan-m/everything-claude-code/issues/103)）。Claude Code 版本之间的行为发生了变化，导致了混淆。我们现在有一个回归测试来防止这种情况再次发生。

***

## 安装

### 选项 1：作为插件安装（推荐）

使用此仓库的最简单方式 - 作为 Claude Code 插件安装：

```bash
# Add this repo as a marketplace
/plugin marketplace add https://github.com/affaan-m/ECC

# Install the plugin
/plugin install ecc@ecc
```

或者直接添加到您的 `~/.claude/settings.json`：

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

这将使您能够立即访问所有命令、代理、技能和钩子。

> **注意：** Claude Code 插件系统不支持通过插件分发 `rules` ([上游限制](https://code.claude.com/docs/en/plugins-reference))。您需要手动安装规则：
>
> ```bash
> # 首先克隆仓库
> git clone https://github.com/affaan-m/everything-claude-code.git
>
> # 选项 A：用户级规则（适用于所有项目）
> mkdir -p ~/.claude/rules
> cp -r everything-claude-code/rules/common ~/.claude/rules/common
> cp -r everything-claude-code/rules/typescript ~/.claude/rules/typescript   # 选择您的技术栈
> cp -r everything-claude-code/rules/python ~/.claude/rules/python
> cp -r everything-claude-code/rules/golang ~/.claude/rules/golang
> cp -r everything-claude-code/rules/php ~/.claude/rules/php
>
> # 选项 B：项目级规则（仅适用于当前项目）
> mkdir -p .claude/rules
> cp -r everything-claude-code/rules/common .claude/rules/common
> cp -r everything-claude-code/rules/typescript .claude/rules/typescript     # 选择您的技术栈
> ```

***

### 选项 2：手动安装

如果您希望对安装的内容进行手动控制：

```bash
# Clone the repo
git clone https://github.com/affaan-m/everything-claude-code.git

# Copy agents to your Claude config
cp everything-claude-code/agents/*.md ~/.claude/agents/

# Copy rules (common + language-specific)
cp -r everything-claude-code/rules/common ~/.claude/rules/common
cp -r everything-claude-code/rules/typescript ~/.claude/rules/typescript   # pick your stack
cp -r everything-claude-code/rules/python ~/.claude/rules/python
cp -r everything-claude-code/rules/golang ~/.claude/rules/golang
cp -r everything-claude-code/rules/php ~/.claude/rules/php

# Copy maintained commands
cp everything-claude-code/commands/*.md ~/.claude/commands/

# Retired shims live in legacy-command-shims/commands/.
# Copy individual files from there only if you still need old names such as /tdd.

# Copy skills (core vs niche)
# Recommended (new users): core/general skills only
cp -r everything-claude-code/.agents/skills/* ~/.claude/skills/
cp -r everything-claude-code/skills/search-first ~/.claude/skills/

# Optional: add niche/framework-specific skills only when needed
# for s in django-patterns django-tdd laravel-patterns springboot-patterns quarkus-patterns; do
# cp -r everything-claude-code/skills/$s ~/.claude/skills/
# done
```

#### 将钩子添加到 settings.json

将 `hooks/hooks.json` 中的钩子复制到你的 `~/.claude/settings.json`。

#### 配置 MCPs

将 `mcp-configs/mcp-servers.json` 中所需的 MCP 服务器复制到你的 `~/.claude.json`。

**重要：** 将 `YOUR_*_HERE` 占位符替换为你实际的 API 密钥。

***

## 关键概念

### 智能体

子智能体处理具有有限范围的委托任务。示例：

```markdown
---
name: code-reviewer
description: 审查代码的质量、安全性和可维护性
tools: ["Read", "Grep", "Glob", "Bash"]
model: opus
---

您是一位资深代码审查员...

```

### 技能

技能是由命令或智能体调用的工作流定义：

```markdown
# TDD Workflow

1. Define interfaces first
2. Write failing tests (RED)
3. Implement minimal code (GREEN)
4. Refactor (IMPROVE)
5. Verify 80%+ coverage
```

### 钩子

钩子在工具事件上触发。示例 - 警告关于 console.log：

```json
{
  "matcher": "tool == \"Edit\" && tool_input.file_path matches \"\\\\.(ts|tsx|js|jsx)$\"",
  "hooks": [{
    "type": "command",
    "command": "#!/bin/bash\ngrep -n 'console\\.log' \"$file_path\" && echo '[Hook] Remove console.log' >&2"
  }]
}
```

### 规则

规则是始终遵循的指导原则，组织成 `common/`（与语言无关）+ 语言特定目录：

```
rules/
  common/          # 通用原则（始终安装）
  typescript/      # TS/JS 特定模式与工具
  python/          # Python 特定模式与工具
  golang/          # Go 特定模式与工具
  swift/           # Swift 特定模式与工具
  php/             # PHP 特定模式与工具
```

有关安装和结构详情，请参阅 [`rules/README.md`](rules/README.md)。

***

## 我应该使用哪个代理？

不确定从哪里开始？使用这个快速参考。技能是规范工作流表面，维护中的斜杠命令保留给偏命令式工作流。

| 我想要... | 使用此表面 | 使用的智能体 |
|--------------|-----------------|------------|
| 规划新功能 | `/ecc:plan "Add auth"` | planner |
| 设计系统架构 | `/ecc:plan` + architect agent | architect |
| 先写测试再写代码 | `tdd-workflow` 技能 | tdd-guide |
| 评审我刚写的代码 | `/code-review` | code-reviewer |
| 修复失败的构建 | `/build-fix` | build-error-resolver |
| 运行端到端测试 | `e2e-testing` 技能 | e2e-runner |
| 查找安全漏洞 | `/security-scan` | security-reviewer |
| 移除死代码 | `/refactor-clean` | refactor-cleaner |
| 更新文档 | `/update-docs` | doc-updater |
| 评审 Go 代码 | `/go-review` | go-reviewer |
| 评审 Python 代码 | `/python-review` | python-reviewer |
| 评审 TypeScript/JavaScript 代码 | *(直接调用 `typescript-reviewer`)* | typescript-reviewer |
| 审计数据库查询 | *(自动委派)* | database-reviewer |

### 常见工作流

**开始新功能：**

```
/ecc:plan "使用 OAuth 添加用户身份验证"
                                              → 规划器创建实现蓝图
tdd-workflow 技能                             → tdd-guide 强制执行先写测试
/code-review                                  → 代码审查员检查你的工作
```

**修复错误：**

```
tdd-workflow 技能                             → tdd-guide：编写一个能复现问题的失败测试
                                              → 实现修复，验证测试通过
/code-review                                  → code-reviewer：捕捉回归问题
```

**准备生产环境：**

```
/security-scan                                → security-reviewer: OWASP Top 10 审计
e2e-testing 技能                              → e2e-runner: 关键用户流程测试
/test-coverage                                → verify 80%+ 覆盖率
```

***

## 常见问题

<details>
<summary><b>如何检查已安装的代理/命令？</b></summary>

```bash
/plugin list ecc@ecc
```

这会显示插件中所有可用的代理、命令和技能。

</details>

<details>
<summary><b>我的钩子不工作 / 我看到“重复钩子文件”错误</b></summary>

这是最常见的问题。**不要在 `.claude-plugin/plugin.json` 中添加 `"hooks"` 字段。** Claude Code v2.1+ 会自动从已安装的插件加载 `hooks/hooks.json`。显式声明它会导致重复检测错误。参见 [#29](https://github.com/affaan-m/everything-claude-code/issues/29), [#52](https://github.com/affaan-m/everything-claude-code/issues/52), [#103](https://github.com/affaan-m/everything-claude-code/issues/103)。

</details>

<details>
<summary><b>我能否在自定义API端点或模型网关上使用ECC与Claude Code？</b></summary>

是的。ECC 不会硬编码 Anthropic 托管的传输设置。它通过 Claude Code 正常的 CLI/插件接口在本地运行，因此可以与以下系统配合工作：

* Anthropic 托管的 Claude Code
* 使用 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN` 的官方 Claude Code 网关设置
* 兼容的自定义端点，这些端点能理解 Anthropic API 并符合 Claude Code 的预期

最小示例：

```bash
export ANTHROPIC_BASE_URL=https://your-gateway.example.com
export ANTHROPIC_AUTH_TOKEN=your-token
claude
```

如果您的网关重新映射模型名称，请在 Claude Code 中配置，而不是在 ECC 中。一旦 `claude` CLI 已经正常工作，ECC 的钩子、技能、命令和规则就与模型提供商无关。

官方参考资料：

* [Claude Code LLM 网关文档](https://docs.anthropic.com/en/docs/claude-code/llm-gateway)
* [Claude Code 模型配置文档](https://docs.anthropic.com/en/docs/claude-code/model-config)

</details>

<details>
<summary><b>我的上下文窗口正在缩小 / Claude 即将耗尽上下文</b></summary>

太多的 MCP 服务器会消耗你的上下文。每个 MCP 工具描述都会消耗你 200k 窗口的令牌，可能将其减少到约 70k。

**修复：** 按项目禁用未使用的 MCP：

```json
// In your project's .claude/settings.json
{
  "disabledMcpServers": ["supabase", "railway", "vercel"]
}
```

保持启用的 MCP 少于 10 个，活动工具少于 80 个。

</details>

<details>
<summary><b>我可以只使用某些组件（例如，仅代理）吗？</b></summary>

是的。使用选项 2（手动安装）并仅复制你需要的部分：

```bash
# Just agents
cp everything-claude-code/agents/*.md ~/.claude/agents/

# Just rules
cp -r everything-claude-code/rules/common ~/.claude/rules/common
```

每个组件都是完全独立的。

</details>

<details>
<summary><b>这能与 Cursor / OpenCode / Codex / Antigravity 一起使用吗？</b></summary>

是的。ECC 是跨平台的：

* **Cursor**: 预翻译的配置位于 `.cursor/`。参见 [Cursor IDE 支持](#cursor-ide-支持)。
* **OpenCode**: `.opencode/` 中的完整插件支持。参见 [OpenCode 支持](#opencode-支持)。
* **Codex**: 对 macOS 应用和 CLI 的一流支持，带有适配器漂移防护和 SessionStart 回退。参见 PR [#257](https://github.com/affaan-m/everything-claude-code/pull/257)。
* **Antigravity**: 为工作流、技能和扁平化规则紧密集成的设置，位于 `.agent/`。参见 [Antigravity 指南](../ANTIGRAVITY-GUIDE.md)。
* **Claude Code**: 原生支持 — 这是主要目标。

</details>

<details>
<summary><b>我如何贡献新技能或代理？</b></summary>

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。简短版本：

1. Fork 仓库
2. 在 `skills/your-skill-name/SKILL.md` 中创建你的技能（带有 YAML 前言）
3. 或在 `agents/your-agent.md` 中创建代理
4. 提交 PR，清晰描述其功能和使用时机

</details>

***

## 运行测试

该插件包含一个全面的测试套件：

```bash
# Run all tests
node tests/run-all.js

# Run individual test files
node tests/lib/utils.test.js
node tests/lib/package-manager.test.js
node tests/hooks/hooks.test.js
```

***

## 贡献

**欢迎并鼓励贡献。**

此仓库旨在成为社区资源。如果你有：

* 有用的智能体或技能
* 巧妙的钩子
* 更好的 MCP 配置
* 改进的规则

请贡献！请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解指南。

### 贡献想法

* 特定语言技能 (Rust, C#, Kotlin, Java) — Go、Python、Perl、Swift 和 TypeScript 已包含在内
* 特定框架配置 (Rails, FastAPI) — Django、NestJS、Spring Boot、Laravel 已包含在内
* DevOps 智能体 (Kubernetes, Terraform, AWS, Docker)
* 测试策略 (不同框架、视觉回归)
* 领域特定知识 (ML, 数据工程, 移动端)

***

## Cursor IDE 支持

ECC 提供**完整的 Cursor IDE 支持**，包括为 Cursor 原生格式适配的钩子、规则、代理、技能、命令和 MCP 配置。

### 快速开始 (Cursor)

```bash
# macOS/Linux
./install.sh --target cursor typescript
./install.sh --target cursor python golang swift php
```

```powershell
# Windows PowerShell
.\install.ps1 --target cursor typescript
.\install.ps1 --target cursor python golang swift php
```

### 包含内容

| 组件 | 数量 | 详情 |
|-----------|-------|---------|
| 钩子事件 | 15 | sessionStart, beforeShellExecution, afterFileEdit, beforeMCPExecution, beforeSubmitPrompt 等 10 多个 |
| 钩子脚本 | 16 | 通过共享适配器委托给 `scripts/hooks/` 的精简 Node.js 脚本 |
| 规则 | 34 | 9 个通用规则（alwaysApply）+ 25 个语言特定规则（TypeScript, Python, Go, Swift, PHP） |
| 代理 | 共享 | 通过根目录下的 AGENTS.md（由 Cursor 原生读取） |
| 技能 | 共享 + 捆绑 | 通过根目录下的 AGENTS.md 和 `.cursor/skills/` 用于翻译后的补充内容 |
| 命令 | 共享 | `.cursor/commands/`（如果已安装） |
| MCP 配置 | 共享 | `.cursor/mcp.json`（如果已安装） |

### 钩子架构（DRY 适配器模式）

Cursor 的**钩子事件比 Claude Code 多**（20 对 8）。`.cursor/hooks/adapter.js` 模块将 Cursor 的 stdin JSON 转换为 Claude Code 的格式，允许重用现有的 `scripts/hooks/*.js` 而无需重复。

```
Cursor stdin JSON → adapter.js → transforms → scripts/hooks/*.js
                                              (与 Claude Code 共享)
```

关键钩子：

* **beforeShellExecution** — 阻止在 tmux 外启动开发服务器（退出码 2），git push 审查
* **afterFileEdit** — 自动格式化 + TypeScript 检查 + console.log 警告
* **beforeSubmitPrompt** — 检测提示中的密钥（sk-、ghp\_、AKIA 模式）
* **beforeTabFileRead** — 阻止 Tab 读取 .env、.key、.pem 文件（退出码 2）
* **beforeMCPExecution / afterMCPExecution** — MCP 审计日志记录

### 规则格式

Cursor 规则使用带有 `description`、`globs` 和 `alwaysApply` 的 YAML 前言：

```yaml
---
description: "TypeScript coding style extending common rules"
globs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]
alwaysApply: false
---
```

***

## Codex macOS 应用 + CLI 支持

ECC 为 macOS 应用和 CLI 提供 **一流的 Codex 支持**，包括参考配置、Codex 特定的 AGENTS.md 补充文档以及共享技能。

### 快速开始（Codex 应用 + CLI）

```bash
# Run Codex CLI in the repo — AGENTS.md and .codex/ are auto-detected
codex

# Optional: copy the global-safe defaults to your home directory
cp .codex/config.toml ~/.codex/config.toml
```

Codex macOS 应用：

* 将此仓库作为您的工作空间打开。
* 根目录 `AGENTS.md` 会自动检测。
* `.codex/config.toml` 和 `.codex/agents/*.toml` 在保持项目本地时效果最佳。
* 参考文件 `.codex/config.toml` 有意未固定 `model` 或 `model_provider`，因此除非您手动覆盖，Codex 将使用其自身的当前默认版本。
* 可选：将 `.codex/config.toml` 复制到 `~/.codex/config.toml` 以设置全局默认值；除非您也复制 `.codex/agents/`，否则请将多智能体角色文件保留在项目本地。

### 包含内容

| 组件 | 数量 | 详情 |
|-----------|-------|---------|
| 配置 | 1 | `.codex/config.toml` —— 顶级 approvals/sandbox/web\_search, MCP 服务器，通知，配置文件 |
| AGENTS.md | 2 | 根目录（通用）+ `.codex/AGENTS.md`（Codex 特定补充） |
| 技能 | 32 | `.agents/skills/` —— SKILL.md + agents/openai.yaml 每个技能 |
| MCP 服务器 | 4 | GitHub, Context7, Memory, Sequential Thinking（基于命令） |
| 配置文件 | 2 | `strict`（只读沙箱）和 `yolo`（完全自动批准） |
| 代理角色 | 3 | `.codex/agents/` —— explorer, reviewer, docs-researcher |

### 技能

位于 `.agents/skills/` 的技能会被 Codex 自动加载：

`claude-api`、`frontend-design` 和 `skill-creator` 等 Anthropic 官方技能不会在此重复打包。需要这些官方版本时，请从 [`anthropics/skills`](https://github.com/anthropics/skills) 安装。

| 技能 | 描述 |
|-------|-------------|
| agent-introspection-debugging | 调试智能体行为、路由和提示边界 |
| agent-sort | 整理智能体目录和分配表面 |
| api-design | REST API 设计模式 |
| article-writing | 根据笔记和语音参考进行长文写作 |
| backend-patterns | API 设计、数据库、缓存 |
| brand-voice | 从真实内容中提取来源驱动的写作风格 |
| bun-runtime | Bun 运行时、包管理器、打包器和测试运行器 |
| coding-standards | 通用编码标准 |
| content-engine | 平台原生的社交内容和再利用 |
| crosspost | X、LinkedIn、Threads 等多平台内容分发 |
| deep-research | 多源研究、综合和来源归属 |
| dmux-workflows | 使用 tmux pane manager 进行多智能体编排 |
| documentation-lookup | 通过 Context7 MCP 获取最新库和框架文档 |
| e2e-testing | Playwright 端到端测试 |
| eval-harness | 评估驱动的开发 |
| everything-claude-code | ECC 项目的开发约定和模式 |
| exa-search | 通过 Exa MCP 进行网络、代码和公司研究 |
| fal-ai-media | 图像、视频和音频的统一媒体生成 |
| frontend-patterns | React/Next.js 模式 |
| frontend-slides | HTML 演示文稿、PPTX 转换、视觉风格探索 |
| investor-materials | 幻灯片、备忘录、模型和一页纸文档 |
| investor-outreach | 个性化外联、跟进和介绍摘要 |
| market-research | 带来源归属的市场和竞争对手研究 |
| mcp-server-patterns | 使用 Node/TypeScript SDK 构建 MCP 服务器 |
| nextjs-turbopack | Next.js 16+ 和 Turbopack 增量打包 |
| product-capability | 将产品目标转化为有范围的能力图 |
| security-review | 全面的安全检查清单 |
| strategic-compact | 上下文管理 |
| tdd-workflow | 测试驱动开发，覆盖率 80%+ |
| verification-loop | 构建、测试、代码检查、类型检查、安全 |
| video-editing | 使用 FFmpeg 和 Remotion 的 AI 辅助视频编辑工作流 |
| x-api | X/Twitter 发帖和分析 API 集成 |

### 关键限制

Codex **尚未提供与 Claude 风格同等的钩子执行功能**。ECC 在该平台上的强制执行是通过 `AGENTS.md`、可选的 `model_instructions_file` 覆盖以及沙箱/批准设置以指令方式实现的。

### 多代理支持

当前的 Codex 版本支持实验性的多代理工作流。

* 在 `.codex/config.toml` 中启用 `features.multi_agent = true`
* 在 `[agents.<name>]` 下定义角色
* 将每个角色指向 `.codex/agents/` 下的一个文件
* 在 CLI 中使用 `/agent` 来检查或引导子代理

ECC 附带了三个示例角色配置：

| 角色 | 目的 |
|------|---------|
| `explorer` | 在进行编辑前进行只读的代码库证据收集 |
| `reviewer` | 正确性、安全性和缺失测试的审查 |
| `docs_researcher` | 在发布/文档更改前进行文档和 API 验证 |

***

## OpenCode 支持

ECC 提供 **完整的 OpenCode 支持**，包括插件和钩子。

### 快速开始

```bash
# Install OpenCode
npm install -g opencode

# Run in the repository root
opencode
```

配置会自动从 `.opencode/opencode.json` 检测。

### 功能对等

| 功能特性 | Claude Code   | OpenCode | 状态 |
|---------|---------------|----------|--------|
| 智能体 | PASS: 65 个    | PASS: 12 个 | **Claude Code 领先** |
| 命令 | PASS: 84 个    | PASS: 35 个 | **Claude Code 领先** |
| 技能 | PASS: 262 项   | PASS: 37 项 | **Claude Code 领先** |
| 钩子 | PASS: 8 种事件类型 | PASS: 11 种事件 | **OpenCode 更多！** |
| 规则 | PASS: 29 条    | PASS: 13 条指令 | **Claude Code 领先** |
| MCP 服务器 | PASS: 14 个    | PASS: 完整 | **完全对等** |
| 自定义工具 | PASS: 通过钩子    | PASS: 6 个原生工具 | **OpenCode 更优** |

### 通过插件实现的钩子支持

OpenCode 的插件系统比 Claude Code 更复杂，有 20 多种事件类型：

| Claude Code 钩子 | OpenCode 插件事件 |
|-----------------|----------------------|
| PreToolUse | `tool.execute.before` |
| PostToolUse | `tool.execute.after` |
| Stop | `session.idle` |
| SessionStart | `session.created` |
| SessionEnd | `session.deleted` |

**额外的 OpenCode 事件**：`file.edited`、`file.watcher.updated`、`message.updated`、`lsp.client.diagnostics`、`tui.toast.show` 等等。

### 维护中的斜杠命令

| 命令 | 描述 |
|---------|-------------|
| `/plan` | 创建实施计划 |
| `/code-review` | 审查代码变更 |
| `/build-fix` | 修复构建错误 |
| `/refactor-clean` | 移除死代码 |
| `/learn` | 从会话中提取模式 |
| `/checkpoint` | 保存验证状态 |
| `/quality-gate` | 运行维护中的验证门禁 |
| `/update-docs` | 更新文档 |
| `/update-codemaps` | 更新代码地图 |
| `/test-coverage` | 分析覆盖率 |
| `/go-review` | Go 代码审查 |
| `/go-test` | Go TDD 工作流 |
| `/go-build` | 修复 Go 构建错误 |
| `/python-review` | Python 代码审查（PEP 8、类型提示、安全性） |
| `/multi-plan` | 多模型协作规划 |
| `/multi-execute` | 多模型协作执行 |
| `/multi-backend` | 后端聚焦的多模型工作流 |
| `/multi-frontend` | 前端聚焦的多模型工作流 |
| `/multi-workflow` | 完整的多模型开发工作流 |
| `/pm2` | 自动生成 PM2 服务命令 |
| `/sessions` | 管理会话历史 |
| `/skill-create` | 从 git 生成技能 |
| `/instinct-status` | 查看已学习的本能 |
| `/instinct-import` | 导入本能 |
| `/instinct-export` | 导出本能 |
| `/evolve` | 将本能聚类为技能 |
| `/promote` | 将项目本能提升到全局范围 |
| `/projects` | 列出已知项目和本能统计信息 |
| `/learn-eval` | 保存前提取和评估模式 |
| `/setup-pm` | 配置包管理器 |
| `/harness-audit` | 审计平台可靠性、评估准备情况和风险状况 |
| `/loop-start` | 启动受控的智能体循环执行模式 |
| `/loop-status` | 检查活动循环状态和检查点 |
| `/quality-gate` | 对路径或整个仓库运行质量门检查 |
| `/model-route` | 根据复杂度和预算将任务路由到模型 |

### 插件安装

**选项 1：直接使用**

```bash
cd everything-claude-code
opencode
```

**选项 2：作为 npm 包安装**

```bash
npm install ecc-universal
```

然后添加到您的 `opencode.json`：

```json
{
  "plugin": ["ecc-universal"]
}
```

该 npm 插件条目启用了 ECC 发布的 OpenCode 插件模块（钩子/事件和插件工具）。
它**不会**自动将 ECC 的完整命令/代理/指令目录添加到您的项目配置中。

要获得完整的 ECC OpenCode 设置，您可以：

* 在此仓库内运行 OpenCode，或者
* 将捆绑的 `.opencode/` 配置资源复制到您的项目中，并在 `opencode.json` 中连接 `instructions`、`agent` 和 `command` 条目

### 文档

* **迁移指南**：`.opencode/MIGRATION.md`
* **OpenCode 插件 README**：`.opencode/README.md`
* **整合的规则**：`.opencode/instructions/INSTRUCTIONS.md`
* **LLM 文档**：`llms.txt`（完整的 OpenCode 文档，供 LLM 使用）

***

## 跨工具功能对等

ECC 是**第一个最大化利用每个主要 AI 编码工具的插件**。以下是每个平台的比较：

| 功能特性 | Claude Code           | Cursor IDE | Codex CLI | OpenCode |
|---------|-----------------------|------------|-----------|----------|
| **智能体** | 65                    | 共享 (AGENTS.md) | 共享 (AGENTS.md) | 12 |
| **命令** | 84                    | 共享 | 基于指令 | 35 |
| **技能** | 262                   | 共享 | 10 (原生格式) | 37 |
| **钩子事件** | 8 种类型                 | 15 种类型 | 暂无 | 11 种类型 |
| **钩子脚本** | 20+ 个脚本               | 16 个脚本 (DRY 适配器) | N/A | 插件钩子 |
| **规则** | 34 (通用 + 语言)          | 34 (YAML 前页) | 基于指令 | 13 条指令 |
| **自定义工具** | 通过钩子                  | 通过钩子 | N/A | 6 个原生工具 |
| **MCP 服务器** | 14                    | 共享 (mcp.json) | 4 (基于命令) | 完整 |
| **配置格式** | settings.json         | hooks.json + rules/ | config.toml | opencode.json |
| **上下文文件** | CLAUDE.md + AGENTS.md | AGENTS.md | AGENTS.md | AGENTS.md |
| **秘密检测** | 基于钩子                  | beforeSubmitPrompt 钩子 | 基于沙箱 | 基于钩子 |
| **自动格式化** | PostToolUse 钩子        | afterFileEdit 钩子 | N/A | file.edited 钩子 |
| **版本** | 插件 | 插件 | 参考配置 | 2.0.0 |

**关键架构决策：**

* **AGENTS.md** 在根目录是通用的跨工具文件（所有 4 个工具都能读取）
* **DRY 适配器模式** 让 Cursor 可以重用 Claude Code 的钩子脚本而无需重复
* **技能格式**（带有 YAML 前言的 SKILL.md）在 Claude Code、Codex 和 OpenCode 中都能工作
* Codex 缺少钩子功能，通过 `AGENTS.md`、可选的 `model_instructions_file` 覆盖以及沙箱权限来弥补

***

## 背景

我从实验性推出以来就一直在使用 Claude Code。在 2025 年 9 月，与 [@DRodriguezFX](https://x.com/DRodriguezFX) 一起使用 Claude Code 构建 [zenith.chat](https://zenith.chat)，赢得了 Anthropic x Forum Ventures 黑客马拉松。

这些配置已在多个生产应用程序中经过实战测试。

## 灵感致谢

* 灵感来自 [zarazhangrui](https://github.com/zarazhangrui)
* homunculus 灵感来自 [humanplane](https://github.com/humanplane)

***

## 令牌优化

如果不管理令牌消耗，使用 Claude Code 可能会很昂贵。这些设置能在不牺牲质量的情况下显著降低成本。

### 推荐设置

添加到 `~/.claude/settings.json`：

```json
{
  "model": "sonnet",
  "env": {
    "MAX_THINKING_TOKENS": "10000",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "50"
  }
}
```

| 设置 | 默认值 | 推荐值 | 影响 |
|---------|---------|-------------|--------|
| `model` | opus | **sonnet** | 约 60% 的成本降低；处理 80%+ 的编码任务 |
| `MAX_THINKING_TOKENS` | 31,999 | **10,000** | 每个请求的隐藏思考成本降低约 70% |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | 95 | **50** | 更早压缩 —— 在长会话中质量更好 |

仅在需要深度架构推理时切换到 Opus：

```
/model opus
```

### 日常工作流命令

| 命令 | 何时使用 |
|---------|-------------|
| `/model sonnet` | 大多数任务的默认选择 |
| `/model opus` | 复杂架构、调试、深度推理 |
| `/clear` | 在不相关的任务之间（免费，即时重置） |
| `/compact` | 在逻辑任务断点处（研究完成，里程碑达成） |
| `/cost` | 在会话期间监控令牌花费 |

### 策略性压缩

`strategic-compact` 技能（包含在此插件中）建议在逻辑断点处进行 `/compact`，而不是依赖在 95% 上下文时的自动压缩。完整决策指南请参见 `skills/strategic-compact/SKILL.md`。

**何时压缩：**

* 研究/探索之后，实施之前
* 完成一个里程碑之后，开始下一个之前
* 调试之后，继续功能工作之前
* 失败的方法之后，尝试新方法之前

**何时不压缩：**

* 实施过程中（你会丢失变量名、文件路径、部分状态）

### 上下文窗口管理

**关键：** 不要一次性启用所有 MCP。每个 MCP 工具描述都会消耗你 200k 窗口的令牌，可能将其减少到约 70k。

* 每个项目保持启用的 MCP 少于 10 个
* 保持活动工具少于 80 个
* 在项目配置中使用 `disabledMcpServers` 来禁用未使用的 MCP

### 代理团队成本警告

代理团队会生成多个上下文窗口。每个团队成员独立消耗令牌。仅用于并行性能提供明显价值的任务（多模块工作、并行审查）。对于简单的顺序任务，子代理更节省令牌。

***

## WARNING: 重要说明

### 令牌优化

达到每日限制？参见 **[令牌优化指南](../token-optimization.md)** 获取推荐设置和工作流提示。

快速见效的方法：

```json
// ~/.claude/settings.json
{
  "model": "sonnet",
  "env": {
    "MAX_THINKING_TOKENS": "10000",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "50",
    "CLAUDE_CODE_SUBAGENT_MODEL": "haiku"
  }
}
```

在不相关的任务之间使用 `/clear`，在逻辑断点处使用 `/compact`，并使用 `/cost` 来监控花费。

### 定制化

这些配置适用于我的工作流。你应该：

1. 从引起共鸣的部分开始
2. 根据你的技术栈进行修改
3. 移除你不使用的部分
4. 添加你自己的模式

***

## 赞助商

这个项目是免费和开源的。赞助商帮助保持其维护和发展。

[**成为赞助商**](https://github.com/sponsors/affaan-m) | [赞助层级](SPONSORS.md) | [赞助计划](SPONSORING.md)

***

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=affaan-m/everything-claude-code\&type=Date)](https://star-history.com/#affaan-m/everything-claude-code\&Date)

***

## 链接

* **速查指南（从这里开始）：** [Claude Code 速查指南](https://x.com/affaanmustafa/status/2012378465664745795)
* **详细指南（进阶）：** [Claude Code 详细指南](https://x.com/affaanmustafa/status/2014040193557471352)
* **关注：** [@affaanmustafa](https://x.com/affaanmustafa)
* **zenith.chat：** [zenith.chat](https://zenith.chat)
* **技能目录：** awesome-agent-skills（社区维护的智能体技能目录）

***

## 许可证

MIT - 自由使用，根据需要修改，如果可以请回馈贡献。

***

**如果此仓库对你有帮助，请点星。阅读两份指南。构建伟大的东西。**
