---
name: ai-regression-testing
description: AI辅助开发的回归测试策略。沙盒模式API测试，无需依赖数据库，自动化的缺陷检查工作流程，以及捕捉AI盲点的模式，其中同一模型编写和审查代码。
origin: ECC
---

# AI 回归测试

专为 AI 辅助开发设计的测试模式，其中同一模型编写代码并审查代码——这会形成系统性的盲点，只有自动化测试才能发现。

## 何时激活

* AI 代理（Claude Code、Cursor、Codex）已修改 API 路由或后端逻辑
* 发现并修复了一个 bug——需要防止重新引入
* 项目具有沙盒/模拟模式，可用于无需数据库的测试
* 在代码更改后运行 `/bug-check` 或类似的审查命令
* 存在多个代码路径（沙盒与生产环境、功能开关等）

## 核心问题

当 AI 编写代码然后审查其自身工作时，它会将相同的假设带入这两个步骤。这会形成一个可预测的失败模式：

```
AI 编写修复 → AI 审查修复 → AI 表示“看起来正确” → 漏洞依然存在
```

**实际示例**（在生产环境中观察到）：

```
修复 1：向 API 响应添加了 notification_settings
  → 忘记将其添加到 SELECT 查询中
  → AI 审核时遗漏了（相同的盲点）

修复 2：将其添加到 SELECT 查询中
  → TypeScript 构建错误（列不在生成的类型中）
  → AI 审核了修复 1，但未发现 SELECT 问题

修复 3：改为 SELECT *
  → 修复了生产路径，忘记了沙箱路径
  → AI 审核时再次遗漏（第 4 次出现）

修复 4：测试在首次运行时立即捕获了问题 PASS:
```

模式：**沙盒/生产环境路径不一致**是 AI 引入的 #1 回归问题。

## 沙盒模式 API 测试

大多数具有 AI 友好架构的项目都有一个沙盒/模拟模式。这是实现快速、无需数据库的 API 测试的关键。

### 设置（Vitest + Next.js App Router）

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["__tests__/**/*.test.ts"],
    setupFiles: ["__tests__/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

```typescript
// __tests__/setup.ts
// Force sandbox mode — no database needed
process.env.SANDBOX_MODE = "true";
process.env.NEXT_PUBLIC_SUPABASE_URL = "";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
```

### Next.js API 路由的测试辅助工具

```typescript
// __tests__/helpers.ts
import { NextRequest } from "next/server";

export function createTestRequest(
  url: string,
  options?: {
    method?: string;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    sandboxUserId?: string;
  },
): NextRequest {
  const { method = "GET", body, headers = {}, sandboxUserId } = options || {};
  const fullUrl = url.startsWith("http") ? url : `http://localhost:3000${url}`;
  const reqHeaders: Record<string, string> = { ...headers };

  if (sandboxUserId) {
    reqHeaders["x-sandbox-user-id"] = sandboxUserId;
  }

  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers: reqHeaders,
  };

  if (body) {
    init.body = JSON.stringify(body);
    reqHeaders["content-type"] = "application/json";
  }

  return new NextRequest(fullUrl, init);
}

export async function parseResponse(response: Response) {
  const json = await response.json();
  return { status: response.status, json };
}
```

### 编写回归测试

关键原则：**为已发现的 bug 编写测试，而不是为正常工作的代码编写测试**。

```typescript
// __tests__/api/user/profile.test.ts
import { describe, it, expect } from "vitest";
import { createTestRequest, parseResponse } from "../../helpers";
import { GET, PATCH } from "@/app/api/user/profile/route";

// Define the contract — what fields MUST be in the response
const REQUIRED_FIELDS = [
  "id",
  "email",
  "full_name",
  "phone",
  "role",
  "created_at",
  "avatar_url",
  "notification_settings",  // ← Added after bug found it missing
];

describe("GET /api/user/profile", () => {
  it("returns all required fields", async () => {
    const req = createTestRequest("/api/user/profile");
    const res = await GET(req);
    const { status, json } = await parseResponse(res);

    expect(status).toBe(200);
    for (const field of REQUIRED_FIELDS) {
      expect(json.data).toHaveProperty(field);
    }
  });

  // Regression test — this exact bug was introduced by AI 4 times
  it("notification_settings is not undefined (BUG-R1 regression)", async () => {
    const req = createTestRequest("/api/user/profile");
    const res = await GET(req);
    const { json } = await parseResponse(res);

    expect("notification_settings" in json.data).toBe(true);
    const ns = json.data.notification_settings;
    expect(ns === null || typeof ns === "object").toBe(true);
  });
});
```

### 测试沙盒/生产环境一致性

最常见的 AI 回归问题：修复了生产环境路径但忘记了沙盒路径（或反之）。

```typescript
// Test that sandbox responses match the expected contract
describe("GET /api/user/messages (conversation list)", () => {
  it("includes partner_name in sandbox mode", async () => {
    const req = createTestRequest("/api/user/messages", {
      sandboxUserId: "user-001",
    });
    const res = await GET(req);
    const { json } = await parseResponse(res);

    // This caught a bug where partner_name was added
    // to production path but not sandbox path
    if (json.data.length > 0) {
      for (const conv of json.data) {
        expect("partner_name" in conv).toBe(true);
      }
    }
  });
});
```

## 将测试集成到 Bug 检查工作流中

### 自定义命令定义

```markdown
<!-- .claude/commands/bug-check.md -->
# Bug 检查

## 步骤 1：自动化测试（强制，不可跳过）

