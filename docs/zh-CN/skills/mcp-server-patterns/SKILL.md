---
name: mcp-server-patterns
description: 使用Node/TypeScript SDK构建MCP服务器——工具、资源、提示、Zod验证、stdio与可流式HTTP对比。使用Context7或官方MCP文档获取最新API信息。
origin: ECC
---

# MCP 服务器模式

模型上下文协议（MCP）允许 AI 助手调用工具、读取资源和使用来自服务器的提示。在构建或维护 MCP 服务器时使用此技能。SDK API 会演进；请查阅 Context7（查询文档 "MCP"）或官方 MCP 文档以获取当前的方法名称和签名。

## 何时使用

在以下情况时使用：实现新的 MCP 服务器、添加工具或资源、选择 stdio 与 HTTP、升级 SDK，或调试 MCP 注册和传输问题。

## 工作原理

### 核心概念

* **工具**：模型可以调用的操作（例如搜索、运行命令）。根据 SDK 版本，使用 `registerTool()` 或 `tool()` 注册。
* **资源**：模型可以获取的只读数据（例如文件内容、API 响应）。根据 SDK 版本，使用 `registerResource()` 或 `resource()` 注册。处理程序通常接收一个 `uri` 参数。
* **提示**：客户端可以呈现的可重用参数化提示模板（例如在 Claude Desktop 中）。使用 `registerPrompt()` 或等效方法注册。
* **传输**：stdio 用于本地客户端（例如 Claude Desktop）；可流式 HTTP 是远程（Cursor、云端）的首选。传统 HTTP/SSE 用于向后兼容。

Node/TypeScript SDK 可能暴露 `tool()` / `resource()` 或 `registerTool()` / `registerResource()`；官方 SDK 已随时间变化。请始终根据当前 [MCP 文档](https://modelcontextprotocol.io) 或 Context7 进行验证。

### 使用 stdio 连接

对于本地客户端，创建一个 stdio 传输并将其传递给服务器的连接方法。确切的 API 因 SDK 版本而异（例如构造函数与工厂函数）。请参阅官方 MCP 文档或查询 Context7 中的 "MCP stdio server" 以获取当前模式。

保持服务器逻辑（工具 + 资源）独立于传输，以便您可以在入口点中插入 stdio 或 HTTP。

### 远程（可流式 HTTP）

对于 Cursor、云端或其他远程客户端，使用**可流式 HTTP**（根据当前规范，每个 MCP HTTP 端点）。仅在需要向后兼容性时支持传统 HTTP/SSE。

## 示例

### 安装和服务器设置

```bash
npm install @modelcontextprotocol/sdk zod
```

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "my-server", version: "1.0.0" });
```

使用您的 SDK 版本提供的 API 注册工具和资源：某些版本使用 `server.tool(name, description, schema, handler)`（位置参数），其他版本使用 `server.tool({ name, description, inputSchema }, handler)` 或 `registerTool()`。资源同理——当 API 提供时，在处理程序中包含一个 `uri`。请查阅官方 MCP 文档或 Context7 以获取当前的 `@modelcontextprotocol/sdk` 签名，避免复制粘贴错误。

使用 **Zod**（或 SDK 首选的模式格式）进行输入验证。

## 最佳实践

* **模式优先**：为每个工具定义输入模式；记录参数和返回形状。
* **错误处理**：返回结构化错误或模型可以解释的消息；避免原始堆栈跟踪。
* **幂等性**：尽可能使用幂等工具，以便重试是安全的。
* **速率和成本**：对于调用外部 API 的工具，请考虑速率限制和成本；在工具描述中加以说明。
* **版本控制**：在 package.json 中固定 SDK 版本；升级时查看发行说明。

## 官方 SDK 和文档

* **JavaScript/TypeScript**：`@modelcontextprotocol/sdk` (npm)。使用库名 "MCP" 的 Context7 以获取当前的注册和传输模式。
* **Go**：GitHub 上的官方 Go SDK (`modelcontextprotocol/go-sdk`)。
* **C#**：适用于 .NET 的官方 C# SDK。
