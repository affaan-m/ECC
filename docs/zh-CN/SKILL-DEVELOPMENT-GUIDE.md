# Skill 开发指南

一份为 Everything Claude Code (ECC) 创建有效 Skill 的全面指南。

## 目录

- [什么是 Skill？](#什么是-skill)
- [Skill 架构](#skill-架构)
- [创建你的第一个 Skill](#创建你的第一个-skill)
- [Skill 分类](#skill-分类)
- [编写有效的 Skill 内容](#编写有效的-skill-内容)
- [最佳实践](#最佳实践)
- [常见模式](#常见模式)
- [测试你的 Skill](#测试你的-skill)
- [提交你的 Skill](#提交你的-skill)
- [示例集锦](#示例集锦)

---

## 什么是 Skill？

Skill 是 **知识模块**，Claude Code 根据上下文自动加载。它们提供：

- **领域专业知识**：框架模式、语言习惯用法、最佳实践
- **工作流定义**：常见任务的分步流程
- **参考资料**：代码片段、检查清单、决策树
- **上下文注入**：当特定条件满足时激活

与 **Agent**（专业子助手）或 **Command**（用户触发的操作）不同，Skill 是被动知识，Claude Code 在相关时自动引用。

### Skill 何时激活

Skill 在以下情况激活：
- 用户任务与 Skill 的领域匹配
- Claude Code 检测到相关上下文
- 某个命令引用了该 Skill
- 某个 Agent 需要领域知识

### Skill vs Agent vs Command

| 组件 | 用途 | 激活方式 |
|-----------|---------|------------|
| **Skill** | 知识库 | 基于上下文（自动） |
| **Agent** | 任务执行器 | 显式委派 |
| **Command** | 用户操作 | 用户调用（`/command`） |
| **Hook** | 自动化 | 事件触发 |
| **Rule** | 始终生效的指南 | 始终激活 |

---

## Skill 架构

### 文件结构

```
skills/
└── your-skill-name/
    ├── SKILL.md           # 必需：Skill 主定义文件
    ├── examples/          # 可选：代码示例
    │   ├── basic.ts
    │   └── advanced.ts
    └── references/        # 可选：外部参考
        └── links.md
```

### SKILL.md 格式

```markdown
---
name: skill-name
description: 在 Skill 列表中显示的简要描述，用于自动激活匹配
origin: ECC
---

# Skill 标题

简要概述此 Skill 涵盖的内容。

## 何时激活

描述 Claude 应在什么场景下使用此 Skill。

## 核心概念

主要模式和指南。

## 代码示例

\`\`\`typescript
// 实用、经过测试的示例
\`\`\`

## 反模式

用具体示例展示不应该做的事。

## 最佳实践

- 可操作的指南
- 该做的和不该做的

## 相关 Skill

链接到互补的 Skill。
```

### YAML Frontmatter 字段

| 字段 | 必需 | 描述 |
|-------|----------|-------------|
| `name` | 是 | 小写、连字符连接的标识符（如 `react-patterns`） |
| `description` | 是 | 单行描述，用于 Skill 列表和自动激活 |
| `origin` | 否 | 来源标识符（如 `ECC`、`community`、项目名） |
| `tags` | 否 | 分类标签数组 |
| `version` | 否 | Skill 版本号，用于跟踪更新 |

---

## 创建你的第一个 Skill

### 第1步：选择焦点

好的 Skill 是 **聚焦且可操作的**：

| 通过：好的焦点 | 不通过：太宽泛 |
|---------------|--------------|
| `react-hook-patterns` | `react` |
| `postgresql-indexing` | `databases` |
| `pytest-fixtures` | `python-testing` |
| `nextjs-app-router` | `nextjs` |

### 第2步：创建目录

```bash
mkdir -p skills/your-skill-name
```

### 第3步：编写 SKILL.md

以下是一个最小模板：

```markdown
---
name: your-skill-name
description: 简要描述何时使用此 Skill
---

# 你的 Skill 标题

简要概述（1-2句话）。

## 何时激活

- 场景1
- 场景2
- 场景3

## 核心概念

### 概念1

带示例的解释。

### 概念2

带代码的另一种模式。

## 代码示例

\`\`\`typescript
// 实用示例
\`\`\`

## 最佳实践

- 做这个
- 避免那个

## 相关 Skill

- `related-skill-1`
- `related-skill-2`
```

### 第4步：添加内容

编写 Claude 可以 **立即使用** 的内容：

- 通过：可直接复制粘贴的代码示例
- 通过：清晰的决策树
- 通过：用于验证的检查清单
- 不通过：没有示例的模糊解释
- 不通过：没有可操作指导的长篇叙述

---

## Skill 分类

### 语言标准

聚焦于习惯用法、命名约定和语言特定模式。

**示例：** `python-patterns`、`golang-patterns`、`typescript-standards`

```markdown
---
name: python-patterns
description: Python 习惯用法、最佳实践和模式，用于编写清晰、地道的代码。
---

# Python 模式

## 何时激活

- 编写 Python 代码
- 重构 Python 模块
- Python 代码审查

## 核心概念

### 上下文管理器

\`\`\`python
# 始终使用上下文管理器管理资源
with open('file.txt') as f:
    content = f.read()
\`\`\`
```

### 框架模式

聚焦于框架特定约定、常见模式和反模式。

**示例：** `django-patterns`、`nextjs-patterns`、`springboot-patterns`

```markdown
---
name: django-patterns
description: Django 模型、视图、URL 和模板的最佳实践。
---

# Django 模式

## 何时激活

- 构建 Django 应用
- 创建模型和视图
- Django URL 配置
```

### 工作流 Skill

定义常见开发任务的分步流程。

**示例：** `tdd-workflow`、`code-review-workflow`、`deployment-checklist`

```markdown
---
name: code-review-workflow
description: 确保质量和安全的系统化代码审查流程。
---

# 代码审查工作流

## 步骤

1. **理解上下文** - 阅读 PR 描述和关联 Issue
2. **检查测试** - 验证测试覆盖率和质量
3. **审查逻辑** - 分析实现的正确性
4. **检查安全** - 查找漏洞
5. **验证风格** - 确保代码遵循约定
```

### 领域知识

特定领域的专业知识（安全、性能等）。

**示例：** `security-review`、`performance-optimization`、`api-design`

```markdown
---
name: api-design
description: REST 和 GraphQL API 设计模式、版本控制和最佳实践。
---

# API 设计模式

## RESTful 约定

| 方法 | 端点 | 用途 |
|--------|----------|---------|
| GET | /resources | 列表全部 |
| GET | /resources/:id | 获取单个 |
| POST | /resources | 创建 |
```

### 工具集成

使用特定工具、库或服务的指导。

**示例：** `supabase-patterns`、`docker-patterns`、`mcp-server-patterns`

---

## 编写有效的 Skill 内容

### 1. 从"何时激活"开始

这一节对于自动激活 **至关重要**。要具体：

```markdown
## 何时激活

- 创建新的 React 组件
- 重构现有组件
- 调试 React 状态问题
- 审查 React 代码的最佳实践
```

### 2. 使用"展示，而非说教"

差：
```markdown
## 错误处理

在异步函数中始终正确处理错误。
```

好：
```markdown
## 错误处理

\`\`\`typescript
async function fetchData(url: string) {
  try {
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(\`HTTP \${response.status}: \${response.statusText}\`)
    }

    return await response.json()
  } catch (error) {
    console.error('获取失败:', error)
    throw new Error('获取数据失败')
  }
}
\`\`\`

### 要点

- 解析前先检查 \`response.ok\`
- 记录错误以便调试
- 重新抛出错时使用用户友好的消息
```

### 3. 包含反模式

展示不应该做什么：

```markdown
## 反模式

### 失败：直接修改状态

\`\`\`typescript
// 绝不要这样做
user.name = 'New Name'
items.push(newItem)
\`\`\`

### 通过：不可变更新

\`\`\`typescript
// 始终这样做
const updatedUser = { ...user, name: 'New Name' }
const updatedItems = [...items, newItem]
\`\`\`
```

### 4. 提供检查清单

检查清单具有可操作性，易于遵循：

```markdown
## 部署前检查清单

- [ ] 所有测试通过
- [ ] 生产代码中无 console.log
- [ ] 环境变量已文档化
- [ ] 无硬编码的密钥
- [ ] 错误处理完整
- [ ] 输入验证到位
```

### 5. 使用决策树

用于复杂决策：

```markdown
## 选择正确方案

\`\`\`
需要获取数据？
├── 单次请求 → 直接使用 fetch
├── 多个独立请求 → Promise.all()
├── 多个依赖请求 → 依次 await
└── 带缓存 → 使用 SWR 或 React Query
\`\`\`
```

---

## 最佳实践

### 应该做

| 实践 | 示例 |
|----------|---------|
| **具体明确** | "对传递给子组件的事件处理函数使用 `useCallback`" |
| **展示示例** | 包含可复制粘贴的代码 |
| **解释为什么** | "不可变性防止了 React 状态中的意外副作用" |
| **链接相关 Skill** | "另见：`react-performance`" |
| **保持聚焦** | 一个 Skill = 一个领域/概念 |
| **使用章节** | 清晰的标题便于快速浏览 |

### 不应该做

| 实践 | 为什么不好 |
|----------|--------------|
| **模糊不清** | "写好代码"——不可操作 |
| **长篇叙述** | 难以解析，代码更好 |
| **覆盖过广** | "Python、Django 和 Flask 模式"——太宽泛 |
| **跳过示例** | 没有实践的理论用处不大 |
| **忽略反模式** | 学会不该做什么也很有价值 |

### 内容指南

1. **长度**：通常 200-500 行，最多 800 行
2. **代码块**：包含语言标识符
3. **标题**：使用 `##` 和 `###` 层级结构
4. **列表**：无序用 `-`，有序用 `1.`
5. **表格**：用于对比和参考

---

## 常见模式

### 模式1：标准 Skill

```markdown
---
name: language-standards
description: [语言]的编码标准和最佳实践。
---

# [语言] 编码标准

## 何时激活

- 编写 [语言] 代码
- 代码审查
- 设置代码检查工具

## 命名约定

| 元素 | 约定 | 示例 |
|---------|------------|---------|
| 变量 | camelCase | userName |
| 常量 | SCREAMING_SNAKE | MAX_RETRY |
| 函数 | camelCase | fetchUser |
| 类 | PascalCase | UserService |

## 代码示例

[包含实用示例]

## 代码检查设置

[包含配置]

## 相关 Skill

- `language-testing`
- `language-security`
```

### 模式2：工作流 Skill

```markdown
---
name: task-workflow
description: [任务]的分步工作流。
---

# [任务] 工作流

## 何时激活

- [触发条件1]
- [触发条件2]

## 前置条件

- [要求1]
- [要求2]

## 步骤

### 步骤1：[名称]

[描述]

\`\`\`bash
[命令]
\`\`\`

### 步骤2：[名称]

[描述]

## 验证

- [ ] [检查1]
- [ ] [检查2]

## 故障排除

| 问题 | 解决方案 |
|---------|----------|
| [问题] | [修复] |
```

### 模式3：参考 Skill

```markdown
---
name: api-reference
description: [API/库]的快速参考。
---

# [API/库] 参考

## 何时激活

- 使用 [API/库]
- 查阅 [API/库] 语法

## 常见操作

### 操作1

\`\`\`typescript
// 基本用法
\`\`\`

### 操作2

\`\`\`typescript
// 高级用法
\`\`\`

## 配置

[包含配置示例]

## 错误处理

[包含错误模式]
```

---

## 测试你的 Skill

### 本地测试

1. **复制到 Claude Code skills 目录**：
   ```bash
   cp -r skills/your-skill-name ~/.claude/skills/
   ```

2. **用 Claude Code 测试**：
   ```
   你："我需要 [应该触发你的 Skill 的任务]"

   Claude 应该引用你的 Skill 的模式。
   ```

3. **验证激活**：
   - 让 Claude 解释你的 Skill 中的一个概念
   - 检查它是否使用了你的示例和模式
   - 确保它遵循了你的指南

### 验证检查清单

- [ ] **YAML frontmatter 有效** - 无语法错误
- [ ] **名称遵循约定** - 小写字母加连字符
- [ ] **描述清晰** - 告诉何时使用
- [ ] **示例有效** - 代码可以编译和运行
- [ ] **链接有效** - 相关 Skill 存在
- [ ] **无敏感数据** - 无 API 密钥、令牌、路径

### 代码示例测试

测试所有代码示例：

```bash
# 从仓库根目录
npx tsc --noEmit skills/your-skill-name/examples/*.ts

# 或从 Skill 目录内部
npx tsc --noEmit examples/*.ts

# 从仓库根目录
python -m py_compile skills/your-skill-name/examples/*.py

# 或从 Skill 目录内部
python -m py_compile examples/*.py

# 从仓库根目录
go build ./skills/your-skill-name/examples/...

# 或从 Skill 目录内部
go build ./examples/...
```

---

## 提交你的 Skill

### 1. Fork 并 Clone

```bash
gh repo fork affaan-m/everything-claude-code --clone
cd everything-claude-code
```

### 2. 创建分支

```bash
git checkout -b feat/skill-your-skill-name
```

### 3. 添加你的 Skill

```bash
mkdir -p skills/your-skill-name
# 创建 SKILL.md
```

### 4. 验证

```bash
# 检查 YAML frontmatter
head -10 skills/your-skill-name/SKILL.md

# 验证结构
ls -la skills/your-skill-name/

# 如果有测试，运行测试
npm test
```

### 5. 提交并推送

```bash
git add skills/your-skill-name/
git commit -m "feat(skills): add your-skill-name skill"
git push -u origin feat/skill-your-skill-name
```

### 6. 创建 Pull Request

使用此 PR 模板：

```markdown
## Summary

简要描述 Skill 及其价值。

## Skill Type

- [ ] 语言标准
- [ ] 框架模式
- [ ] 工作流
- [ ] 领域知识
- [ ] 工具集成

## Testing

我是如何在本地测试此 Skill 的。

## Checklist

- [ ] YAML frontmatter 有效
- [ ] 代码示例已测试
- [ ] 遵循 Skill 编写指南
- [ ] 无敏感数据
- [ ] 激活触发器清晰
```

---

## 示例集锦

### 示例1：语言标准

**文件：** `skills/rust-patterns/SKILL.md`

```markdown
---
name: rust-patterns
description: Rust 习惯用法、所有权模式和最佳实践，用于编写安全、地道的代码。
origin: ECC
---

# Rust 模式

## 何时激活

- 编写 Rust 代码
- 处理所有权和借用
- 使用 Result/Option 进行错误处理
- 实现 trait

## 所有权模式

### 借用规则

\`\`\`rust
// 通过：正确：当不需要所有权时使用借用
fn process_data(data: &str) -> usize {
    data.len()
}

// 通过：正确：当需要修改或消耗时获取所有权
fn consume_data(data: Vec<u8>) -> String {
    String::from_utf8(data).unwrap()
}
\`\`\`

## 错误处理

### Result 模式

\`\`\`rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("解析错误: {0}")]
    Parse(#[from] std::num::ParseIntError),
}

pub type AppResult<T> = Result<T, AppError>;
\`\`\`

## 相关 Skill

- `rust-testing`
- `rust-security`
```

### 示例2：框架模式

**文件：** `skills/fastapi-patterns/SKILL.md`

```markdown
---
name: fastapi-patterns
description: FastAPI 路由、依赖注入、验证和异步操作的模式。
origin: ECC
---

# FastAPI 模式

## 何时激活

- 构建 FastAPI 应用
- 创建 API 端点
- 实现依赖注入
- 处理异步数据库操作

## 项目结构

\`\`\`
app/
├── main.py              # FastAPI 应用入口
├── routers/             # 路由处理器
│   ├── users.py
│   └── items.py
├── models/              # Pydantic 模型
│   ├── user.py
│   └── item.py
├── services/            # 业务逻辑
│   └── user_service.py
└── dependencies.py      # 共享依赖
\`\`\`

## 依赖注入

\`\`\`python
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session

@router.get("/users/{user_id}")
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db)
):
    # 使用 db session
    pass
\`\`\`

## 相关 Skill

- `python-patterns`
- `pydantic-validation`
```

### 示例3：工作流 Skill

**文件：** `skills/refactoring-workflow/SKILL.md`

```markdown
---
name: refactoring-workflow
description: 在不改变行为的前提下改善代码质量的系统化重构工作流。
origin: ECC
---

# 重构工作流

## 何时激活

- 改善代码结构
- 减少技术债务
- 简化复杂代码
- 提取可复用组件

## 前置条件

- 所有测试通过
- Git 工作目录干净
- 已创建功能分支

## 工作流步骤

### 步骤1：确定重构目标

- 查找代码坏味道（长方法、重复代码、大类）
- 检查目标区域的测试覆盖率
- 记录当前行为

### 步骤2：确保测试存在

\`\`\`bash
# 运行测试验证当前行为
npm test

# 检查目标文件的覆盖率
npm run test:coverage
\`\`\`

### 步骤3：小步修改

- 一次只做一项重构
- 每次修改后运行测试
- 频繁提交

### 步骤4：验证行为未变

\`\`\`bash
# 运行完整测试套件
npm test

# 运行 E2E 测试
npm run test:e2e
\`\`\`

## 常见重构

| 坏味道 | 重构方法 |
|-------|-------------|
| 长方法 | 提取方法 |
| 重复代码 | 提取为共享函数 |
| 大类 | 提取类 |
| 长参数列表 | 引入参数对象 |

## 检查清单

- [ ] 目标代码有测试覆盖
- [ ] 进行了小步、聚焦的修改
- [ ] 每次修改后测试通过
- [ ] 行为未改变
- [ ] 使用清晰的消息提交
```

---

## 其他资源

- [CONTRIBUTING.md](CONTRIBUTING.md) - 通用贡献指南
- [project-guidelines-template](../examples/project-guidelines-template.md) - 项目专属 Skill 模板
- [coding-standards](../../skills/coding-standards/SKILL.md) - 标准 Skill 示例
- [tdd-workflow](../../skills/tdd-workflow/SKILL.md) - 工作流 Skill 示例
- [security-review](../../skills/security-review/SKILL.md) - 领域知识 Skill 示例

---

**记住**：好的 Skill 是聚焦的、可操作的、立即可用的。写你自己也想用的 Skill。
