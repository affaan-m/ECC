---
name: prompt-optimizer
description: 分析原始提示，识别意图和差距，匹配ECC组件（技能/命令/代理/钩子），并输出一个可直接粘贴的优化提示。仅提供咨询角色——绝不自行执行任务。触发时机：当用户说“优化提示”、“改进我的提示”、“如何编写提示”、“帮我优化这个指令”或明确要求提高提示质量时。中文等效表达同样触发：“优化prompt”、“改进prompt”、“怎么写prompt”、“帮我优化这个指令”。不触发时机：当用户希望直接执行任务，或说“直接做”时。不触发时机：当用户说“优化代码”、“优化性能”、“optimize performance”、“optimize this code”时——这些是重构/性能优化任务，而非提示优化。
origin: community
metadata:
  author: YannJY02
  version: "1.0.0"
---

# Prompt 优化器

分析一个草稿提示，对其进行评估，匹配到 ECC 生态系统组件，并输出一个完整的优化提示供用户复制粘贴并运行。

## 何时使用

* 用户说“优化这个提示”、“改进我的提示”、“重写这个提示”
* 用户说“帮我写一个更好的提示来...”
* 用户说“询问 Claude Code 的...最佳方式是什么？”
* 用户说“优化prompt”、“改进prompt”、“怎么写prompt”、“帮我优化这个指令”
* 用户粘贴一个草稿提示并要求反馈或改进
* 用户说“我不知道如何为此编写提示”
* 用户说“我应该如何使用 ECC 来...”
* 用户明确调用 `/prompt-optimize`

### 不要用于

* 用户希望直接执行任务（直接执行即可）
* 用户说“优化代码”、“优化性能”、“optimize this code”、“optimize performance”——这些是重构任务，不是提示优化
* 用户询问 ECC 配置（改用 `configure-ecc`）
* 用户想要技能清单（改用 `skill-stocktake`）
* 用户说“直接做”或“just do it”

## 工作原理

**仅提供建议——不要执行用户的任务。**

不要编写代码、创建文件、运行命令或采取任何实现行动。你的**唯一**输出是分析加上一个优化后的提示。

如果用户说“直接做”、“just do it”或“不要优化，直接执行”，不要在此技能内切换到实现模式。告诉用户此技能只生成优化提示，并指示他们如果要执行任务，请提出正常的任务请求。

按顺序运行这个 6 阶段流程。使用下面的输出格式呈现结果。

### 分析流程

### 阶段 0：项目检测

在分析提示之前，检测当前项目上下文：

1. 检查工作目录中是否存在 `CLAUDE.md`——读取它以了解项目惯例
2. 从项目文件中检测技术栈：
   * `package.json` → Node.js / TypeScript / React / Next.js
   * `go.mod` → Go
   * `pyproject.toml` / `requirements.txt` → Python
   * `Cargo.toml` → Rust
   * `build.gradle` / `pom.xml` → Java / Kotlin（然后检查构建文件中的`quarkus` → Quarkus，或`spring-boot` → Spring Boot）
   * `Package.swift` → Swift
   * `Gemfile` → Ruby
   * `composer.json` → PHP
   * `*.csproj` / `*.sln` → .NET
   * `Makefile` / `CMakeLists.txt` → C / C++
   * `cpanfile` / `Makefile.PL` → Perl
3. 记录检测到的技术栈，用于阶段 3 和阶段 4

如果未找到项目文件（例如，提示是抽象的或用于新项目），则跳过检测并在阶段 4 标记“技术栈未知”。

### 阶段 1：意图检测

将用户的任务分类为一个或多个类别：

| 类别 | 信号词 | 示例 |
|----------|-------------|---------|
| 新功能 | build, create, add, implement, 创建, 实现, 添加 | "Build a login page" |
| 错误修复 | fix, broken, not working, error, 修复, 报错 | "Fix the auth flow" |
| 重构 | refactor, clean up, restructure, 重构, 整理 | "Refactor the API layer" |
| 研究 | how to, what is, explore, investigate, 怎么, 如何 | "How to add SSO" |
| 测试 | test, coverage, verify, 测试, 覆盖率 | "Add tests for the cart" |
| 审查 | review, audit, check, 审查, 检查 | "Review my PR" |
| 文档 | document, update docs, 文档 | "Update the API docs" |
| 基础设施 | deploy, CI, docker, database, 部署, 数据库 | "Set up CI/CD pipeline" |
| 设计 | design, architecture, plan, 设计, 架构 | "Design the data model" |

