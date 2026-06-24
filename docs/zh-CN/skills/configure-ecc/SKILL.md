---
name: configure-ecc
description: Everything Claude Code 的交互式安装程序 — 引导用户选择并安装技能和规则到用户级或项目级目录，验证路径，并可选择优化已安装文件。
origin: ECC
---

# 配置 Everything Claude Code (ECC)

一个交互式、分步安装向导，用于 Everything Claude Code 项目。使用 `AskUserQuestion` 引导用户选择性安装技能和规则，然后验证正确性并提供优化。

## 何时激活

* 用户说 "configure ecc"、"install ecc"、"setup everything claude code" 或类似表述
* 用户想要从此项目中选择性安装技能或规则
* 用户想要验证或修复现有的 ECC 安装
* 用户想要为其项目优化已安装的技能或规则

## 先决条件

此技能必须在激活前对 Claude Code 可访问。有两种引导方式：

1. **通过插件**: `/plugin install ecc@ecc` — 插件会自动加载此技能
2. **手动**: 仅将此技能复制到 `~/.claude/skills/configure-ecc/SKILL.md`，然后通过说 "configure ecc" 激活

***

## 步骤 0：克隆 ECC 仓库

在任何安装之前，将最新的 ECC 源代码克隆到 `/tmp`：

```bash
rm -rf /tmp/everything-claude-code
git clone https://github.com/affaan-m/everything-claude-code.git /tmp/everything-claude-code
```

将 `ECC_ROOT=/tmp/everything-claude-code` 设置为所有后续复制操作的源。

如果克隆失败（网络问题等），使用 `AskUserQuestion` 要求用户提供现有 ECC 克隆的本地路径。

***

## 步骤 1：选择安装级别

使用 `AskUserQuestion` 询问用户安装位置：

```
问题："ECC组件应安装在哪里？"
选项：
  - "用户级别 (~/.claude/)" — "适用于您所有的Claude Code项目"
  - "项目级别 (.claude/)" — "仅适用于当前项目"
  - "两者" — "通用/共享项在用户级别，项目特定项在项目级别"
```

将选择存储为 `INSTALL_LEVEL`。设置目标目录：

* 用户级别：`TARGET=~/.claude`
* 项目级别：`TARGET=.claude`（相对于当前项目根目录）
* 两者：`TARGET_USER=~/.claude`，`TARGET_PROJECT=.claude`

如果目标目录不存在，则创建它们：

```bash
mkdir -p $TARGET/skills $TARGET/rules
```

***

## 步骤 2：选择并安装技能

### 2a: 选择范围（核心 vs 细分领域）

默认为 **核心（推荐给新用户）** — 对于研究优先的工作流，复制 `.agents/skills/*` 加上 `skills/search-first/`。此捆绑包涵盖工程、评估、验证、安全、战略压缩、前端设计以及 Anthropic 跨职能技能（文章写作、内容引擎、市场研究、前端幻灯片）。

使用 `AskUserQuestion`（单选）：

```
问题："只安装核心技能，还是包含小众/框架包？"
选项：
  - "仅核心（推荐）" — "tdd, e2e, evals, verification, research-first, security, frontend patterns, compacting, cross-functional Anthropic skills"
  - "核心 + 精选小众" — "在核心基础上添加框架/领域特定技能"
  - "仅小众" — "跳过核心，安装特定框架/领域技能"
默认：仅核心
```

如果用户选择细分领域或核心 + 细分领域，则继续下面的类别选择，并且仅包含他们选择的那些细分领域技能。

### 2b: 选择技能类别

下方有7个可选的类别组。后续的详细确认列表涵盖了8个类别中的45项技能，外加1个独立模板。使用 `AskUserQuestion` 与 `multiSelect: true`：

```
问题：“您希望安装哪些技能类别？”
选项：
  - “框架与语言” — “Django, Laravel, Spring Boot, Go, Python, Java, 前端, 后端模式”
  - “数据库” — “PostgreSQL, ClickHouse, JPA/Hibernate 模式”
  - “工作流与质量” — “TDD, 验证, 学习, 安全审查, 压缩”
  - “研究与 API” — “深度研究, Exa 搜索, Claude API 模式”
  - “社交与内容分发” — “X/Twitter API, 内容引擎并行交叉发布”
  - “媒体生成” — “fal.ai 图像/视频/音频与 VideoDB 并行”
  - “编排” — “dmux 多智能体工作流”
  - “所有技能” — “安装所有可用技能”
```

### 2c: 确认个人技能