在代码审查前**首先**运行以下命令：

    npm run test       # Vitest 测试套件
    npm run build      # TypeScript 类型检查 + 构建

- 如果测试失败 → 报告为最高优先级 Bug
- 如果构建失败 → 将类型错误报告为最高优先级
- 只有在两者都通过后，才能继续到步骤 2

## 步骤 2：代码审查（AI 审查）

1. 沙盒/生产环境路径一致性
2. API 响应结构是否符合前端预期
3. SELECT 子句的完整性
4. 包含回滚的错误处理
5. 乐观更新的竞态条件

## 步骤 3：对于每个修复的 Bug，提出回归测试方案
```

### 工作流程

```
User: "バグチェックして" (or "/bug-check")
  │
  ├─ Step 1: npm run test
  │   ├─ FAIL → 发现机械性错误（无需AI判断）
  │   └─ PASS → 继续
  │
  ├─ Step 2: npm run build
  │   ├─ FAIL → 发现类型错误
  │   └─ PASS → 继续
  │
  ├─ Step 3: AI代码审查（考虑已知盲点）
  │   └─ 报告发现的问题
  │
  └─ Step 4: 对每个修复编写回归测试
      └─ 下次bug-check时捕获修复是否破坏功能
```

## 常见的 AI 回归模式

### 模式 1：沙盒/生产环境路径不匹配

**频率**：最常见（在 4 个回归问题中观察到 3 个）

```typescript
// FAIL: AI adds field to production path only
if (isSandboxMode()) {
  return { data: { id, email, name } };  // Missing new field
}
// Production path
return { data: { id, email, name, notification_settings } };

// PASS: Both paths must return the same shape
if (isSandboxMode()) {
  return { data: { id, email, name, notification_settings: null } };
}
return { data: { id, email, name, notification_settings } };
```

**用于捕获它的测试**：

```typescript
it("sandbox and production return same fields", async () => {
  // In test env, sandbox mode is forced ON
  const res = await GET(createTestRequest("/api/user/profile"));
  const { json } = await parseResponse(res);

  for (const field of REQUIRED_FIELDS) {
    expect(json.data).toHaveProperty(field);
  }
});
```

### 模式 2：SELECT 子句遗漏

**频率**：在使用 Supabase/Prisma 添加新列时常见

```typescript
// FAIL: New column added to response but not to SELECT
const { data } = await supabase
  .from("users")
  .select("id, email, name")  // notification_settings not here
  .single();

return { data: { ...data, notification_settings: data.notification_settings } };
// → notification_settings is always undefined

// PASS: Use SELECT * or explicitly include new columns
const { data } = await supabase
  .from("users")
  .select("*")
  .single();
```

### 模式 3：错误状态泄漏

**频率**：中等——当向现有组件添加错误处理时

```typescript
// FAIL: Error state set but old data not cleared
catch (err) {
  setError("Failed to load");
  // reservations still shows data from previous tab!
}

// PASS: Clear related state on error
catch (err) {
  setReservations([]);  // Clear stale data
  setError("Failed to load");
}
```

### 模式 4：乐观更新未正确回滚

```typescript
// FAIL: No rollback on failure
const handleRemove = async (id: string) => {
  setItems(prev => prev.filter(i => i.id !== id));
  await fetch(`/api/items/${id}`, { method: "DELETE" });
  // If API fails, item is gone from UI but still in DB
};

// PASS: Capture previous state and rollback on failure
const handleRemove = async (id: string) => {
  const prevItems = [...items];
  setItems(prev => prev.filter(i => i.id !== id));
  try {
    const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("API error");
  } catch {
    setItems(prevItems);  // Rollback
    alert("削除に失敗しました");
  }
};
```

## 策略：在发现 Bug 的地方进行测试

不要追求 100% 的覆盖率。相反：

```
在 /api/user/profile 发现 bug → 为 profile API 编写测试
在 /api/user/messages 发现 bug → 为 messages API 编写测试
在 /api/user/favorites 发现 bug → 为 favorites API 编写测试
在 /api/user/notifications 没有发现 bug → 暂时不编写测试
```

**为什么这在 AI 开发中有效：**

1. AI 倾向于重复犯**同一类错误**
2. Bug 集中在复杂区域（身份验证、多路径逻辑、状态管理）
3. 一旦经过测试，该特定回归问题**就不会再次发生**
4. 测试数量随着 Bug 修复而有机增长——没有浪费精力

## 快速参考

| AI 回归模式 | 测试策略 | 优先级 |
|---|---|---|
| 沙盒/生产环境不匹配 | 断言沙盒模式下响应结构相同 |  高 |
| SELECT 子句遗漏 | 断言响应中包含所有必需字段 |  高 |
| 错误状态泄漏 | 断言出错时状态已清理 |  中 |
| 缺少回滚 | 断言 API 失败时状态已恢复 |  中 |
| 类型转换掩盖 null | 断言字段不为 undefined |  中 |

## 要 / 不要

**要：**

* 发现 bug 后立即编写测试（如果可能，在修复之前）
* 测试 API 响应结构，而不是实现细节
* 将运行测试作为每次 bug 检查的第一步
* 保持测试快速（在沙盒模式下总计 < 1 秒）
* 以测试所预防的 bug 来命名测试（例如，"BUG-R1 regression"）

**不要：**

* 为从未出现过 bug 的代码编写测试
* 相信 AI 自我审查可以作为自动化测试的替代品
* 因为“只是模拟数据”而跳过沙盒路径测试
* 在单元测试足够时编写集成测试
* 追求覆盖率百分比——追求回归预防
