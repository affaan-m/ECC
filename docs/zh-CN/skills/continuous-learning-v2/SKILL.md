---
name: continuous-learning-v2
description: 基于本能的学习系统，通过钩子观察会话，创建带置信度评分的原子本能，并将其进化为技能/命令/代理。v2.1版本增加了项目范围的本能，以防止跨项目污染。
origin: ECC
version: 2.1.0
---

# 持续学习 v2.1 - 基于本能

的架构

一个高级学习系统，通过原子化的“本能”——带有置信度评分的小型习得行为——将你的 Claude Code 会话转化为可重用的知识。

**v2.1** 新增了**项目作用域的本能** — React 模式保留在你的 React 项目中，Python 约定保留在你的 Python 项目中，而通用模式（如“始终验证输入”）则全局共享。

## 何时激活

* 设置从 Claude Code 会话自动学习
* 通过钩子配置基于本能的行为提取
* 调整已学习行为的置信度阈值
* 查看、导出或导入本能库
* 将本能进化为完整的技能、命令或代理
* 管理项目作用域与全局本能
* 将本能从项目作用域提升到全局作用域

## v2.1 的新特性

| 特性 | v2.0 | v2.1 |
|---------|------|------|
| 存储 | 全局 (~/.claude/homunculus/) | 项目作用域 (projects/<hash>/) |
| 作用域 | 所有本能随处适用 | 项目作用域 + 全局 |
| 检测 | 无 | git remote URL / 仓库路径 |
| 提升 | 不适用 | 在 2+ 个项目中出现时，项目 → 全局 |
| 命令 | 4个 (status/evolve/export/import) | 6个 (+promote/projects) |
| 跨项目 | 存在污染风险 | 默认隔离 |

## v2 的新特性（对比 v1）

| 特性 | v1 | v2 |
|---------|----|----|
| 观察 | 停止钩子（会话结束） | PreToolUse/PostToolUse (100% 可靠) |
| 分析 | 主上下文 | 后台代理 (Haiku) |
| 粒度 | 完整技能 | 原子化“本能” |
| 置信度 | 无 | 0.3-0.9 加权 |
| 进化 | 直接进化为技能 | 本能 -> 聚类 -> 技能/命令/代理 |
| 共享 | 无 | 导出/导入本能 |

## 本能模型

一个本能是一个小型习得行为：

```yaml
---
id: prefer-functional-style
trigger: "when writing new functions"
confidence: 0.7
domain: "code-style"
source: "session-observation"
scope: project
project_id: "a1b2c3d4e5f6"
project_name: "my-react-app"
---

# Prefer Functional Style

## Action
Use functional patterns over classes when appropriate.

## Evidence
- Observed 5 instances of functional pattern preference
- User corrected class-based approach to functional on 2025-01-15
```

**属性：**

* **原子化** -- 一个触发条件，一个动作
* **置信度加权** -- 0.3 = 试探性，0.9 = 几乎确定
* **领域标记** -- 代码风格、测试、git、调试、工作流等
* **有证据支持** -- 追踪是哪些观察创建了它
* **作用域感知** -- `project` (默认) 或 `global`

## 工作原理

```
会话活动（在 git 仓库中）
      |
      | 钩子捕获提示 + 工具使用（100% 可靠）
      | + 检测项目上下文（git remote / 仓库路径）
      v
+---------------------------------------------+
|  projects/<project-hash>/observations.jsonl  |
|   （提示、工具调用、结果、项目）               |
+---------------------------------------------+
      |
      | 观察者代理读取（后台，Haiku）
      v
+---------------------------------------------+
|          模式检测                            |
|   * 用户修正 -> 直觉                          |
|   * 错误解决 -> 直觉                          |
|   * 重复工作流 -> 直觉                        |
|   * 范围决策：项目级或全局？                   |
+---------------------------------------------+
      |
      | 创建/更新
      v
+---------------------------------------------+
|  projects/<project-hash>/instincts/personal/ |
|   * prefer-functional.yaml (0.7) [项目]      |
|   * use-react-hooks.yaml (0.9) [项目]        |
+---------------------------------------------+
|  instincts/personal/  （全局）                |
|   * always-validate-input.yaml (0.85) [全局] |
|   * grep-before-edit.yaml (0.6) [全局]       |
+---------------------------------------------+
      |
      | /evolve 聚类 + /promote
      v
+---------------------------------------------+
|  projects/<hash>/evolved/ （项目范围）        |
|  evolved/ （全局）                            |
|   * commands/new-feature.md                  |
|   * skills/testing-workflow.md               |
|   * agents/refactor-specialist.md            |
+---------------------------------------------+
```