对于每个选定的类别，打印下面的完整技能列表，并要求用户确认或取消选择特定的技能。如果列表超过 4 项，将列表打印为文本，并使用 `AskUserQuestion`，提供一个 "安装所有列出项" 的选项，以及一个 "其他" 选项供用户粘贴特定名称。

**类别：框架与语言（21项技能）**

| 技能 | 描述 |
|-------|-------------|
| `backend-patterns` | Node.js/Express/Next.js 的后端架构、API 设计、服务器端最佳实践 |
| `coding-standards` | TypeScript、JavaScript、React、Node.js 的通用编码标准 |
| `django-patterns` | Django 架构、使用 DRF 的 REST API、ORM、缓存、信号、中间件 |
| `django-security` | Django 安全性：认证、CSRF、SQL 注入、XSS 防护 |
| `django-tdd` | 使用 pytest-django、factory\_boy、模拟、覆盖率进行 Django 测试 |
| `django-verification` | Django 验证循环：迁移、代码检查、测试、安全扫描 |
| `laravel-patterns` | Laravel 架构模式：路由、控制器、Eloquent、队列、缓存 |
| `laravel-security` | Laravel 安全性：认证、策略、CSRF、批量赋值、速率限制 |
| `laravel-tdd` | 使用 PHPUnit 和 Pest、工厂、假对象、覆盖率进行 Laravel 测试 |
| `laravel-verification` | Laravel 验证：代码检查、静态分析、测试、安全扫描 |
| `frontend-patterns` | React、Next.js、状态管理、性能、UI 模式 |
| `frontend-slides` | 零依赖的 HTML 演示文稿、样式预览以及 PPTX 到网页的转换 |
| `golang-patterns` | 地道的 Go 模式、构建稳健 Go 应用程序的约定 |
| `golang-testing` | Go 测试：表驱动测试、子测试、基准测试、模糊测试 |
| `java-coding-standards` | Spring Boot 的 Java 编码标准：命名、不可变性、Optional、流 |
| `python-patterns` | Pythonic 惯用法、PEP 8、类型提示、最佳实践 |
| `python-testing` | 使用 pytest、TDD、夹具、模拟、参数化进行 Python 测试 |
| `quarkus-patterns` | Quarkus 架构、使用 Camel 的事件驱动模式、Panache 数据访问、CDI 服务 |
| `quarkus-security` | Quarkus 安全：JWT/OIDC 认证、RBAC、Bean 验证、CORS、密钥管理 |
| `quarkus-tdd` | 使用 JUnit 5、Mockito、REST Assured、Camel 测试进行 Quarkus TDD |
| `quarkus-verification` | Quarkus 验证：构建、静态分析、测试、安全扫描、原生编译 |
| `springboot-patterns` | Spring Boot 架构、REST API、分层服务、缓存、异步处理 |
| `springboot-security` | Spring Security：认证/授权、验证、CSRF、密钥、速率限制 |
| `springboot-tdd` | 使用 JUnit 5、Mockito、MockMvc、Testcontainers 进行 Spring Boot TDD |
| `springboot-verification` | Spring Boot 验证：构建、静态分析、测试、安全扫描 |

**类别：数据库（3 项技能）**

| 技能 | 描述 |
|-------|-------------|
| `clickhouse-io` | ClickHouse 模式、查询优化、分析、数据工程 |
| `jpa-patterns` | JPA/Hibernate 实体设计、关系、查询优化、事务 |
| `postgres-patterns` | PostgreSQL 查询优化、模式设计、索引、安全 |

**类别：工作流与质量（8 项技能）**

| 技能 | 描述 |
|-------|-------------|
| `continuous-learning` | 从会话中自动提取可重用模式作为习得技能 |
| `continuous-learning-v2` | 基于本能的学习，带有置信度评分，演变为技能/命令/代理 |
| `eval-harness` | 用于评估驱动开发 (EDD) 的正式评估框架 |
| `iterative-retrieval` | 用于子代理上下文问题的渐进式上下文优化 |
| `security-review` | 安全检查清单：身份验证、输入、密钥、API、支付功能 |
| `strategic-compact` | 在逻辑间隔处建议手动上下文压缩 |
| `tdd-workflow` | 强制要求 TDD，覆盖率 80% 以上：单元测试、集成测试、端到端测试 |
| `verification-loop` | 验证和质量循环模式 |

**类别：业务与内容（5 项技能）**

