# Aplicação SaaS — CLAUDE.md de Projeto

> Exemplo real para uma aplicação SaaS com Next.js + Supabase + Stripe.
> Copie para a raiz do seu projeto e customize para sua stack.

## Visão Geral do Projeto

**Stack:** Next.js 15 (App Router), TypeScript, Supabase (auth + DB), Stripe (billing), Tailwind CSS, Playwright (E2E)

**Arquitetura:** Server Components por padrão. Client Components apenas para interatividade. API routes para webhooks e server actions para mutações.

## Regras Críticas

### Banco de Dados

- Todas as queries usam cliente Supabase com RLS habilitado — nunca bypass de RLS
- Migrations em `supabase/migrations/` — nunca modificar banco diretamente
- Use `select()` com lista explícita de colunas, não `select('*')`
- Todas as queries user-facing devem incluir `.limit()` para evitar resultados sem limite

### Autenticação

- Use `createServerClient()` de `@supabase/ssr` em Server Components
- Use `createBrowserClient()` de `@supabase/ssr` em Client Components
- Rotas protegidas checam `getUser()` — nunca confiar só em `getSession()` para auth
- Middleware em `middleware.ts` renova tokens de auth em toda requisição

### Billing

- Handler de webhook Stripe em `app/api/webhooks/stripe/route.ts`
- Nunca confiar em preço do cliente — sempre buscar do Stripe server-side
- Status da assinatura checado via coluna `subscription_status`, sincronizada por webhook
- Usuários free tier: 3 projetos, 100 chamadas de API/dia

### Estilo de Código

- Sem emojis em código ou comentários
- Apenas padrões imutáveis — spread operator, nunca mutar
- Server Components: sem diretiva `'use client'`, sem `useState`/`useEffect`
- Client Components: `'use client'` no topo, mínimo possível — extraia lógica para hooks
- Prefira schemas Zod para toda validação de entrada (API routes, formulários, env vars)

## Estrutura de Arquivos

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

## Padrões-Chave

### Formato de Resposta de API

```typescript
type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }
```

### Padrão de Server Action

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

## Variáveis de Ambiente

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

## Estratégia de Teste

```bash
/tdd                    # Unit + integration tests for new features
/e2e                    # Playwright tests for auth flow, billing, dashboard
/test-coverage          # Verify 80%+ coverage
```

### Fluxos E2E Críticos

1. Sign up → verificação de e-mail → criação do primeiro projeto
2. Login → dashboard → operações CRUD
3. Upgrade de plano → Stripe checkout → assinatura ativa
4. Webhook: assinatura cancelada → downgrade para free tier

## Workflow ECC

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

## Fluxo Git

- `feat:` novas features, `fix:` correções de bug, `refactor:` mudanças de código
- Branches de feature a partir da `main`, PRs obrigatórios
- CI roda: lint, type-check, unit tests, E2E tests
- Deploy: preview da Vercel em PR, produção no merge para `main`