### 阶段 2：范围评估

如果阶段 0 检测到项目，则使用代码库大小作为信号。否则，仅根据提示描述进行估算，并将估算标记为不确定。

| 范围 | 启发式判断 | 编排 |
|-------|-----------|---------------|
| 微小 | 单个文件，< 50 行 | 直接执行 |
| 低 | 单个组件或模块 | 单个命令或技能 |
| 中 | 多个组件，同一领域 | 命令链 + /verify |
| 高 | 跨领域，5+ 个文件 | 先使用 /plan，然后分阶段执行 |
| 史诗级 | 多会话，多 PR，架构性变更 | 使用蓝图技能制定多会话计划 |

### 阶段 3：ECC 组件匹配

将意图 + 范围 + 技术栈（来自阶段 0）映射到特定的 ECC 组件。

#### 按意图类型

| 意图 | 命令 | 技能 | 代理 |
|--------|----------|--------|--------|
| 新功能 | /plan, /tdd, /code-review, /verify | tdd-workflow, verification-loop | planner, tdd-guide, code-reviewer |
| 错误修复 | /tdd, /build-fix, /verify | tdd-workflow | tdd-guide, build-error-resolver |
| 重构 | /refactor-clean, /code-review, /verify | verification-loop | refactor-cleaner, code-reviewer |
| 研究 | /plan | search-first, iterative-retrieval | — |
| 测试 | /tdd, /e2e, /test-coverage | tdd-workflow, e2e-testing | tdd-guide, e2e-runner |
| 审查 | /code-review | security-review | code-reviewer, security-reviewer |
| 文档 | /update-docs, /update-codemaps | — | doc-updater |
| 基础设施 | /plan, /verify | docker-patterns, deployment-patterns, database-migrations | architect |
| 设计 (中-高) | /plan | — | planner, architect |
| 设计 (史诗级) | — | blueprint (作为技能调用) | planner, architect |

#### 按技术栈

| 技术栈 | 要添加的技能 | 代理 |
|------------|--------------|-------|
| Python / Django | django-patterns, django-tdd, django-security, django-verification, python-patterns, python-testing | python-reviewer |
| Go | golang-patterns, golang-testing | go-reviewer, go-build-resolver |
| Spring Boot / Java | springboot-patterns, springboot-tdd, springboot-security, springboot-verification, java-coding-standards, jpa-patterns | java-reviewer |
| Quarkus / Java | quarkus-patterns, quarkus-tdd, quarkus-security, quarkus-verification, java-coding-standards, jpa-patterns | java-reviewer |
| Kotlin / Android | kotlin-coroutines-flows, compose-multiplatform-patterns, android-clean-architecture | kotlin-reviewer |
| TypeScript / React | frontend-patterns, backend-patterns, coding-standards | code-reviewer |
| Swift / iOS | swiftui-patterns, swift-concurrency-6-2, swift-actor-persistence, swift-protocol-di-testing | code-reviewer |
| PostgreSQL | postgres-patterns, database-migrations | database-reviewer |
| Perl | perl-patterns, perl-testing, perl-security | code-reviewer |
| C++ | cpp-coding-standards, cpp-testing | code-reviewer |
| 其他 / 未列出 | coding-standards (通用) | code-reviewer |

### 阶段 4：缺失上下文检测

扫描提示中缺失的关键信息。检查每个项目，并标记是阶段 0 自动检测到的还是用户必须提供的：

* \[ ] **技术栈** —— 阶段 0 检测到的，还是用户必须指定？
* \[ ] **目标范围** —— 提到了文件、目录或模块吗？
* \[ ] **验收标准** —— 如何知道任务已完成？
* \[ ] **错误处理** —— 是否考虑了边界情况和故障模式？
* \[ ] **安全要求** —— 身份验证、输入验证、密钥？
* \[ ] **测试期望** —— 单元测试、集成测试、E2E？
* \[ ] **性能约束** —— 负载、延迟、资源限制？
* \[ ] **UI/UX 要求** —— 设计规范、响应式、无障碍访问？（如果是前端）
* \[ ] **数据库变更** —— 模式、迁移、索引？（如果是数据层）
* \[ ] **现有模式** —— 要遵循的参考文件或惯例？
* \[ ] **范围边界** —— 什么**不要**做？

