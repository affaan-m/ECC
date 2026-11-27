# 模型路由命令

根据任务复杂度和预算推荐最佳模型层级。

## 用法

`/model-route [task-description] [--budget low|med|high]`

## 路由启发式规则

* `haiku`: 确定性、低风险的机械性变更
* `sonnet`: 实现和重构的默认选择
* `opus`: 架构设计、深度评审、模糊需求

## 必需输出

* 推荐的模型
* 置信度
* 该模型适合的原因
* 如果首次尝试失败，备用的回退模型

## 参数

$ARGUMENTS:

* `[task-description]` 可选，自由文本
* `--budget low|med|high` 可选
