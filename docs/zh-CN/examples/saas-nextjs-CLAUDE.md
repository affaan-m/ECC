# SaaS 应用程序 — 项目 CLAUDE.md

> 一个 Next.js + Supabase + Stripe SaaS 应用程序的真实示例。
> 将此复制到您的项目根目录，并根据您的技术栈进行自定义。

## 项目概览

**技术栈：** Next.js 15（App Router）、TypeScript、Supabase（身份验证 + 数据库）、Stripe（计费）、Tailwind CSS、Playwright（端到端测试）

**架构：** 默认使用服务器组件。仅在需要交互性时使用客户端组件。API 路由用于 Webhook，服务器操作用于数据变更。

## 关键规则

### 数据库

* 所有查询均使用启用 RLS 的 Supabase 客户端 — 绝不要绕过 RLS
* 迁移在 `supabase/migrations/` 中 — 绝不要直接修改数据库
* 使用带有明确列列表的 `select()`，而不是 `select('*')`
* 所有面向用户的查询必须包含 `.limit()` 以防止返回无限制的结果

### 身份验证

* 在服务器组件中使用来自 `@supabase/ssr` 的 `createServerClient()`
* 在客户端组件中使用来自 `@supabase/ssr` 的 `createBrowserClient()`
* 受保护的路由检查 `getUser()` — 绝不要仅依赖 `getSession()` 进行身份验证
* `middleware.ts` 中的中间件会在每个请求上刷新身份验证令牌

### 计费

* Stripe webhook 处理程序在 `app/api/webhooks/stripe/route.ts` 中
* 绝不要信任客户端的定价数据 — 始终在服务器端从 Stripe 获取
* 通过 `subscription_status` 列检查订阅状态，由 webhook 同步
* 免费层用户：3 个项目，每天 100 次 API 调用

### 代码风格

* 代码或注释中不使用表情符号
* 仅使用不可变模式 — 使用展开运算符，永不直接修改
* 服务器组件：不使用 `'use client'` 指令，不使用 `useState`/`useEffect`
* 客户端组件：`'use client'` 放在顶部，保持最小化 — 将逻辑提取到钩子中
* 所有输入验证（API 路由、表单、环境变量）优先使用 Zod 模式

## 文件结构

```
src/
  app/
    (auth)/          # 认证页面（登录、注册、忘记密码）
    (dashboard)/     # 受保护的仪表板页面
    api/
      webhooks/      # Stripe、Supabase webhooks
    layout.tsx       # 根布局（包含 providers）
  components/
    ui/              # Shadcn/ui 组件
    forms/           # 带验证的表单组件
    dashboard/       # 仪表板专用组件
  hooks/             # 自定义 React hooks
  lib/
    supabase/        # Supabase 客户端工厂
    stripe/          # Stripe 客户端与辅助工具
    utils.ts         # 通用工具函数
  types/             # 共享 TypeScript 类型
supabase/
  migrations/        # 数据库迁移
  seed.sql           # 开发用种子数据
```

## 关键模式

### API 响应格式

```typescript
type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }
```

### 服务器操作模式

```typescript
'use server'

import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'

const schema = z.object({
  name: z.string().min(1).max(100),
})

export async function createProject(formData: FormData) {
  const parsed = schema.safeParse({ name: formData.get('name') })
  if (!parsed.success) {
    return { success: false, error: parsed.error.flatten() }
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Unauthorized' }

  const { data, error } = await supabase
    .from('projects')
    .insert({ name: parsed.data.name, user_id: user.id })
    .select('id, name, created_at')
    .single()

  if (error) return { success: false, error: 'Failed to create project' }
  return { success: true, data }
}
```

## 环境变量

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # Server-only, never expose to client

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## 测试策略

```bash
/tdd                    # Unit + integration tests for new features
/e2e                    # Playwright tests for auth flow, billing, dashboard
/test-coverage          # Verify 80%+ coverage
```

### 关键的端到端测试流程

1. 注册 → 邮箱验证 → 创建第一个项目
2. 登录 → 仪表盘 → CRUD 操作
3. 升级计划 → Stripe 结账 → 订阅激活
4. Webhook：订阅取消 → 降级到免费层

## ECC 工作流

```bash
# Planning a feature
/plan "Add team invitations with email notifications"

# Developing with TDD
/tdd

# Before committing
/code-review
/security-scan

# Before release
/e2e
/test-coverage
```

## Git 工作流

* `feat:` 新功能，`fix:` 错误修复，`refactor:` 代码变更
* 从 `main` 创建功能分支，需要 PR
* CI 运行：代码检查、类型检查、单元测试、端到端测试
* 部署：在 PR 上部署到 Vercel 预览环境，在合并到 `main` 时部署到生产环境
