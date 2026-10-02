---
name: prisma-patterns
description: Prisma ORM patterns for TypeScript backends — schema design, query optimization, transactions, pagination, and critical traps like updateMany returning count not records, $transaction timeouts, migrate dev resetting the DB, Prisma-managed timestamp behavior, and serverless connection exhaustion. Use when writing a Prisma schema or query, or debugging transactions, migrations, or serverless connection limits.
metadata:
  origin: ECC
---

# Prisma Patterns

Production patterns and non-obvious traps for Prisma ORM in TypeScript backends. These examples use the Prisma ORM 5–7 schema and Client APIs; consult the migration guide before applying them to Prisma ORM 8.

> **Check your version before applying patterns.** The Prisma API surface has evolved across major releases:
>
> ```bash
> npx prisma --version
> ```
>
> Notable API differences across versions:
> - `relationJoins` enables database-level relation loading with JSON aggregation on supported providers; benchmark `join` and `query` for your workload
> - `omit` field modifier and `prisma.$extends` Client Extensions API were added
> - **Newer installs**: the `prisma` package supplies the CLI; import the Client from `@prisma/client` or your configured generated output path. `PrismaClient` may require a driver adapter (e.g. `@prisma/adapter-pg`); `datasource.url` may live in `prisma.config.ts` instead of `schema.prisma`
> - Prisma ORM 5–7 use `migrate dev`, `migrate deploy`, and `generate`; flags and configuration differ across versions, so check the installed command's `--help`

## When to Activate

- Designing or modifying Prisma schema models and relations
- Writing queries, transactions, or pagination logic
- Using `updateMany`, `deleteMany`, or any bulk operation
- Running or planning database migrations
- Deploying to serverless environments (Vercel, Lambda, Cloudflare Workers)
- Implementing soft delete or multi-tenant row filtering

## Core Concepts

### ID Strategy

| Strategy | Use When | Avoid When |
|---|---|---|
| `@default(cuid())` | Default choice — URL-safe, sortable, no collisions | Sequential IDs needed for external systems |
| `@default(uuid())` | Interoperability with non-Prisma systems required | High-write tables (random UUIDs fragment B-tree indexes) |
| `@default(autoincrement())` | Internal join tables, audit logs | Public-facing IDs (exposes record count) |

### Schema Defaults

```prisma
model User {
  id        String    @id @default(cuid())
  email     String    @unique  // @unique already creates an index — no @@index needed
  name      String
  role      Role      @default(USER)
  posts     Post[]
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([createdAt])
  @@index([deletedAt, createdAt]) // composite for soft-delete + sort queries
}
```

- Add `@@index` on every foreign key and column used in `WHERE` or `ORDER BY`.
- Declare `deletedAt DateTime?` upfront when soft delete is a foreseeable requirement — adding it later requires a migration on a live table.
- `updatedAt @updatedAt` is managed by Prisma Client, including nonempty `updateMany` writes. Raw SQL and other database writers bypass this Client behavior (see Anti-Patterns).

### `include` vs `select`

| | `include` | `select` |
|---|---|---|
| Returns | All scalar fields + specified relations | Only specified fields |
| Use when | You need most fields plus a relation | Hot paths, large tables, avoiding over-fetch |
| Performance | May over-fetch on wide tables | Minimal payload, faster on large datasets |
| Relation loading | `join` by default only when `relationJoins` is enabled on a supported provider; otherwise `query` | Same for selected relations |

```ts
// include — all columns + relation
const user = await prisma.user.findUnique({
  where: { id },
  include: { posts: { select: { id: true, title: true } } },
});

// select — explicit allowlist
const user = await prisma.user.findUnique({
  where: { id },
  select: { id: true, email: true, name: true },
});
```

Never return raw Prisma entities from API responses — map to response DTOs to control exposed fields:

```ts
// BAD: leaks passwordHash, deletedAt, internal fields
return await prisma.user.findUniqueOrThrow({ where: { id } });

// GOOD: explicit DTO mapping
const user = await prisma.user.findUniqueOrThrow({ where: { id } });
return { id: user.id, name: user.name, email: user.email };
```

### Transaction Form Selection

| Situation | Use |
|---|---|
| Independent operations, no inter-dependency | Array form |
| Later step depends on earlier result | Interactive form |
| External calls (email, HTTP) involved | Outside transaction entirely |

```ts
// Array form — batched in one round trip
const [user, post] = await prisma.$transaction([
  prisma.user.update({ where: { id }, data: { name } }),
  prisma.post.create({ data: { title, authorId: id } }),
]);

// Interactive form — use tx client only, never the outer prisma client
const post = await prisma.$transaction(async (tx) => {
  const user = await tx.user.findUniqueOrThrow({ where: { id } });
  if (user.role !== 'ADMIN') throw new Error('Forbidden');
  return tx.post.create({ data: { title, authorId: user.id } });
});
```

### PrismaClient Singleton

Each `PrismaClient` instance opens its own connection pool. Instantiate once.

