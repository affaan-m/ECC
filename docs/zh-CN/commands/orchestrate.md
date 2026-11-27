---
description: 针对多智能体工作流程的顺序和tmux/worktree编排指南。
---

# 编排命令

用于复杂任务的顺序代理工作流。

## 使用

`/orchestrate [workflow-type] [task-description]`

## 工作流类型

### feature

完整功能实现工作流：

```
规划者 -> 测试驱动开发指南 -> 代码审查员 -> 安全审查员
```

### bugfix

错误调查与修复工作流：

```
planner -> tdd-guide -> code-reviewer
```

### refactor

安全重构工作流：

```
架构师 -> 代码审查员 -> 测试驱动开发指南
```

### security

安全审查工作流：

```
security-reviewer -> code-reviewer -> architect
```

## 执行模式

针对工作流中的每个代理：

1. 使用来自上一个代理的上下文**调用代理**
2. 将输出收集为结构化的交接文档
3. 将文档**传递给链中的下一个代理**
4. 将结果**汇总**到最终报告中

## 交接文档格式

在代理之间，创建交接文档：

```markdown
## 交接：[前一位代理人] -> [下一位代理人]

### 背景
[已完成工作的总结]

### 发现
[关键发现或决定]

### 已修改的文件
[已触及的文件列表]

### 待解决的问题
[留给下一位代理人的未决事项]

### 建议
[建议的后续步骤]

```

## 示例：功能工作流

```
/orchestrate feature "Add user authentication"
```

执行：

1. **规划代理**
   * 分析需求
   * 创建实施计划
   * 识别依赖项
   * 输出：`HANDOFF: planner -> tdd-guide`

2. **TDD 指导代理**
   * 读取规划交接文档
   * 先编写测试
   * 实施代码以通过测试
   * 输出：`HANDOFF: tdd-guide -> code-reviewer`

3. **代码审查代理**
   * 审查实现
   * 检查问题
   * 提出改进建议
   * 输出：`HANDOFF: code-reviewer -> security-reviewer`

4. **安全审查代理**
   * 安全审计
   * 漏洞检查
   * 最终批准
   * 输出：最终报告

## 最终报告格式

```
编排报告
====================
工作流：功能
任务：添加用户认证
智能体：规划者 -> TDD指南 -> 代码审查员 -> 安全审查员

概要
-------
[一段总结]

智能体输出
-------------
规划者：[总结]
TDD指南：[总结]
代码审查员：[总结]
安全审查员：[总结]

已更改文件
-------------
[列出所有修改的文件]

测试结果
------------
[测试通过/失败总结]

安全状态
---------------
[安全发现]

建议
--------------
[可发布 / 需要改进 / 已阻止]
```

## 并行执行

对于独立的检查，并行运行代理：

```markdown
### 并行阶段
同时运行：
- code-reviewer（质量）
- security-reviewer（安全）
- architect（设计）

### 合并结果
将输出合并为单一报告

```

对于使用独立 git worktree 的外部 tmux-pane 工作器，请使用 `node scripts/orchestrate-worktrees.js plan.json --execute`。内置的编排模式保持进程内运行；此辅助工具适用于长时间运行或跨测试框架的会话。

当工作器需要查看主检出目录中的脏文件或未跟踪的本地文件时，请在计划文件中添加 `seedPaths`。ECC 仅在 `git worktree add` 之后，将那些选定的路径覆盖到每个工作器的工作树中，这既能保持分支隔离，又能暴露正在处理的本地脚本、计划或文档。

```json
{
  "sessionName": "workflow-e2e",
  "seedPaths": [
    "scripts/orchestrate-worktrees.js",
    "scripts/lib/tmux-worktree-orchestrator.js",
    ".claude/plan/workflow-e2e-test.json"
  ],
  "workers": [
    { "name": "docs", "task": "Update orchestration docs." }
  ]
}
```

要导出实时 tmux/worktree 会话的控制平面快照，请运行：

```bash
node scripts/orchestration-status.js .claude/plan/workflow-visual-proof.json
```

快照包含会话活动、tmux 窗格元数据、工作器状态、目标、已播种的覆盖层以及最近的交接摘要，均以 JSON 格式保存。

## 操作员指挥中心交接

当工作流跨越多个会话、工作树或 tmux 窗格时，请在最终交接内容中附加一个控制平面块：

```markdown
控制平面
-------------
会话：
- 活动会话 ID 或别名
- 每个活动工作线程的分支 + 工作树路径
- 适用时的 tmux 窗格或分离会话名称

差异：
- git 状态摘要
- 已修改文件的 git diff --stat
- 合并/冲突风险说明

审批：
- 待处理的用户审批
- 等待确认的受阻步骤

遥测：
- 最后活动时间戳或空闲信号
- 预估的令牌或成本漂移
- 由钩子或审查器引发的策略事件
```

这使得规划者、实施者、审查者和循环工作器在操作员界面上保持清晰可辨。

## 参数

$ARGUMENTS:

* `feature <description>` - 完整功能工作流
* `bugfix <description>` - 错误修复工作流
* `refactor <description>` - 重构工作流
* `security <description>` - 安全审查工作流
* `custom <agents> <description>` - 自定义代理序列

## 自定义工作流示例

```
/orchestrate 自定义 "architect,tdd-guide,code-reviewer" "重新设计缓存层"
```

## 提示

1. **从规划代理开始**处理复杂功能
2. **始终在合并前包含代码审查代理**
3. 处理认证/支付/个人身份信息时**使用安全审查代理**
4. **保持交接文档简洁** - 关注下一个代理需要什么
5. 如有需要，**在代理之间运行验证**
