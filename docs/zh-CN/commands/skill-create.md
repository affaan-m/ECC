---
name: skill-create
description: 分析本地Git历史以提取编码模式并生成SKILL.md文件。Skill Creator GitHub应用的本地版本。
allowed-tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /skill-create - 本地技能生成

分析你的仓库的 git 历史，以提取编码模式并生成 SKILL.md 文件，用于向 Claude 传授你团队的实践方法。

## 使用方法

```bash
/skill-create                    # Analyze current repo
/skill-create --commits 100      # Analyze last 100 commits
/skill-create --output ./skills  # Custom output directory
/skill-create --instincts        # Also generate instincts for continuous-learning-v2
```

## 功能说明

1. **解析 Git 历史** - 分析提交记录、文件更改和模式
2. **检测模式** - 识别重复出现的工作流程和约定
3. **生成 SKILL.md** - 创建有效的 Claude Code 技能文件
4. **可选创建 Instincts** - 用于 continuous-learning-v2 系统

## 分析步骤

### 步骤 1：收集 Git 数据

```bash
# Get recent commits with file changes
git log --oneline -n ${COMMITS:-200} --name-only --pretty=format:"%H|%s|%ad" --date=short

# Get commit frequency by file
git log --oneline -n 200 --name-only | grep -v "^$" | grep -v "^[a-f0-9]" | sort | uniq -c | sort -rn | head -20

# Get commit message patterns
git log --oneline -n 200 | cut -d' ' -f2- | head -50
```

### 步骤 2：检测模式

寻找以下模式类型：

| 模式 | 检测方法 |
|---------|-----------------|
| **提交约定** | 对提交消息进行正则匹配 (feat:, fix:, chore:) |
| **文件协同更改** | 总是同时更改的文件 |
| **工作流序列** | 重复的文件更改模式 |
| **架构** | 文件夹结构和命名约定 |
| **测试模式** | 测试文件位置、命名、覆盖率 |

### 步骤 3：生成 SKILL.md

输出格式：

```markdown
---
name: {repo-name}-patterns
description: 从 {repo-name} 提取的编码模式
version: 1.0.0
source: local-git-analysis
analyzed_commits: {count}
---

# {Repo Name} 模式

## 提交规范
{detected commit message patterns}

## 代码架构
{detected folder structure and organization}

## 工作流
{detected repeating file change patterns}

## 测试模式
{detected test conventions}

```

### 步骤 4：生成 Instincts（如果使用 --instincts）

用于 continuous-learning-v2 集成：

```yaml
---
id: {repo}-commit-convention
trigger: "when writing a commit message"
confidence: 0.8
domain: git
source: local-repo-analysis
---

# Use Conventional Commits

## Action
Prefix commits with: feat:, fix:, chore:, docs:, test:, refactor:

## Evidence
- Analyzed {n} commits
- {percentage}% follow conventional commit format
```

## 示例输出

在 TypeScript 项目上运行 `/skill-create` 可能会产生：

```markdown
---
name: my-app-patterns
description: Coding patterns from my-app repository
version: 1.0.0
source: local-git-analysis
analyzed_commits: 150
---

# My App 模式

## 提交约定

该项目使用 **约定式提交**：
- `feat:` - 新功能
- `fix:` - 错误修复
- `chore:` - 维护任务
- `docs:` - 文档更新

## 代码架构

```

src/
├── components/     # React 组件 (PascalCase.tsx)
├── hooks/          # 自定义钩子 (use\*.ts)
├── utils/          # 工具函数
├── types/          # TypeScript 类型定义
└── services/       # API 和外部服务

```
## 工作流

### 添加新组件
1. 创建 `src/components/ComponentName.tsx`
2. 在 `src/components/__tests__/ComponentName.test.tsx` 中添加测试
3. 从 `src/components/index.ts` 导出

### 数据库迁移
1. 修改 `src/db/schema.ts`
2. 运行 `pnpm db:generate`
3. 运行 `pnpm db:migrate`

## 测试模式

- 测试文件：`__tests__/` 目录或 `.test.ts` 后缀
- 覆盖率目标：80%+
- 框架：Vitest
```

## GitHub 应用集成

对于高级功能（10k+ 提交、团队共享、自动 PR），请使用 [Skill Creator GitHub 应用](https://github.com/apps/skill-creator)：

* 安装: [github.com/apps/skill-creator](https://github.com/apps/skill-creator)
* 在任何议题上评论 `/skill-creator analyze`
* 接收包含生成技能的 PR

## 相关命令

* `/instinct-import` - 导入生成的 instincts
* `/instinct-status` - 查看已学习的 instincts
* `/evolve` - 将 instincts 聚类为技能/代理

***

*属于 [Everything Claude Code](https://github.com/affaan-m/everything-claude-code)*
