# Eval 命令

管理基于评估的开发工作流。

## 用法

`/eval [define|check|report|list] [feature-name]`

## 定义评估

`/eval define feature-name`

创建新的评估定义：

1. 使用模板创建 `.claude/evals/feature-name.md`：

```markdown
## EVAL: 功能名称
创建于: $(date)

### 能力评估
- [ ] [能力 1 的描述]
- [ ] [能力 2 的描述]

### 回归评估
- [ ] [现有行为 1 仍然有效]
- [ ] [现有行为 2 仍然有效]

### 成功标准
- 能力评估的 pass@3 > 90%
- 回归评估的 pass^3 = 100%

```

2. 提示用户填写具体标准

## 检查评估

`/eval check feature-name`

为功能运行评估：

1. 从 `.claude/evals/feature-name.md` 读取评估定义
2. 对于每个能力评估：
   * 尝试验证标准
   * 记录 通过/失败
   * 在 `.claude/evals/feature-name.log` 中记录尝试
3. 对于每个回归评估：
   * 运行相关测试
   * 与基线比较
   * 记录 通过/失败
4. 报告当前状态：

```
EVAL CHECK: feature-name
========================
功能：X/Y 通过
回归测试：X/Y 通过
状态：进行中 / 就绪
```

## 报告评估

`/eval report feature-name`

生成全面的评估报告：

```
EVAL REPORT: feature-name
=========================
生成时间: $(date)

能力评估
----------------
[eval-1]: 通过 (pass@1)
[eval-2]: 通过 (pass@2) - 需要重试
[eval-3]: 失败 - 参见备注

回归测试
----------------
[test-1]: 通过
[test-2]: 通过
[test-3]: 通过

指标
-------
能力 pass@1: 67%
能力 pass@3: 100%
回归 pass^3: 100%

备注
-----
[任何问题、边界情况或观察结果]

建议
--------------
[SHIP / NEEDS WORK / BLOCKED]
```

## 列出评估

`/eval list`

显示所有评估定义：

```
功能模块定义
================
feature-auth      [3/5 通过] 进行中
feature-search    [5/5 通过] 就绪
feature-export    [0/4 通过] 未开始
```

## 参数

$ARGUMENTS:

* `define <name>` - 创建新的评估定义
* `check <name>` - 运行并检查评估
* `report <name>` - 生成完整报告
* `list` - 显示所有评估
* `clean` - 删除旧的评估日志（保留最近 10 次运行）
