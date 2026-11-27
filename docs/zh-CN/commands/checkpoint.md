# 检查点命令

在你的工作流中创建或验证一个检查点。

## 用法

`/checkpoint [create|verify|list] [name]`

## 创建检查点

创建检查点时：

1. 运行 `/verify quick` 以确保当前状态是干净的
2. 使用检查点名称创建一个 git stash 或提交
3. 将检查点记录到 `.claude/checkpoints.log`：

```bash
echo "$(date +%Y-%m-%d-%H:%M) | $CHECKPOINT_NAME | $(git rev-parse --short HEAD)" >> .claude/checkpoints.log
```

4. 报告检查点已创建

## 验证检查点

根据检查点进行验证时：

1. 从日志中读取检查点

2. 将当前状态与检查点进行比较：
   * 自检查点以来新增的文件
   * 自检查点以来修改的文件
   * 现在的测试通过率与当时对比
   * 现在的覆盖率与当时对比

3. 报告：

```
检查点对比：$NAME
============================
文件更改数：X
测试结果：通过数 +Y / 失败数 -Z
覆盖率：+X% / -Y%
构建状态：[通过/失败]
```

## 列出检查点

显示所有检查点，包含：

* 名称
* 时间戳
* Git SHA
* 状态（当前、落后、超前）

## 工作流

典型的检查点流程：

```
[Start] --> /checkpoint create "feature-start"
   |
[Implement] --> /checkpoint create "core-done"
   |
[Test] --> /checkpoint verify "core-done"
   |
[Refactor] --> /checkpoint create "refactor-done"
   |
[PR] --> /checkpoint verify "feature-start"
```

## 参数

$ARGUMENTS:

* `create <name>` - 创建指定名称的检查点
* `verify <name>` - 根据指定名称的检查点进行验证
* `list` - 显示所有检查点
* `clear` - 删除旧的检查点（保留最后5个）