| 技能 | 描述 |
|-------|-------------|
| `article-writing` | 使用笔记、示例或源文档，以指定的口吻进行长篇写作 |
| `content-engine` | 多平台社交内容、脚本和内容再利用工作流 |
| `market-research` | 带有来源标注的市场、竞争对手、基金和技术研究 |
| `investor-materials` | 宣传文稿、一页简介、投资者备忘录和财务模型 |
| `investor-outreach` | 个性化的投资者冷邮件、熟人介绍和后续跟进 |

**类别：研究与API（2项技能）**

| 技能 | 描述 |
|-------|-------------|
| `deep-research` | 使用 firecrawl 和 exa MCP 进行多源深度研究，并生成带引用的报告 |
| `exa-search` | 通过 Exa MCP 进行网络、代码、公司和人员的神经搜索 |

`claude-api` 是 Anthropic 官方技能；需要时请从 [`anthropics/skills`](https://github.com/anthropics/skills) 安装官方版本，而不是通过 ECC 重复打包。

**类别：社交与内容分发（2项技能）**

| 技能 | 描述 |
|-------|-------------|
| `x-api` | X/Twitter API 集成，用于发帖、线程、搜索和分析 |
| `crosspost` | 多平台内容分发，并进行平台原生适配 |

**类别：媒体生成（2项技能）**

| 技能 | 描述 |
|-------|-------------|
| `fal-ai-media` | 通过 fal.ai MCP 进行统一的AI媒体生成（图像、视频、音频） |
| `video-editing` | AI辅助视频编辑，用于剪辑、结构化和增强实拍素材 |

**类别：编排（1项技能）**

| 技能 | 描述 |
|-------|-------------|
| `dmux-workflows` | 使用 dmux 进行多智能体编排，实现并行智能体会话 |

**独立技能**

| 技能 | 描述 |
|-------|-------------|
| `docs/examples/project-guidelines-template.md` | 用于创建项目特定技能的模板 |

### 2d: 执行安装

对于每个选定的技能，请从正确的源目录复制整个技能目录：

```bash
# 核心技能位于 .agents/skills/
cp -R "$ECC_ROOT/.agents/skills/<skill-name>" "$TARGET/skills/"

# 细分技能位于 skills/
cp -R "$ECC_ROOT/skills/<skill-name>" "$TARGET/skills/"
```

遍历 glob 得到的源目录时，不要把带 trailing slash 的源路径直接传给 `cp`。显式使用目录名作为目标名：

```bash
cp -R "${src%/}" "$TARGET/skills/$(basename "${src%/}")"
```

注意：`continuous-learning` 和 `continuous-learning-v2` 有额外的文件（config.json、钩子、脚本）——确保复制整个目录，而不仅仅是 SKILL.md。

***

## 步骤 3：选择并安装规则

使用 `AskUserQuestion` 和 `multiSelect: true`：

```
问题："您希望安装哪些规则集？"
选项：
  - "通用规则（推荐）" — "语言无关原则：编码风格、Git工作流、测试、安全等（8个文件）"
  - "TypeScript/JavaScript" — "TS/JS模式、钩子、Playwright测试（5个文件）"
  - "Python" — "Python模式、pytest、black/ruff格式化（5个文件）"
  - "Go" — "Go模式、表驱动测试、gofmt/staticcheck（5个文件）"
```

执行安装：

```bash
# Common rules
cp -r $ECC_ROOT/rules/common $TARGET/rules/common

# Language-specific rules (preserve per-language directories)
cp -r $ECC_ROOT/rules/typescript $TARGET/rules/typescript   # if selected
cp -r $ECC_ROOT/rules/python $TARGET/rules/python            # if selected
cp -r $ECC_ROOT/rules/golang $TARGET/rules/golang            # if selected
```

**重要**：如果用户选择了任何特定语言的规则但**没有**选择通用规则，警告他们：

> "特定语言规则扩展了通用规则。不安装通用规则可能导致覆盖不完整。是否也安装通用规则？"

***

## 步骤 4：安装后验证

安装后，执行这些自动化检查：

### 4a：验证文件存在

列出所有已安装的文件并确认它们存在于目标位置：

```bash
ls -la $TARGET/skills/
ls -la $TARGET/rules/
```

### 4b：检查路径引用

扫描所有已安装的 `.md` 文件中的路径引用：

```bash
grep -rn "~/.claude/" $TARGET/skills/ $TARGET/rules/
grep -rn "../common/" $TARGET/rules/
grep -rn "skills/" $TARGET/skills/
```

**对于项目级别安装**，标记任何对 `~/.claude/` 路径的引用：

* 如果技能引用 `~/.claude/settings.json` — 这通常没问题（设置始终是用户级别的）
* 如果技能引用 `~/.claude/skills/` 或 `~/.claude/rules/` — 如果仅安装在项目级别，这可能损坏
* 如果技能通过名称引用另一项技能 — 检查被引用的技能是否也已安装

### 4c：检查技能间的交叉引用

有些技能会引用其他技能。验证这些依赖关系：

* `django-tdd` 可能会引用 `django-patterns`
* `laravel-tdd` 可能会引用 `laravel-patterns`
* `quarkus-tdd` 可能会引用 `quarkus-patterns`
* `springboot-tdd` 可能会引用 `springboot-patterns`
* `continuous-learning-v2` 引用 `~/.claude/homunculus/` 目录
* `python-testing` 可能会引用 `python-patterns`
* `golang-testing` 可能会引用 `golang-patterns`
* `crosspost` 引用 `content-engine` 和 `x-api`
* `deep-research` 引用 `exa-search`（补充的 MCP 工具）
* `fal-ai-media` 引用 `videodb`（补充的媒体技能）
* `x-api` 引用 `content-engine` 和 `crosspost`
* 特定语言的规则引用 `common/` 的对应内容

### 4d：报告问题

对于发现的每个问题，报告：

1. **文件**：包含问题引用的文件
2. **行号**：行号
3. **问题**：哪里出错了（例如，"引用了 ~/.claude/skills/python-patterns 但 python-patterns 未安装"）
4. **建议的修复**：该怎么做（例如，"安装 python-patterns 技能" 或 "将路径更新为 .claude/skills/"）

***

## 步骤 5：优化已安装文件（可选）

使用 `AskUserQuestion`：

```
问题："您想要优化项目中的已安装文件吗？"
选项：
  - "优化技能" — "移除无关部分，调整路径，适配您的技术栈"
  - "优化规则" — "调整覆盖目标，添加项目特定模式，自定义工具配置"
  - "两者都优化" — "对所有已安装文件进行全面优化"
  - "跳过" — "保持原样不变"
```

### 如果优化技能：

1. 读取每个已安装的 SKILL.md
2. 询问用户其项目的技术栈是什么（如果尚不清楚）
3. 对于每项技能，建议删除无关部分
4. 在安装目标处就地编辑 SKILL.md 文件（**不是**源仓库）
5. 修复在步骤 4 中发现的任何路径问题

### 如果优化规则：

1. 读取每个已安装的规则 .md 文件
2. 询问用户的偏好：
   * 测试覆盖率目标（默认 80%）
   * 首选的格式化工具
   * Git 工作流约定
   * 安全要求
3. 在安装目标处就地编辑规则文件

**关键**：只修改安装目标（`$TARGET/`）中的文件，**绝不**修改源 ECC 仓库（`$ECC_ROOT/`）中的文件。

***

## 步骤 6：安装摘要

从 `/tmp` 清理克隆的仓库：

```bash
rm -rf /tmp/everything-claude-code
```

然后打印摘要报告：

```
## ECC 安装完成

### 安装目标
- 级别：[用户级别 / 项目级别 / 两者]
- 路径：[目标路径]

### 已安装技能 ([数量])
- 技能-1, 技能-2, 技能-3, ...

### 已安装规则 ([数量])
- 通用规则 (8 个文件)
- TypeScript 规则 (5 个文件)
- ...

### 验证结果
- 发现 [数量] 个问题，已修复 [数量] 个
- [列出任何剩余问题]

### 已应用的优化
- [列出所做的更改，或 "无"]
```

***

## 故障排除

### "Claude Code 未获取技能"

* 验证技能目录包含一个 `SKILL.md` 文件（不仅仅是松散的 .md 文件）
* 对于用户级别：检查 `~/.claude/skills/<skill-name>/SKILL.md` 是否存在
* 对于项目级别：检查 `.claude/skills/<skill-name>/SKILL.md` 是否存在

### "规则不工作"

* 规则是平面文件，不在子目录中：`$TARGET/rules/coding-style.md`（正确）对比 `$TARGET/rules/common/coding-style.md`（对于平面安装不正确）
* 安装规则后重启 Claude Code

### "项目级别安装后出现路径引用错误"

* 有些技能假设 `~/.claude/` 路径。运行步骤 4 验证来查找并修复这些问题。
* 对于 `continuous-learning-v2`，`~/.claude/homunculus/` 目录始终是用户级别的 — 这是预期的，不是错误。
