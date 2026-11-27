# SaaS Application — Project CLAUDE.md

> Real-world example for a Next.js + Supabase + Stripe SaaS application.
> Copy this to your project root and customize for your stack.

## Project Overview

**Stack:** Next.js 15 (App Router), TypeScript, Supabase (auth + DB), Stripe (billing), Tailwind CSS, Playwright (E2E)

**Architecture:** Server Components by default. Client Components only for interactivity. API routes for webhooks and server actions for mutations.

## Critical Rules

### Database

- All queries use Supabase client with RLS enabled — never bypass RLS
- Migrations in `supabase/migrations/` — never modify the database directly
- Use `select()` with explicit column lists, not `select('*')`
- All user-facing queries must include `.limit()` to prevent unbounded results

### Authentication

- Use `createServerClient()` from `@supabase/ssr` in Server Components
- Use `createBrowserClient()` from `@supabase/ssr` in Client Components
- Protected routes check `getUser()` — never trust `getSession()` alone for auth
- Middleware in `middleware.ts` refreshes auth tokens on every request

### Billing

- Stripe webhook handler in `app/api/webhooks/stripe/route.ts`
- Never trust client-side price data — always fetch from Stripe server-side
- Subscription status checked via `subscription_status` column, synced by webhook
- Free tier users: 3 projects, 100 API calls/day

### Code Style

- No emojis in code or comments
- Immutable patterns only — spread operator, never mutate
- Server Components: no `'use client'` directive, no `useState`/`useEffect`
- Client Components: `'use client'` at top, minimal — extract logic to hooks
- Prefer Zod schemas for all input validation (API routes, forms, env vars)

## File Structure

```
src/
  app/
    (auth)/          # Auth pages (login, signup, forgot-password)
    (dashboard)/     # Protected dashboard pages
    api/
      webhooks/      # Stripe, Supabase webhooks
    layout.tsx       # Root layout with providers
  components/
    ui/              # Shadcn/ui components
    forms/           # Form components with validation
    dashboard/       # Dashboard-specific components
  hooks/             # Custom React hooks
  lib/
    supabase/        # Supabase client factories
    stripe/          # Stripe client and helpers
    utils.ts         # General utilities
  types/             # Shared TypeScript types
supabase/
  migrations/        # Database migrations
  seed.sql           # Development seed data
```

## Key Patterns

### API Response Format

```typescript
type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }
```

### Server Action Pattern

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

## Environment Variables

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

## Testing Strategy

```bash
/tdd                    # Unit + integration tests for new features
/e2e                    # Playwright tests for auth flow, billing, dashboard
/test-coverage          # Verify 80%+ coverage
```

### Critical E2E Flows

1. Sign up → email verification → first project creation
2. Login → dashboard → CRUD operations
3. Upgrade plan → Stripe checkout → subscription active
4. Webhook: subscription canceled → downgrade to free tier

## ECC Workflow

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

## Git Workflow

- `feat:` new features, `fix:` bug fixes, `refactor:` code changes
- Feature branches from `main`, PRs required
- CI runs: lint, type-check, unit tests, E2E tests
- Deploy: Vercel preview on PR, production on merge to `main`