```ts
// lib/prisma.ts

// Option A — adapter-based initialization (required by newer Prisma installs)
import { PrismaClient } from '@prisma/client'; // or the generated client path for your setup
import { PrismaPg } from '@prisma/adapter-pg';

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Option B — direct initialization (older installs, no adapter needed)
// import { PrismaClient } from '@prisma/client';
// export const prisma = globalForPrisma.prisma ?? new PrismaClient({ ... });
```

Use Option A if your Prisma install requires an `adapter` argument in the `PrismaClient` constructor.
Use Option B if `new PrismaClient()` works without arguments. Let the compiler tell you which is correct.

The `globalThis` pattern prevents duplicate instances during hot reload (Next.js, nodemon, ts-node-dev).

### N+1 Problem

Loading relations inside a loop issues one query per row.

```ts
// BAD: N+1 — one extra query per user
const users = await prisma.user.findMany();
for (const user of users) {
  const posts = await prisma.post.findMany({ where: { authorId: user.id } });
}

// GOOD: eager load relations without a query for every user
const users = await prisma.user.findMany({ include: { posts: true } });
```

On supported providers, enable `relationJoins` and regenerate the Client to use `relationLoadStrategy: 'join'` (the default with the flag). Without that flag, `include` uses the `query` strategy: one query per table, merged in the application. Neither strategy requires a query for every user. Benchmark both with your actual relations and workload.

## Code Examples

### Cursor Pagination (preferred for feeds and large datasets)

```ts
async function getPosts(cursor?: string, limit = 20) {
  const items = await prisma.post.findMany({
    where: { published: true },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' }, // secondary sort prevents unstable pagination on duplicate timestamps
    ],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });

  const hasNextPage = items.length > limit;
  if (hasNextPage) items.pop();

  return { items, nextCursor: hasNextPage ? items[items.length - 1].id : null };
}
```

Fetch `limit + 1` and pop — canonical way to detect `hasNextPage` without an extra count query. Always include a unique field (e.g. `id`) as a secondary `orderBy` to prevent unstable pagination when multiple rows share the same timestamp. Use offset pagination only when users need to jump to arbitrary pages (admin tables).

### Soft Delete

```ts
// Always filter explicitly — do not rely on middleware (hides behavior, hard to debug)
const activeUsers = await prisma.user.findMany({ where: { deletedAt: null } });

await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
await prisma.user.update({ where: { id }, data: { deletedAt: null } }); // restore
```

### Error Handling

```ts
import { Prisma } from '@prisma/client'; // or the generated client path for your setup

try {
  await prisma.user.create({ data: { email } });
} catch (e) {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') throw new ConflictError('Email already exists');
    if (e.code === 'P2025') throw new NotFoundError('Record not found');
    if (e.code === 'P2003') throw new BadRequestError('Referenced record does not exist');
  }
  throw e;
}
```

Common codes: `P2002` unique violation · `P2025` not found · `P2003` foreign key violation.

Catch at the service boundary and translate to domain errors. Never expose raw Prisma messages to API consumers.

### Connection Pool — Serverless

For Prisma ORM 6 and earlier using the built-in engine pool, embed pool parameters directly in `DATABASE_URL`. Prisma ORM 7 driver adapters use the underlying driver's pool options instead; URL parameters such as `connection_limit` do not configure `PrismaPg`'s pool.

```bash
# .env — Prisma ORM 6 and earlier with the built-in engine pool
DATABASE_URL="postgresql://user:pass@host/db?connection_limit=1&pool_timeout=20"

# With an external pooler (PgBouncer, Supabase pooler)
DATABASE_URL="postgresql://user:pass@host/db?pgbouncer=true&connection_limit=1"
```

```ts
// Vercel, AWS Lambda, and similar serverless runtimes:
// Size the pool per instance, then account for total instance concurrency.

// Adapter-based setup (Prisma ORM 7 / node-postgres pool):
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: 1, // node-postgres pool limit per instance
    connectionTimeoutMillis: 20_000, // milliseconds; tune for the workload
  }),
});

// Built-in engine setup (Prisma ORM 6 and earlier; use URL pool parameters):
// const prisma = new PrismaClient();
```

## Anti-Patterns

### `updateMany` returns a count, not records

```ts
// BAD: result is { count: 2 } — users[0] is undefined
const users = await prisma.user.updateMany({ where: { role: 'GUEST' }, data: { role: 'USER' } });

// GOOD: capture IDs first, then update, then fetch only the affected rows
const targets = await prisma.user.findMany({
  where: { role: 'GUEST' },
  select: { id: true },
});
const ids = targets.map((u) => u.id);
await prisma.user.updateMany({ where: { id: { in: ids } }, data: { role: 'USER' } });
const updated = await prisma.user.findMany({ where: { id: { in: ids } } });
```

Same applies to `deleteMany` — returns `{ count: n }`, never the deleted rows.

### `$transaction` interactive form times out after 5 seconds