## 项目检测

系统会自动检测您当前的项目：

1. **`CLAUDE_PROJECT_DIR` 环境变量** (最高优先级)
2. **`git remote get-url origin`** -- 哈希化以创建可移植的项目 ID (同一仓库在不同机器上获得相同的 ID)
3. **`git rev-parse --show-toplevel`** -- 使用仓库路径作为后备方案 (机器特定)
4. **全局后备方案** -- 如果未检测到项目，本能将进入全局作用域

每个项目都会获得一个 12 字符的哈希 ID (例如 `a1b2c3d4e5f6`)。`~/.claude/homunculus/projects.json` 处的注册表文件将 ID 映射到人类可读的名称。

## 快速开始

### 1. 启用观察钩子

添加到你的 `~/.claude/settings.json` 中。

**如果作为插件安装**（推荐）：

不需要在 `~/.claude/settings.json` 中额外添加 hooks。Claude Code v2.1+ 会自动加载插件的 `hooks/hooks.json`，其中已经注册了 `observe.sh`。

如果您之前把 `observe.sh` 复制到了 `~/.claude/settings.json`，请删除重复的 `PreToolUse` / `PostToolUse` 配置。重复注册会导致重复执行，并触发 `${CLAUDE_PLUGIN_ROOT}` 解析错误，因为该变量只会在插件自己的 `hooks/hooks.json` 中展开。

**如果手动安装**到 `~/.claude/skills`，请将以下内容添加到 `~/.claude/settings.json`：

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning-v2/hooks/observe.sh"
      }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning-v2/hooks/observe.sh"
      }]
    }]
  }
}
```

### 2. 初始化目录结构

系统会在首次使用时自动创建目录，但您也可以手动创建：

```bash
# Global directories
mkdir -p ~/.claude/homunculus/{instincts/{personal,inherited},evolved/{agents,skills,commands},projects}

# Project directories are auto-created when the hook first runs in a git repo
```

### 3. 使用本能命令

```bash
/instinct-status     # Show learned instincts (project + global)
/evolve              # Cluster related instincts into skills/commands
/instinct-export     # Export instincts to file
/instinct-import     # Import instincts from others
/promote             # Promote project instincts to global scope
/projects            # List all known projects and their instinct counts
```

## 命令

| 命令 | 描述 |
|---------|-------------|
| `/instinct-status` | 显示所有本能 (项目作用域 + 全局) 及其置信度 |
| `/evolve` | 将相关本能聚类成技能/命令，建议提升 |
| `/instinct-export` | 导出本能 (可按作用域/领域过滤) |
| `/instinct-import <file>` | 导入本能 (带作用域控制) |
| `/promote [id]` | 将项目本能提升到全局作用域 |
| `/projects` | 列出所有已知项目及其本能数量 |

## 配置

编辑 `config.json` 以控制后台观察器：

```json
{
  "version": "2.1",
  "observer": {
    "enabled": false,
    "run_interval_minutes": 5,
    "min_observations_to_analyze": 20
  }
}
```

| 键 | 默认值 | 描述 |
|-----|---------|-------------|
| `observer.enabled` | `false` | 启用后台观察器代理 |
| `observer.run_interval_minutes` | `5` | 观察器分析观察结果的频率 |
| `observer.min_observations_to_analyze` | `20` | 运行分析所需的最小观察次数 |

其他行为 (观察捕获、本能阈值、项目作用域、提升标准) 通过 `instinct-cli.py` 和 `observe.sh` 中的代码默认值进行配置。

## 文件结构

```
~/.claude/homunculus/
+-- identity.json           # 你的个人资料，技术水平
+-- projects.json           # 注册表：项目哈希 -> 名称/路径/远程地址
+-- observations.jsonl      # 全局观察记录（备用）
+-- instincts/
|   +-- personal/           # 全局自动学习的本能
|   +-- inherited/          # 全局导入的本能
+-- evolved/
|   +-- agents/             # 全局生成的代理
|   +-- skills/             # 全局生成的技能
|   +-- commands/           # 全局生成的命令
+-- projects/
    +-- a1b2c3d4e5f6/       # 项目哈希（来自 git 远程 URL）
    |   +-- project.json    # 项目级元数据镜像（ID/名称/根目录/远程地址）
    |   +-- observations.jsonl
    |   +-- observations.archive/
    |   +-- instincts/
    |   |   +-- personal/   # 项目特定自动学习的
    |   |   +-- inherited/  # 项目特定导入的
    |   +-- evolved/
    |       +-- skills/
    |       +-- commands/
    |       +-- agents/
    +-- f6e5d4c3b2a1/       # 另一个项目
        +-- ...
