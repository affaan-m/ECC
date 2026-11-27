---
name: instinct-export
description: 将项目/全局范围的本能导出到文件
command: /instinct-export
---

# 本能导出命令

将本能导出为可共享的格式。非常适合：

* 与团队成员分享
* 转移到新机器
* 贡献给项目约定

## 用法

```
/instinct-export                           # 导出所有个人本能
/instinct-export --domain testing          # 仅导出测试相关本能
/instinct-export --min-confidence 0.7      # 仅导出高置信度本能
/instinct-export --output team-instincts.yaml
/instinct-export --scope project --output project-instincts.yaml
```

## 操作步骤

1. 检测当前项目上下文
2. 按选定范围加载本能：
   * `project`: 仅限当前项目
   * `global`: 仅限全局
   * `all`: 项目与全局合并（默认）
3. 应用过滤器（`--domain`, `--min-confidence`）
4. 将 YAML 格式的导出写入文件（如果未提供输出路径，则写入标准输出）

## 输出格式

创建一个 YAML 文件：

```yaml
# Instincts Export
# Generated: 2025-01-22
# Source: personal
# Count: 12 instincts

---
id: prefer-functional-style
trigger: "when writing new functions"
confidence: 0.8
domain: code-style
source: session-observation
scope: project
project_id: a1b2c3d4e5f6
project_name: my-app
---

# Prefer Functional Style

## Action
Use functional patterns over classes.
```

## 标志

* `--domain <name>`: 仅导出指定领域
* `--min-confidence <n>`: 最低置信度阈值
* `--output <file>`: 输出文件路径（省略时打印到标准输出）
* `--scope <project|global|all>`: 导出范围（默认：`all`）
