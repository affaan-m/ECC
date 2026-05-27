# StageFlow — Setup Guide

Step-by-step instructions to get StageFlow running on your local machine.

---

## Phase 1: Install Prerequisites

### 1.1 Node.js 20 LTS

```bash
# macOS (Homebrew)
brew install node@20

# Or use nvm
nvm install 20
nvm use 20

# Verify
node --version  # Should show v20.x.x
```

### 1.2 pnpm 9+

```bash
corepack enable
corepack prepare pnpm@latest --activate

# Verify
pnpm --version  # Should show 9.x.x
```

### 1.3 Docker Desktop

Download from https://www.docker.com/products/docker-desktop/ and install.
Docker is required for running the local Supabase instance.

```bash
# Verify
docker --version
docker compose version
```

### 1.4 Supabase CLI

```bash
# macOS
brew install supabase/tap/supabase

# npm (any OS)
npm install -g supabase

# Verify
supabase --version
```

### 1.5 Stripe CLI

```bash
# macOS
brew install stripe/stripe-cli/stripe

# Other OS: https://stripe.com/docs/stripe-cli#install

# Login to Stripe (one-time)
stripe login

# Verify
stripe --version
```

---

## Phase 2: Clone & Install

```bash
cd stageflow
pnpm install
```

This installs all dependencies including:
- Next.js 15 + React 19
- Supabase JS client + SSR helpers
- Stripe SDK
- Tailwind CSS v4 + shadcn/ui components
- Vitest + Playwright for testing
- All other production and dev dependencies

---

## Phase 3: Start Local Supabase

```bash
# Start the local Supabase stack (Postgres, Auth, Storage, Studio, Inbucket)
pnpm supabase start
```

This will output connection details. Note the:
- **API URL** (usually `http://127.0.0.1:54321`)
- **anon key**
- **service_role key**
- **DB URL** (usually `postgresql://postgres:postgres@127.0.0.1:54322/postgres`)

### Supabase Studio

Open http://localhost:54323 to access the local Supabase Studio dashboard where you can browse tables, run SQL, and manage auth users.

### Inbucket (email testing)

Open http://localhost:54324 to see all emails sent by the local auth system (magic links, verification emails, etc.)

---

## Phase 4: Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in the values from `supabase start` output:

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<paste anon key>
SUPABASE_SERVICE_ROLE_KEY=<paste service_role key>
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

For Stripe (optional for initial development):

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

---

## Phase 5: Apply Migrations & Seed Data

```bash
# Apply all migrations and seed data (drops existing data!)
pnpm db:reset

# Generate TypeScript types from the schema
pnpm db:types
```

This creates:
- All 70+ tables with RLS enabled
- 311 RLS policies
- 131 performance indexes
- Helper functions (auth checks, sequence generator)
- Seed data (plans, demo org "We Dance Nationals", sample event, age groups, styles)

---

## Phase 6: Start Development Server

```bash
# Terminal 1: Next.js dev server
pnpm dev

# Terminal 2: Stripe webhook forwarding (optional)
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Open http://localhost:3000

### Local Subdomains

To test multi-tenant subdomain routing, add to `/etc/hosts`:

```
127.0.0.1   stageflow.local
127.0.0.1   wedancenationals.stageflow.local
127.0.0.1   demo.stageflow.local
```

Then visit http://wedancenationals.stageflow.local:3000

---

## Phase 7: Verify Everything Works

```bash
# Run unit tests
pnpm test

# Run linting
pnpm lint

# Run type checking
pnpm typecheck

# Run build
pnpm build
```

---

## Troubleshooting

### Supabase won't start

```bash
# Check Docker is running
docker info

# Reset Supabase containers
supabase stop --no-backup
supabase start
```

### Migrations fail

```bash
# Check migration syntax
pnpm supabase db reset --debug

# View migration logs
pnpm supabase db push --debug
```

### Types not generating

```bash
# Make sure Supabase is running
pnpm supabase status

# Re-generate
pnpm db:types
```

### Port conflicts

If port 3000 is in use:
```bash
pnpm dev -- -p 3001
```

If Supabase ports conflict:
Edit `supabase/config.toml` to change port numbers.