```

## 作用域决策指南

| 模式类型 | 作用域 | 示例 |
|-------------|-------|---------|
| 语言/框架约定 | **项目** | "使用 React hooks", "遵循 Django REST 模式" |
| 文件结构偏好 | **项目** | "测试放在 `__tests__`/", "组件放在 src/components/" |
| 代码风格 | **项目** | "使用函数式风格", "首选数据类" |
| 错误处理策略 | **项目** | "对错误使用 Result 类型" |
| 安全实践 | **全局** | "验证用户输入", "清理 SQL" |
| 通用最佳实践 | **全局** | "先写测试", "始终处理错误" |
| 工具工作流偏好 | **全局** | "编辑前先 Grep", "写入前先读取" |
| Git 实践 | **全局** | "约定式提交", "小而专注的提交" |

## 本能提升 (项目 -> 全局)

当同一个本能在多个项目中以高置信度出现时，它就有资格被提升到全局作用域。

**自动提升标准：**

* 相同的本能 ID 出现在 2+ 个项目中
* 平均置信度 >= 0.8

**如何提升：**

```bash
# Promote a specific instinct
python3 instinct-cli.py promote prefer-explicit-errors

# Auto-promote all qualifying instincts
python3 instinct-cli.py promote

# Preview without changes
python3 instinct-cli.py promote --dry-run
```

`/evolve` 命令也会建议可提升的候选本能。

## 置信度评分

置信度随时间演变：

| 分数 | 含义 | 行为 |
|-------|---------|----------|
| 0.3 | 尝试性的 | 建议但不强制执行 |
| 0.5 | 中等的 | 相关时应用 |
| 0.7 | 强烈的 | 自动批准应用 |
| 0.9 | 近乎确定的 | 核心行为 |

**置信度增加**当：

* 模式被反复观察到
* 用户未纠正建议的行为
* 来自其他来源的相似本能一致

**置信度降低**当：

* 用户明确纠正该行为
* 长时间未观察到该模式
* 出现矛盾证据

## 为什么用钩子而非技能进行观察？

> "v1 依赖技能来观察。技能是概率性的 -- 根据 Claude 的判断，它们触发的概率约为 50-80%。"

钩子**100% 触发**，是确定性的。这意味着：

* 每次工具调用都被观察到
* 不会错过任何模式
* 学习是全面的

## 向后兼容性

v2.1 与 v2.0 和 v1 完全兼容：

* `~/.claude/homunculus/instincts/` 中现有的全局本能仍然作为全局本能工作
* 来自 v1 的现有 `~/.claude/skills/learned/` 技能仍然有效
* 停止钩子仍然运行 (但现在也会输入到 v2)
* 逐步迁移：并行运行两者

## 隐私

* 观察结果**本地**保留在您的机器上
* 项目作用域的本能按项目隔离
* 只有**本能** (模式) 可以被导出 — 而不是原始观察数据
* 不会共享实际的代码或对话内容
* 您控制导出和提升的内容

## 相关链接

* [技能创建器](https://skill-creator.app) - 从仓库历史生成本能
* Homunculus - 启发了 v2 基于本能的架构的社区项目（原子观察、置信度评分、本能进化管道）
* [长篇指南](https://x.com/affaanmustafa/status/2014040193557471352) - 持续学习部分

***

*基于本能的学习：一次一个项目，教会 Claude 您的模式。*
