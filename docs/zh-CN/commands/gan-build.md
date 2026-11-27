---
description: 运行生成器/评估器构建循环，用于实现任务，具有有限迭代和评分。
---

从 $ARGUMENTS 中解析以下内容：

1. `brief` — 用户对构建内容的一行描述
2. `--max-iterations N` — （可选，默认15）最大生成器-评估器循环次数
3. `--pass-threshold N` — （可选，默认7.0）通过所需的加权分数
4. `--skip-planner` — （可选）跳过规划器，假设 spec.md 已存在
5. `--eval-mode MODE` — （可选，默认"playwright"）可选值：playwright、screenshot、code-only

## GAN 风格构建框架

该命令协调一个受 Anthropic 2026年3月框架设计论文启发的三智能体构建循环。

### 阶段0：设置

1. 在项目根目录创建 `gan-harness/` 目录
2. 创建子目录：`gan-harness/feedback/`、`gan-harness/screenshots/`
3. 如果尚未初始化 git，则进行初始化
4. 记录开始时间和配置

### 阶段1：规划（规划器智能体）

除非设置了 `--skip-planner`：

1. 通过任务工具启动 `gan-planner` 智能体，并传入用户的简要说明
2. 等待其生成 `gan-harness/spec.md` 和 `gan-harness/eval-rubric.md`
3. 向用户显示规范摘要
4. 进入阶段2

### 阶段2：生成器-评估器循环

```
iteration = 1
while iteration <= max_iterations:

    # 生成
    通过 Task 工具启动 gan-generator agent：
    - 读取 spec.md
    - 如果 iteration > 1：读取 feedback/feedback-{iteration-1}.md
    - 构建/改进应用程序
    - 确保开发服务器正在运行
    - 提交更改

    # 等待生成器完成

    # 评估
    通过 Task 工具启动 gan-evaluator agent：
    - 读取 eval-rubric.md 和 spec.md
    - 测试正在运行的应用程序（模式：playwright/screenshot/code-only）
    - 根据评分标准打分
    - 将反馈写入 feedback/feedback-{iteration}.md

    # 等待评估器完成

    # 检查分数
    读取 feedback/feedback-{iteration}.md
    提取加权总分

    if score >= pass_threshold:
        记录 "在第 {iteration} 次迭代中通过，分数为 {score}"
        跳出循环

    if iteration >= 3 且最近 2 次迭代分数未提升:
        记录 "检测到平台期 — 提前停止"
        跳出循环

    iteration += 1
```

### 阶段3：总结

1. 读取所有反馈文件
2. 显示最终分数和迭代历史
3. 展示分数进展：`iteration 1: 4.2 → iteration 2: 5.8 → ... → iteration N: 7.5`
4. 列出最终评估中遗留的任何问题
5. 报告总时间和预估成本

### 输出

```markdown
## GAN 框架构建报告

**简述：** [原始提示]
**结果：** 通过/失败
**迭代次数：** N / 最大次数
**最终得分：** X.X / 10

### 得分进展
| 迭代 | 设计 | 原创性 | 工艺 | 功能性 | 总分 |
|------|------|--------|------|--------|------|
| 1 | ... | ... | ... | ... | X.X |
| 2 | ... | ... | ... | ... | X.X |
| N | ... | ... | ... | ... | X.X |

### 剩余问题
- [最终评估中的任何问题]

### 已创建文件
- gan-harness/spec.md
- gan-harness/eval-rubric.md
- gan-harness/feedback/feedback-001.md 至 feedback-NNN.md
- gan-harness/generator-state.md
- gan-harness/build-report.md
```

将完整报告写入 `gan-harness/build-report.md`。