**如果缺少 3 个以上关键项目**，则在生成优化提示之前询问用户最多 3 个澄清问题。然后将答案纳入优化提示中。

### 阶段 5：工作流和模型推荐

确定此提示在开发生命周期中的位置：

```
Research → Plan → Implement (TDD) → Review → Verify → Commit
```

对于中等级别及以上的任务，始终以 /plan 开始。对于史诗级任务，使用蓝图技能。

**模型推荐**（包含在输出中）：

| 范围 | 推荐模型 | 理由 |
|-------|------------------|-----------|
| 微小-低 | Sonnet 4.6 | 快速、成本效益高，适合简单任务 |
| 中 | Sonnet 4.6 | 标准工作的最佳编码模型 |
| 高 | Sonnet 4.6 (主) + Opus 4.6 (规划) | Opus 用于架构，Sonnet 用于实现 |
| 史诗级 | Opus 4.6 (蓝图) + Sonnet 4.6 (执行) | 深度推理用于多会话规划 |

**多提示拆分**（针对高/史诗级范围）：

对于超出单个会话的任务，拆分为顺序提示：

* 提示 1：研究 + 计划（使用 search-first 技能，然后 /plan）
* 提示 2-N：每个提示实现一个阶段（每个阶段以 /verify 结束）
* 最终提示：集成测试 + 跨所有阶段的 /code-review
* 使用 /save-session 和 /resume-session 在会话之间保存上下文

***

## 输出格式

按照此确切结构呈现你的分析。使用与用户输入相同的语言进行回应。

### 第 1 部分：提示诊断

**优点：** 列出原始提示做得好的地方。

**问题：**

| 问题 | 影响 | 建议的修复方法 |
|-------|--------|---------------|
| (问题) | (后果) | (如何修复) |

**需要澄清：** 用户应回答的问题编号列表。如果阶段 0 自动检测到答案，请陈述该答案而不是提问。

### 第 2 部分：推荐的 ECC 组件

| 类型 | 组件 | 目的 |
|------|-----------|---------|
| 命令 | /plan | 编码前规划架构 |
| 技能 | tdd-workflow | TDD 方法指导 |
| 代理 | code-reviewer | 实施后审查 |
| 模型 | Sonnet 4.6 | 针对此范围的推荐模型 |

### 第 3 部分：优化提示 —— 完整版本

在单个围栏代码块内呈现完整的优化提示。该提示必须是自包含的，可以复制粘贴。包括：

* 清晰的任务描述和上下文
* 技术栈（检测到的或指定的）
* 在正确工作流阶段调用的 /command
* 验收标准
* 验证步骤
* 范围边界（什么**不要**做）

对于引用蓝图的项目，写成：“使用蓝图技能来...”（而不是 `/blueprint`，因为蓝图是技能，不是命令）。

### 第 4 部分：优化提示 —— 快速版本

为有经验的 ECC 用户提供的紧凑版本。根据意图类型而变化：

| 意图 | 快速模式 |
|--------|--------------|
| 新功能 | `/plan [feature]. /tdd to implement. /code-review. /verify.` |
| 错误修复 | `/tdd — write failing test for [bug]. Fix to green. /verify.` |
| 重构 | `/refactor-clean [scope]. /code-review. /verify.` |
| 研究 | `Use search-first skill for [topic]. /plan based on findings.` |
| 测试 | `/tdd [module]. /e2e for critical flows. /test-coverage.` |
| 审查 | `/code-review. Then use security-reviewer agent.` |
| 文档 | `/update-docs. /update-codemaps.` |
| 史诗级 | `Use blueprint skill for "[objective]". Execute phases with /verify gates.` |

### 第 5 部分：改进理由

| 改进 | 理由 |
|-------------|--------|
| (添加了什么) | (为什么重要) |

### 页脚

> 不符合你的需求？告诉我需要调整什么，或者如果你想执行任务而不是优化提示，请提出正常的任务请求。

***

## 示例

### 触发示例

* "Optimize this prompt for ECC"
* "Rewrite this prompt so Claude Code uses the right commands"
* "帮我优化这个指令"
* "How should I prompt ECC for this task?"

### 示例 1：模糊的中文提示（检测到项目）

**用户输入：**

```
帮我写一个用户登录页面
```

**阶段 0 检测到：** `package.json`，使用 Next.js 15, TypeScript, Tailwind CSS

