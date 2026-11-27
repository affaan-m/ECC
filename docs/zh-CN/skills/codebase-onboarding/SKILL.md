---
name: codebase-onboarding
description: 分析一个陌生的代码库，并生成一个结构化的入门指南，包括架构图、关键入口点、规范和一个起始的CLAUDE.md文件。适用于加入新项目或首次在代码仓库中设置Claude Code时。
origin: ECC
---

# 代码库入门引导

系统性地分析一个不熟悉的代码库，并生成结构化的入门指南。专为加入新项目的开发者或首次在现有仓库中设置 Claude Code 的用户设计。

## 使用时机

* 首次使用 Claude Code 打开项目时
* 加入新团队或新仓库时
* 用户询问“帮我理解这个代码库”
* 用户要求为项目生成 CLAUDE.md 文件
* 用户说“带我入门”或“带我浏览这个仓库”

## 工作原理

### 阶段 1：初步侦察

在不阅读每个文件的情况下，收集关于项目的原始信息。并行运行以下检查：

```
1. 包清单检测
   → package.json、go.mod、Cargo.toml、pyproject.toml、pom.xml、build.gradle、
     Gemfile、composer.json、mix.exs、pubspec.yaml

2. 框架指纹识别
   → next.config.*、nuxt.config.*、angular.json、vite.config.*、
     django 设置、flask 应用工厂、fastapi 主程序、rails 配置

3. 入口点识别
   → main.*、index.*、app.*、server.*、cmd/、src/main/

4. 目录结构快照
   → 目录树的前 2 层，忽略 node_modules、vendor、
     .git、dist、build、__pycache__、.next

5. 配置与工具检测
   → .eslintrc*、.prettierrc*、tsconfig.json、Makefile、Dockerfile、
     docker-compose*、.github/workflows/、.env.example、CI 配置

6. 测试结构检测
   → tests/、test/、__tests__/、*_test.go、*.spec.ts、*.test.js、
     pytest.ini、jest.config.*、vitest.config.*
```

### 阶段 2：架构映射

根据侦察数据，识别：

**技术栈**

* 语言及版本限制
* 框架及主要库
* 数据库及 ORM
* 构建工具和打包器
* CI/CD 平台

**架构模式**

* 单体、单体仓库、微服务，还是无服务器
* 前端/后端分离，还是全栈
* API 风格：REST、GraphQL、gRPC、tRPC

**关键目录**
将顶级目录映射到其用途：

<!-- Example for a React project — replace with detected directories -->

```
src/components/  → React UI 组件
src/api/         → API 路由处理程序
src/lib/         → 共享工具库
src/db/          → 数据库模型和迁移文件
tests/           → 测试套件
scripts/         → 构建和部署脚本
```

**数据流**
追踪一个请求从入口到响应的路径：

* 请求从哪里进入？（路由器、处理器、控制器）
* 如何进行验证？（中间件、模式、守卫）
* 业务逻辑在哪里？（服务、模型、用例）
* 如何访问数据库？（ORM、原始查询、存储库）

### 阶段 3：规范检测

识别代码库已遵循的模式：

**命名规范**

* 文件命名：kebab-case、camelCase、PascalCase、snake\_case
* 组件/类命名模式
* 测试文件命名：`*.test.ts`、`*.spec.ts`、`*_test.go`

**代码模式**

* 错误处理风格：try/catch、Result 类型、错误码
* 依赖注入还是直接导入
* 状态管理方法
* 异步模式：回调、Promise、async/await、通道

**Git 规范**

* 根据最近分支推断分支命名
* 根据最近提交推断提交信息风格
* PR 工作流（压缩合并、合并、变基）
* 如果仓库尚无提交记录或历史记录很浅（例如 `git clone --depth 1`），则跳过此部分并注明“Git 历史记录不可用或过浅，无法检测规范”

### 阶段 4：生成入门工件

生成两个输出：

#### 输出 1：入门指南

