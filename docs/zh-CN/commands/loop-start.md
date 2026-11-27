# 循环启动命令

使用安全默认设置启动一个受管理的自主循环模式。

## 用法

`/loop-start [pattern] [--mode safe|fast]`

* `pattern`: `sequential`, `continuous-pr`, `rfc-dag`, `infinite`
* `--mode`:
  * `safe` (默认): 严格的质量门禁和检查点
  * `fast`: 为速度而减少门禁

## 流程

1. 确认仓库状态和分支策略。
2. 选择循环模式和模型层级策略。
3. 为所选模式启用所需的钩子/配置文件。
4. 创建循环计划并在 `.claude/plans/` 下编写运行手册。
5. 打印用于启动和监控循环的命令。

## 必需的安全检查

* 在首次循环迭代前验证测试通过。
* 确保 `ECC_HOOK_PROFILE` 未在全局范围内被禁用。
* 确保循环有明确的停止条件。

## 参数

$ARGUMENTS:

* `<pattern>` 可选 (`sequential|continuous-pr|rfc-dag|infinite`)
* `--mode safe|fast` 可选
