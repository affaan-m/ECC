---
name: code-tour
description: 创建 CodeTour `.tour` 文件——针对特定角色的、带有真实文件和行锚点的逐步演练。用于入职引导、架构演练、PR 演练、RCA 演练以及结构化的“解释其工作原理”请求。
origin: ECC
---

# 代码导览

创建 **CodeTour** `.tour` 文件，用于代码库导览，可直接打开真实文件并定位到指定行范围。导览文件存放在 `.tours/` 目录中，专为 CodeTour 格式设计，而非临时性的 Markdown 笔记。

一个好的导览应针对特定读者讲述一个故事：

* 他们正在查看什么
* 为什么重要
* 接下来应该遵循什么路径

仅创建 `.tour` JSON 文件。不要在此技能范围内修改源代码。

## 何时使用

在以下情况下使用此技能：

* 用户请求代码导览、入职导览、架构导览或 PR 导览
* 用户说“解释 X 如何工作”，并希望获得可重用的引导式产物
* 用户希望为新工程师或审阅者提供上手路径
* 相比平铺直叙的摘要，引导式序列更适合该任务

示例：

* 新维护者入职
* 单个服务或包的架构导览
* 锚定到变更文件的 PR 审查导览
* 展示故障路径的根本原因分析导览
* 信任边界和关键检查的安全审查导览

## 何时不使用

| 不使用代码导览的情况 | 使用 |
| --- | --- |
| 在聊天中一次性解释就足够了 | 直接回答 |
| 用户想要散文式文档，而不是 `.tour` 产物 | `documentation-lookup` 或仓库文档编辑 |
| 任务是实现或重构 | 执行实现工作 |
| 任务是没有导览产物的广泛代码库入职 | `codebase-onboarding` |

## 工作流程

### 1. 探索

在编写任何内容之前探索仓库：

* README 和包/应用入口点
* 文件夹结构
* 相关配置文件
* 如果导览聚焦于 PR，则查看变更的文件

在理解代码结构之前，不要开始编写步骤。

### 2. 推断读者

根据请求确定角色和深度。

| 请求形式 | 角色 | 建议深度 |
| --- | --- | --- |
| "入职"，"新成员" | `new-joiner` | 9-13 步 |
| "快速导览"，"快速了解" | `vibecoder` | 5-8 步 |
| "架构" | `architect` | 14-18 步 |
| "导览此 PR" | `pr-reviewer` | 7-11 步 |
| "为什么这个出错了" | `rca-investigator` | 7-11 步 |
| "安全审查" | `security-reviewer` | 7-11 步 |
| "解释此功能如何工作" | `feature-explainer` | 7-11 步 |
| "调试此路径" | `bug-fixer` | 7-11 步 |

### 3. 读取并验证锚点

每个文件路径和行锚点必须是真实的：

* 确认文件存在
* 确认行号在范围内
* 如果使用选区，验证确切的代码块
* 如果文件易变，优先使用基于模式的锚点

切勿猜测行号。

### 4. 编写 `.tour`

写入：

```text
.tours/<persona>-<focus>.tour
```

保持路径确定且可读。

### 5. 验证

在完成之前：

* 每个引用的路径都存在
* 每行或每个选区都有效
* 第一步锚定到真实文件或目录
* 导览讲述连贯的故事，而非罗列文件

## 步骤类型

### 内容

谨慎使用，通常仅用于结束步骤：

```json
{ "title": "Next Steps", "description": "You can now trace the request path end to end." }
```

不要将第一步设为纯内容。

### 目录

用于引导读者了解模块：

```json
{ "directory": "src/services", "title": "Service Layer", "description": "The core orchestration logic lives here." }
```

### 文件 + 行

这是默认步骤类型：

```json
{ "file": "src/auth/middleware.ts", "line": 42, "title": "Auth Gate", "description": "Every protected request passes here first." }
```

### 选区

当某个代码块比整个文件更重要时使用：

```json
{
  "file": "src/core/pipeline.ts",
  "selection": {
    "start": { "line": 15, "character": 0 },
    "end": { "line": 34, "character": 0 }
  },
  "title": "Request Pipeline",
  "description": "This block wires validation, auth, and downstream execution."
}
```

### 模式

当精确行号可能发生变化时使用：

```json
{ "file": "src/app.ts", "pattern": "export default class App", "title": "Application Entry" }
```

### URI

在需要时用于 PR、问题或文档：

```json
{ "uri": "https://github.com/org/repo/pull/456", "title": "The PR" }
```

## 编写规则：SMIG

每个描述应回答：

* **情境**：读者正在查看什么
* **机制**：它是如何工作的
* **影响**：为什么对此角色重要
* **陷阱**：聪明的读者可能会错过什么

保持描述简洁、具体，并基于实际代码。

## 叙事结构

除非任务明确需要不同结构，否则使用此弧线：

1. 定位
2. 模块地图
3. 核心执行路径
4. 边缘情况或陷阱
5. 结束 / 下一步

导览应感觉像一条路径，而非清单。

## 示例

```json
{
  "$schema": "https://aka.ms/codetour-schema",
  "title": "API Service Tour",
  "description": "Walkthrough of the request path for the payments service.",
  "ref": "main",
  "steps": [
    {
      "directory": "src",
      "title": "Source Root",
      "description": "All runtime code for the service starts here."
    },
    {
      "file": "src/server.ts",
      "line": 12,
      "title": "Entry Point",
      "description": "The server boots here and wires middleware before any route is reached."
    },
    {
      "file": "src/routes/payments.ts",
      "line": 8,
      "title": "Payment Routes",
      "description": "Every payments request enters through this router before hitting service logic."
    },
    {
      "title": "Next Steps",
      "description": "You can now follow any payment request end to end with the main anchors in place."
    }
  ]
}
```

## 反模式

| 反模式 | 修复 |
| --- | --- |
| 平铺直叙的文件列表 | 讲述一个步骤间有依赖关系的故事 |
| 通用描述 | 指明具体的代码路径或模式 |
| 猜测的锚点 | 先验证每个文件和行 |
| 快速导览步骤过多 | 果断精简 |
| 第一步是纯内容 | 将第一步锚定到真实文件或目录 |
| 角色不匹配 | 为实际读者编写，而非通用工程师 |

## 最佳实践

* 步骤数量与仓库大小和角色深度成比例
* 使用目录步骤进行定位，文件步骤用于实质内容
* 对于 PR 导览，首先覆盖变更的文件
* 对于单体仓库，将范围限定在相关包，而非导览所有内容
* 以读者现在可以做什么来结束，而非总结

## 相关技能

* `codebase-onboarding`
* `coding-standards`
* `council`
* 官方上游格式：`microsoft/codetour`