**优化提示（完整）：**

```
使用项目现有技术栈（Next.js 15 + TypeScript + Tailwind CSS）实现用户登录页面。

技术要求：
- 沿用项目现有的组件结构和路由约定
- 表单验证使用项目中已有的验证方案（检查是否已用 Zod/Yup/其他）
- 认证方式：沿用项目现有认证方案（如无，默认 JWT）
- 包含：邮箱/密码登录表单、表单验证、错误提示、加载状态、响应式布局

工作流：
1. /plan 先规划组件结构和认证流程，参考现有页面的模式
2. /tdd 测试先行：编写登录表单的单元测试和认证流程的集成测试
3. 实现登录页面和认证逻辑
4. /code-review 审查实现
5. /verify 验证所有测试通过且页面正常渲染

安全要求：
- 密码不明文传输
- 防止暴力破解（rate limiting）
- XSS 防护
- CSRF token

验收标准：
- 所有测试通过，覆盖率 80%+
- 页面在移动端和桌面端正常渲染
- 登录成功跳转到 dashboard，失败显示错误信息

不要做：
- 不要实现注册页面
- 不要实现忘记密码功能
- 不要修改现有的路由结构
```

### 示例 2：中等英文提示

**用户输入：**

```
添加一个用于用户资料更新的REST API端点，并包含验证功能。
```

**阶段 0 检测到：** `go.mod`，使用 Go 1.22, Chi router

**优化提示（完整）：**

```
添加用于用户资料更新的 REST API 端点（PATCH /api/users/:id）。

技术栈：Go 1.22 + Chi 路由器（根据项目检测得出）

要求：
- PATCH /api/users/:id — 部分更新用户资料
- 对字段进行输入验证：name、email、avatar_url、bio
- 身份验证：需要有效令牌，用户只能更新自己的资料
- 成功时返回 200 及更新后的用户信息
- 输入无效时返回 400 及验证错误信息
- 身份验证失败时返回 401/403
- 遵循代码库中现有的 API 模式

工作流程：
1. /plan 端点结构、中间件链和验证逻辑
2. /tdd — 为成功、验证失败、身份验证失败、未找到等情况编写表格驱动测试
3. 按照现有处理器模式实现
4. /go-review
5. /verify — 运行完整的测试套件，确认没有回归问题

禁止事项：
- 修改现有端点
- 更改数据库模式（使用现有的 user 表）
- 在未先检查现有依赖项的情况下添加新依赖（使用搜索优先技能）
```

### 示例 3：史诗级项目

**用户输入：**

```
将我们的单体架构迁移到微服务
```

**优化提示（完整）：**

```
使用蓝图技能规划：“将单体架构迁移至微服务架构”

在执行前，请在蓝图中回答以下问题：
1. 当前单体架构中存在哪些领域边界？
2. 应该首先提取哪个服务（耦合度最低）？
3. 通信模式：REST API、gRPC 还是事件驱动（Kafka/RabbitMQ）？
4. 数据库策略：初期使用共享数据库，还是一开始就采用“每个服务一个数据库”？
5. 部署目标：Kubernetes、Docker Compose 还是无服务器？

蓝图应生成如下阶段：
- 阶段 1：识别服务边界并创建领域映射
- 阶段 2：搭建基础设施（API 网关、服务网格、每个服务的 CI/CD）
- 阶段 3：提取第一个服务（采用绞杀者模式）
- 阶段 4：通过集成测试验证，然后提取下一个服务
- 阶段 N：停用单体架构

每个阶段 = 1 个 PR，阶段之间设置 /verify 检查点。
阶段之间使用 /save-session。使用 /resume-session 继续。
在依赖关系允许时，使用 git worktrees 进行并行服务提取。

推荐：使用 Opus 4.6 进行蓝图规划，使用 Sonnet 4.6 执行各阶段。
```

***

## 相关组件

| 组件 | 何时引用 |
|-----------|------------------|
| `configure-ecc` | 用户尚未设置 ECC |
| `skill-stocktake` | 审计安装了哪些组件（使用它而不是硬编码的目录） |
| `search-first` | 优化提示中的研究阶段 |
| `blueprint` | 史诗级范围的优化提示（作为技能调用，而非命令） |
| `strategic-compact` | 长会话上下文管理 |
| `cost-aware-llm-pipeline` | Token 优化推荐 |
