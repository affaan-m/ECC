---
description: 通过 Context7 查找库或主题的当前文档。
---

# /docs

## 目的

查找库、框架或 API 的最新文档，并返回包含相关代码片段的摘要答案。使用 Context7 MCP（resolve-library-id 和 query-docs），因此答案反映的是当前文档，而非训练数据。

## 用法

```
/docs [library name] [question]
```

对于多单词参数，使用引号以便它们被解析为单个标记。示例：`/docs "Next.js" "How do I configure middleware?"`

如果省略了库或问题，则提示用户输入：

1. 库或产品名称（例如 Next.js、Prisma、Supabase）。
2. 具体问题或任务（例如“如何设置中间件？”、“认证方法”）。

## 工作流程

1. **解析库 ID** — 调用 Context7 工具 `resolve-library-id`，传入库名称和用户问题，以获取 Context7 兼容的库 ID（例如 `/vercel/next.js`）。
2. **查询文档** — 使用该库 ID 和用户问题调用 `query-docs`。
3. **总结** — 返回简洁的答案，并包含从获取的文档中提取的相关代码示例。提及库（如果相关，包括版本）。

## 输出

用户收到一个简短、准确的答案，该答案基于当前文档，并附带任何有帮助的代码片段。如果 Context7 不可用，则说明情况，并根据训练数据回答问题，并注明文档可能已过时。