```markdown
# 新手上路指南：[项目名称]

## 概述
[2-3句话：说明本项目的作用及服务对象]

## 技术栈
<!-- Example for a Next.js project — replace with detected stack -->
| 层级 | 技术 | 版本 |
|-------|-----------|---------|
| 语言 | TypeScript | 5.x |
| 框架 | Next.js | 14.x |
| 数据库 | PostgreSQL | 16 |
| ORM | Prisma | 5.x |
| 测试 | Jest + Playwright | - |

## 架构
[组件连接方式的图表或描述]

## 关键入口点
<!-- Example for a Next.js project — replace with detected paths -->
- **API 路由**: `src/app/api/` — Next.js 路由处理器
- **UI 页面**: `src/app/(dashboard)/` — 经过身份验证的页面
- **数据库**: `prisma/schema.prisma` — 数据模型的单一事实来源
- **配置**: `next.config.ts` — 构建和运行时配置

## 目录结构
[顶级目录 → 用途映射]

## 请求生命周期
[追踪一个 API 请求从入口到响应的全过程]

## 约定
- [文件命名模式]
- [错误处理方法]
- [测试模式]
- [Git 工作流程]

## 常见任务
<!-- Example for a Node.js project — replace with detected commands -->
- **运行开发服务器**: `npm run dev`
- **运行测试**: `npm test`
- **运行代码检查工具**: `npm run lint`
- **数据库迁移**: `npx prisma migrate dev`
- **生产环境构建**: `npm run build`

## 查找位置
<!-- Example for a Next.js project — replace with detected paths -->
| 我想... | 查看... |
|--------------|-----------|
| 添加 API 端点 | `src/app/api/` |
| 添加 UI 页面 | `src/app/(dashboard)/` |
| 添加数据库表 | `prisma/schema.prisma` |
| 添加测试 | `tests/` （与源路径匹配） |
| 更改构建配置 | `next.config.ts` |
```

#### 输出 2：初始 CLAUDE.md

根据检测到的规范，生成或更新项目特定的 CLAUDE.md。如果 `CLAUDE.md` 已存在，请先读取它并进行增强——保留现有的项目特定说明，并明确标注新增或更改的内容。

```markdown
# 项目说明

## 技术栈
[检测到的技术栈摘要]

## 代码风格
- [检测到的命名规范]
- [检测到的应遵循的模式]

## 测试
- 运行测试：`[detected test command]`
- 测试模式：[检测到的测试文件约定]
- 覆盖率：[如果已配置，覆盖率命令]

## 构建与运行
- 开发：`[detected dev command]`
- 构建：`[detected build command]`
- 代码检查：`[detected lint command]`

## 项目结构
[关键目录 → 用途映射]

## 约定
- [可检测到的提交风格]
- [可检测到的 PR 工作流程]
- [错误处理模式]
```

## 最佳实践

1. **不要通读所有内容** —— 侦察阶段应使用 Glob 和 Grep，而非读取每个文件。仅在信号不明确时有选择性地读取。
2. **验证而非猜测** —— 如果从配置文件中检测到某个框架，但实际代码使用了不同的东西，请以代码为准。
3. **尊重现有的 CLAUDE.md** —— 如果文件已存在，请增强它而不是替换它。明确标注哪些是新增内容，哪些是原有内容。
4. **保持简洁** —— 入门指南应在 2 分钟内可快速浏览。细节应留在代码中，而非指南里。
5. **标记未知项** —— 如果无法自信地检测到某个规范，请如实说明而非猜测。“无法确定测试运行器”比给出错误答案更好。

## 应避免的反模式

* 生成超过 100 行的 CLAUDE.md —— 保持其聚焦
* 列出每个依赖项 —— 仅突出那些影响编码方式的依赖
* 描述显而易见的目录名 —— `src/` 不需要解释
* 复制 README —— 入门指南应提供 README 所缺乏的结构性见解

## 示例

### 示例 1：首次进入新仓库

**用户**：“带我入门这个代码库”
**操作**：运行完整的 4 阶段工作流 → 生成入门指南 + 初始 CLAUDE.md
**输出**：入门指南直接打印到对话中，并在项目根目录写入一个 `CLAUDE.md`

### 示例 2：为现有项目生成 CLAUDE.md

**用户**：“为这个项目生成一个 CLAUDE.md”
**操作**：运行阶段 1-3，跳过入门指南，仅生成 CLAUDE.md
**输出**：包含检测到的规范的项目特定 `CLAUDE.md`

### 示例 3：增强现有的 CLAUDE.md

**用户**：“用当前项目规范更新 CLAUDE.md”
**操作**：读取现有 CLAUDE.md，运行阶段 1-3，合并新发现
**输出**：更新后的 `CLAUDE.md`，并明确标记了新增内容
