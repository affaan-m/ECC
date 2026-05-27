<div align="center">

# StageFlow

**The competition management platform for performing arts organisers.**

Branded portals, dancer/routine management, music uploads, payments, running orders, and judging — all in one place.

![Status](https://img.shields.io/badge/status-alpha-orange)
![License](https://img.shields.io/badge/license-proprietary-red)

</div>

---

## What is StageFlow

StageFlow is a multi-tenant SaaS for dance and performing-arts competition organisers. Each organiser gets a fully branded portal — on their own subdomain or custom domain — where dance studios can register dancers, submit routines, upload music, pay entry fees, and track invoices. Organisers manage everything from a powerful admin dashboard with exports, refunds, discount codes, an inbox to studios, and (Phase 2) a running-order builder with clash detection.

The portal is also **iframe-embeddable** into the organiser's existing website.

Built on Next.js 15, Supabase (Postgres + Auth + Storage), Tailwind v4, and Stripe Connect. Multi-tenant isolation is enforced at the database layer via Postgres Row-Level Security.

> **Status:** alpha. The first organiser onboarding is We Dance Nationals.

---

## Quick start

Aim: a new engineer should be running locally in under 10 minutes.

### Prerequisites

- Node.js 20 LTS — `node --version`
- pnpm 9+ — `corepack enable && corepack prepare pnpm@latest --activate`
- Docker Desktop (for local Supabase)
- Supabase CLI — `brew install supabase/tap/supabase` (or see [docs](https://supabase.com/docs/guides/cli))
- Stripe CLI — `brew install stripe/stripe-cli/stripe`
- A `.env.local` file (copy from `.env.example`)

### Run it

```bash
# 1. Clone & install
git clone git@github.com:stageflow/stageflow.git
cd stageflow
pnpm install

# 2. Start local Supabase (Postgres + Auth + Storage + Studio)
pnpm supabase start

# 3. Copy env vars from supabase output into .env.local
cp .env.example .env.local
# Paste the API URL, anon key, and service role key from `supabase start`

# 4. Apply migrations and seed data
pnpm db:reset

# 5. Generate TypeScript types from the schema
pnpm db:types

# 6. In a separate terminal, forward Stripe webhooks
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# 7. Run the dev server
pnpm dev
```

Open http://localhost:3000.

A seeded super-admin account is created during `pnpm db:reset`:
- Email: `admin@stageflow.local`
- Password: see `.env.example` for the `SEED_ADMIN_PASSWORD` default

### Local subdomains

The tenancy middleware needs subdomains to work locally. Add to `/etc/hosts`:

```
127.0.0.1   stageflow.local
127.0.0.1   wedancenationals.stageflow.local
127.0.0.1   demo.stageflow.local
```

Visit http://wedancenationals.stageflow.local:3000 to see the branded portal.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript strict |
| Database | Supabase (Postgres 15) with RLS |
| Auth | Supabase Auth (email/password + magic link, TOTP 2FA for admins) |
| Storage | Supabase Storage (private buckets, signed URLs) |
| Realtime | Supabase Realtime (inbox, notifications) |
| Background jobs | pg-boss (Postgres-backed queue) |
| Styling | Tailwind v4 + shadcn/ui + lucide-react |
| Forms | react-hook-form + zod |
| Payments | Stripe Connect (Standard) + Stripe Checkout |
| Email | Resend + react-email |
| Hosting | Vercel |
| CI/CD | GitHub Actions |
| Monitoring | Sentry + PostHog |
| Tests | Vitest (unit) + Playwright (e2e) |

---

## Common commands

```bash
# Development
pnpm dev                    # Next.js dev server
pnpm build                  # Production build
pnpm start                  # Run production build

# Quality
pnpm lint                   # ESLint
pnpm typecheck              # tsc --noEmit
pnpm test                   # Vitest (unit + integration)
pnpm test:e2e               # Playwright
pnpm test:rls               # Supabase RLS isolation tests

# Database (local Supabase)
pnpm supabase start         # Start local stack
pnpm supabase stop          # Stop local stack
pnpm db:reset               # Drop, re-migrate, re-seed
pnpm db:migrate             # Apply pending migrations
pnpm db:types               # Regenerate TypeScript types from schema
pnpm db:diff                # Generate a new migration from schema diff
pnpm db:seed                # Re-run seed script

# Stripe (local)
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Workspace
pnpm clean                  # Remove .next, node_modules cache
pnpm format                 # Prettier write
```

---

## Environments

| Environment | URL | Branch | Supabase project | Stripe |
|---|---|---|---|---|
| Local | `localhost:3000` + `*.stageflow.local` | (any) | local Docker | test mode |
| Staging | `staging.stageflow.app` | `develop` | `stageflow-staging` | test mode |
| Production | `stageflow.app` | `main` | `stageflow-prod` | live mode |

Every PR gets a Vercel preview URL automatically.

---

## License

Proprietary. All rights reserved.
