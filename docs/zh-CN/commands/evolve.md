---
name: evolve
description: 分析本能并建议或生成进化结构
command: true
---

# Evolve 命令

## 实现方式

使用插件根路径运行 instinct CLI：

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" evolve [--generate]
```

或者如果 `CLAUDE_PLUGIN_ROOT` 未设置（手动安装）：

```bash
python3 ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py evolve [--generate]
```

分析本能并将相关的本能聚合成更高层次的结构：

* **命令**：当本能描述用户调用的操作时
* **技能**：当本能描述自动触发的行为时
* **代理**：当本能描述复杂的、多步骤的流程时

## 使用方法

```
/evolve                    # 分析所有本能并建议进化方向
/evolve --generate         # 同时在 evolved/{skills,commands,agents} 目录下生成文件
```

## 演化规则

### → 命令（用户调用）

当本能描述用户会明确请求的操作时：

* 多个关于“当用户要求...”的本能
* 触发器类似“当创建新的 X 时”的本能
* 遵循可重复序列的本能

示例：

* `new-table-step1`: "当添加数据库表时，创建迁移"
* `new-table-step2`: "当添加数据库表时，更新模式"
* `new-table-step3`: "当添加数据库表时，重新生成类型"

→ 创建：**new-table** 命令

### → 技能（自动触发）

当本能描述应该自动发生的行为时：

* 模式匹配触发器
* 错误处理响应
* 代码风格强制执行

示例：

* `prefer-functional`: "当编写函数时，优先使用函数式风格"
* `use-immutable`: "当修改状态时，使用不可变模式"
* `avoid-classes`: "当设计模块时，避免基于类的设计"

→ 创建：`functional-patterns` 技能

### → 代理（需要深度/隔离）

当本能描述复杂的、多步骤的、受益于隔离的流程时：

* 调试工作流
* 重构序列
* 研究任务

示例：

* `debug-step1`: "当调试时，首先检查日志"
* `debug-step2`: "当调试时，隔离故障组件"
* `debug-step3`: "当调试时，创建最小复现"
* `debug-step4`: "当调试时，用测试验证修复"

→ 创建：**debugger** 代理

## 操作步骤

1. 检测当前项目上下文
2. 读取项目 + 全局本能（项目优先级高于 ID 冲突）
3. 按触发器/领域模式分组本能
4. 识别：
   * 技能候选（包含 2+ 个本能的触发器簇）
   * 命令候选（高置信度工作流本能）
   * 智能体候选（更大、高置信度的簇）
5. 在适用时显示升级候选（项目 -> 全局）
6. 如果传入了 `--generate`，则将文件写入：
   * 项目范围：`~/.claude/homunculus/projects/<project-id>/evolved/`
   * 全局回退：`~/.claude/homunculus/evolved/`

## 输出格式

```
============================================================
  演进分析 - 12 种直觉
  项目：my-app (a1b2c3d4e5f6)
  项目范围：8 | 全局：4
============================================================

高置信度直觉 (>=80%)：5

## 技能候选
1. 聚类："adding tests"
   直觉：3
   平均置信度：82%
   领域：testing
   范围：project

## 命令候选 (2)
  /adding-tests
    来源：test-first-workflow [project]
    置信度：84%

## 代理候选 (1)
  adding-tests-agent
    涵盖 3 种直觉
    平均置信度：82%
```

## 标志

* `--generate`：除了分析输出外，还生成进化后的文件

## 生成的文件格式

### 命令

```markdown
---
name: new-table
description: Create a new database table with migration, schema update, and type generation
command: /new-table
evolved_from:
  - new-table-migration
  - update-schema
  - regenerate-types
---

# 新建数据表命令

[基于集群本能生成的内容]

## 步骤
1. ...
2. ...

```

### 技能

```markdown
---
name: functional-patterns
description: 强制执行函数式编程模式
evolved_from:
  - prefer-functional
  - use-immutable
  - avoid-classes
---

# 函数式模式技能

[基于聚类本能生成的内容]

```

### 代理

```markdown
---
name: debugger
description: 系统性调试代理
model: sonnet
evolved_from:
  - debug-check-logs
  - debug-isolate
  - debug-reproduce
---

# 调试器代理

[基于聚类本能生成的内容]

```