```ts
// BAD: external call inside transaction exceeds 5s default → "Transaction already closed"
await prisma.$transaction(async (tx) => {
  const user = await tx.user.findUniqueOrThrow({ where: { id } });
  await sendWelcomeEmail(user.email); // external call
  await tx.user.update({ where: { id }, data: { emailSent: true } });
});

// GOOD: external calls outside the transaction
const user = await prisma.user.findUniqueOrThrow({ where: { id } });
await sendWelcomeEmail(user.email);
await prisma.user.update({ where: { id }, data: { emailSent: true } });

// Only raise timeout when bulk processing genuinely needs it
await prisma.$transaction(async (tx) => { ... }, { timeout: 30_000 });
```

### `migrate dev` can reset the database

`migrate dev` detects schema drift and may prompt to reset the DB, dropping all data.

```bash
# NEVER on shared dev, staging, or production
npx prisma migrate dev --name add_column

# Safe everywhere except local solo dev
npx prisma migrate deploy

# Prisma ORM 6: inspect differences without applying them (requires a shadow DB)
# Prisma ORM 7 uses different flags/configuration; check `prisma migrate diff --help`.
npx prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL"
```

### Editing an applied migration creates a history conflict

Prisma tracks checksums of applied migrations. Editing an applied file creates a migration history conflict: `migrate dev` can request a reset, while `migrate deploy` warns about modified applied migrations. `P3006` specifically means a migration failed to apply cleanly to the shadow database, not a checksum mismatch. Restore the applied file and create a new migration for the intended change.

### Breaking schema changes require multi-step migration

Adding `NOT NULL` to an existing column or renaming a column in one migration will lock the table or drop data. Use expand-and-contract:

```bash
# Step 1: create migration locally, then deploy
npx prisma migrate dev --name add_new_column   # local only
npx prisma migrate deploy                       # staging / production
```

```ts
// Step 2: backfill data (run in a script or migration job, not in the shell)
await prisma.user.updateMany({ data: { newColumn: derivedValue } });
```

```bash
# Step 3: create the NOT NULL constraint migration locally, then deploy
npx prisma migrate dev --name make_new_column_required  # local only
npx prisma migrate deploy                               # staging / production
```

### `@updatedAt` is managed by Prisma Client, not a database trigger

Prisma updates `@updatedAt` automatically for nonempty Client writes, including `updateMany`. An empty update leaves the timestamp unchanged, and an explicitly supplied timestamp takes precedence. Raw SQL and external writers must maintain the column themselves, or use a database trigger.

```ts
// Prisma automatically updates the schema's @updatedAt field
await prisma.post.updateMany({ where: { authorId }, data: { published: true } });

// Explicit timestamp override when the application requires a chosen time
await prisma.post.updateMany({
  where: { authorId },
  data: { published: true, updatedAt: new Date() },
});
```

### Soft delete + `findUniqueOrThrow` leaks deleted records

`findUniqueOrThrow` throws `P2025` when no record matches its filter. A lookup by `id` alone still returns a soft-deleted row; include the soft-delete condition to exclude it.

In Prisma ORM 5+, `WhereUniqueInput` accepts additional non-unique filters as long as at least one unique field appears outside boolean operators. `{ id, deletedAt: null }` is valid and excludes soft-deleted rows without a compound unique constraint. This was available under `extendedWhereUnique` in 4.5–4.16; on older Clients without that feature, use `findFirstOrThrow`.

```ts
// BAD: returns soft-deleted user
const user = await prisma.user.findUniqueOrThrow({ where: { id } });

// GOOD: Prisma ORM 5+ — unique id plus a soft-delete filter
const user = await prisma.user.findUniqueOrThrow({ where: { id, deletedAt: null } });

// Also valid: arbitrary filters, including older Clients without extendedWhereUnique
const user = await prisma.user.findFirstOrThrow({ where: { id, deletedAt: null } });
```

### `deleteMany` without `where` deletes every row

```ts
// BAD: silently wipes the table
await prisma.post.deleteMany();

// GOOD
await prisma.post.deleteMany({ where: { authorId: userId } });
```

## Best Practices

| Rule | Reason |
|---|---|
| `migrate deploy` in CI/CD, `migrate dev` only locally | `migrate dev` can reset the DB on drift |
| Map entities to response DTOs | Prevents leaking internal fields |
| Catch `PrismaClientKnownRequestError` at service boundary | Translate to domain errors |
| Prefer `*OrThrow` methods over manual null checks | Throws P2025 automatically; use `findFirstOrThrow` when there is no unique lookup key |
| Bound each serverless pool and account for instance concurrency | Use URL pool parameters for the built-in engine or driver options such as `PrismaPg.max` for adapters |
| Always provide `where` on `deleteMany` | Prevents accidental table wipe |
| Let Prisma manage `@updatedAt`; maintain it for raw SQL/external writers | Nonempty Client `updateMany` writes update it automatically; the database does not |

## Related Skills

- `nestjs-patterns` — NestJS service layer that integrates Prisma
- `postgres-patterns` — PostgreSQL-level indexing and connection tuning
- `database-migrations` — multi-step migration planning for production
- `backend-patterns` — general API and service layer design
