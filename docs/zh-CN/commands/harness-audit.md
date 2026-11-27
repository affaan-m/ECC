# 工具链审计命令

运行确定性仓库框架审计并返回优先级评分卡。

## 使用方式

`/harness-audit [scope] [--format text|json]`

* `scope` (可选): `repo` (默认), `hooks`, `skills`, `commands`, `agents`
* `--format`: 输出样式 (`text` 默认, `json` 用于自动化)

## 确定性引擎

始终运行：

```bash
node scripts/harness-audit.js <scope> --format <text|json>
```

此脚本是评分和检查的单一事实来源。不要发明额外的维度或临时添加评分点。

评分标准版本：`2026-03-16`。

该脚本计算 7 个固定类别（每个类别标准化为 `0-10`）：

1. 工具覆盖度
2. 上下文效率
3. 质量门禁
4. 记忆持久化
5. 评估覆盖度
6. 安全护栏
7. 成本效率

分数源自显式的文件/规则检查，并且对于同一提交是可复现的。

## 输出约定

返回：

1. `overall_score` 分（满分 `max_score` 分；`repo` 为 70 分；范围限定审计则分数更小）
2. 类别分数及具体发现项
3. 失败的检查及其确切的文件路径
4. 确定性输出的前 3 项行动（`top_actions`）
5. 建议接下来应用的 ECC 技能

## 检查清单

* 直接使用脚本输出；不要手动重新评分。
* 如果请求 `--format json`，则原样返回脚本的 JSON 输出。
* 如果请求文本输出，则总结失败的检查和首要行动。
* 包含来自 `checks[]` 和 `top_actions[]` 的确切文件路径。

## 结果示例

```text
Harness 审计 (代码库): 66/70
- 工具覆盖率: 10/10 (10/10 分)
- 上下文效率: 9/10 (9/10 分)
- 质量门禁: 10/10 (10/10 分)

首要三项行动:
1) [安全防护] 在 hooks/hooks.json 中添加提示/工具预检安全防护。 (hooks/hooks.json)
2) [工具覆盖率] 同步 commands/harness-audit.md 和 .opencode/commands/harness-audit.md。 (.opencode/commands/harness-audit.md)
3) [评估覆盖率] 提升 scripts/hooks/lib 目录下的自动化测试覆盖率。 (tests/)
```

## 参数

$ARGUMENTS:

* `repo|hooks|skills|commands|agents` (可选范围)
* `--format text|json` (可选输出格式)
