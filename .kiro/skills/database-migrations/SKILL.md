---
name: database-migrations
description: >
  Database migration best practices for schema changes, data migrations, rollbacks,
  and zero-downtime deployments across PostgreSQL, MySQL, and common ORMs (Prisma,
  Drizzle, Django, TypeORM, golang-migrate). Use when planning or implementing
  database schema changes.
metadata:
  origin: ECC
---

# Database Migration Patterns

Safe, reversible database schema changes for production systems.

## When to Activate

- Creating or altering database tables
- Adding/removing columns or indexes
- Running data migrations (backfill, transform)
- Planning zero-downtime schema changes
- Setting up migration tooling for a new project

## Core Principles

1. **Every change is a migration** — never alter production databases manually
2. **Migrations are forward-only in production** — rollbacks use new forward migrations
3. **Schema and data migrations are separate** — never mix DDL and DML in one migration
4. **Test migrations against production-sized data** — a migration that works on 100 rows may lock on 10M
5. **Migrations are immutable once deployed** — never edit a migration that has run in production

## Migration Safety Checklist

Before applying any migration:

- [ ] Migration has both UP and DOWN (or is explicitly marked irreversible)
- [ ] No full table locks on large tables (use concurrent operations)
- [ ] New columns have defaults or are nullable (never add NOT NULL without default)
- [ ] Indexes created concurrently (not inline with CREATE TABLE for existing tables)
- [ ] Data backfill is a separate migration from schema change
- [ ] Tested against a copy of production data
- [ ] Rollback plan documented

## PostgreSQL Patterns

### Adding a Column Safely

```sql
-- GOOD: Nullable column, no lock
ALTER TABLE users ADD COLUMN avatar_url TEXT;

-- GOOD: Column with default (Postgres 11+ is instant, no rewrite)
ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- BAD: NOT NULL without default on existing table (requires full rewrite)
ALTER TABLE users ADD COLUMN role TEXT NOT NULL;
-- This locks the table and rewrites every row
```

### Adding an Index Without Downtime

```sql
-- BAD: Blocks writes on large tables
CREATE INDEX idx_users_email ON users (email);

-- GOOD: Non-blocking, allows concurrent writes
CREATE INDEX CONCURRENTLY idx_users_email ON users (email);

-- Note: CONCURRENTLY cannot run inside a transaction block
-- Most migration tools need special handling for this
```

### Renaming a Column (Zero-Downtime)

For a pure rename (both columns represent the same value), use expand-contract.
Keep `username` authoritative until the read cutover:

```sql
-- Step 1: Expand (migration 001)
ALTER TABLE users ADD COLUMN display_name TEXT;

-- Step 2: Deploy app v2: read username, write BOTH columns atomically.
-- Cover every INSERT/UPDATE path, including jobs, imports, and admin tools.
-- Drain old-only writers and their in-flight transactions before backfilling.

-- Step 3: Backfill in bounded primary-key ranges (separate data migration).
-- Example range; advance bounds to cover every existing id.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '2s';
UPDATE users SET display_name = username
WHERE id > 0 AND id <= 10000
  AND display_name IS DISTINCT FROM username;
COMMIT;

-- Step 4: Validate AFTER all ranges complete, while dual writes continue.
-- Require zero mismatches before switching reads.
SELECT count(*) AS mismatched_rows FROM users
WHERE display_name IS DISTINCT FROM username;

-- Step 5: Deploy app v3: read display_name, still write BOTH columns.
-- Keep dual writes throughout the rollback window.

-- Step 6: After the rollback window, stop backfill/reconciliation workers.
-- Transfer required constraints/indexes/dependencies to the new column.
-- Make old-column constraints compatible with new-only INSERTs/UPDATEs.
-- Deploy app v4 using ONLY display_name; drain all old-column users.

-- Step 7: Contract in a separate migration after checking dependencies.
ALTER TABLE users DROP COLUMN username;
```

Commit each range independently; checkpoint only after commit and retry failed
batch transactions. Choose bounds for the actual key space (including zero or
negative IDs if present). `IS DISTINCT FROM` repairs stale non-NULL values and
handles NULL pairs without repeatedly updating them. Do not fetch `username`
into application memory and later write that stale snapshot: copy the target
row's current value in the same `UPDATE`. At Read Committed, concurrent updates
serialize on the row and PostgreSQL rechecks the predicate after waiting.

Deploying dual writes does not repair earlier drift by itself. Finish draining
old-only writers before backfill, and validate parity before read cutover. Once
new-only writes start, the old column may be stale: do not restart this backfill
or roll back to old readers without a reconciliation plan. The timeline below
represents deployment gates, not guaranteed elapsed time or lock-free DDL.

The [self-checking SQL example](examples/postgres-column-rename.sql) reproduces
the stale-value failure and verifies reconciliation, retries, and NULL handling:

```bash
psql -X -v ON_ERROR_STOP=1 -f skills/database-migrations/examples/postgres-column-rename.sql
```

Reference: [PostgreSQL Read Committed behavior](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED).

### Removing a Column Safely

```sql
-- Step 1: Remove all application references to the column
-- Step 2: Deploy application without the column reference
-- Step 3: Drop column in next migration
ALTER TABLE orders DROP COLUMN legacy_status;

-- For Django: use SeparateDatabaseAndState to remove from model
-- without generating DROP COLUMN (then drop in next migration)
```

### Large Data Migrations

```sql
-- BAD: Updates all rows in one transaction (locks table)
UPDATE users SET normalized_email = LOWER(email);

-- GOOD: Batch update with progress
DO $$
DECLARE
  batch_size INT := 10000;
  rows_updated INT;
BEGIN
  LOOP
    UPDATE users
    SET normalized_email = LOWER(email)
    WHERE id IN (
      SELECT id FROM users
      WHERE normalized_email IS NULL
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED
    );
    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RAISE NOTICE 'Updated % rows', rows_updated;
    EXIT WHEN rows_updated = 0;
    COMMIT;
  END LOOP;
END $$;
```

## Prisma (TypeScript/Node.js)

### Workflow

```bash
# Create migration from schema changes
npx prisma migrate dev --name add_user_avatar

# Apply pending migrations in production
npx prisma migrate deploy

# Reset database (dev only)
npx prisma migrate reset

# Generate client after schema changes
npx prisma generate
```

### Schema Example

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  avatarUrl String?  @map("avatar_url")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  orders    Order[]

  @@map("users")
  @@index([email])
}
```

### Custom SQL Migration

For operations Prisma cannot express (concurrent indexes, data backfills):

```bash
# Create empty migration, then edit the SQL manually
npx prisma migrate dev --create-only --name add_email_index
```

```sql
-- migrations/20240115_add_email_index/migration.sql
-- Prisma cannot generate CONCURRENTLY, so we write it manually
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
```

## Drizzle (TypeScript/Node.js)

### Workflow

```bash
# Generate migration from schema changes
npx drizzle-kit generate

# Apply migrations
npx drizzle-kit migrate

# Push schema directly (dev only, no migration file)
npx drizzle-kit push
```

### Schema Example

```typescript
import { pgTable, text, timestamp, uuid, boolean } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

## Django (Python)

### Workflow

```bash
# Generate migration from model changes
python manage.py makemigrations

# Apply migrations
python manage.py migrate

# Show migration status
python manage.py showmigrations

# Generate empty migration for custom SQL
python manage.py makemigrations --empty app_name -n description
```

### Data Migration

```python
from django.db import migrations

def backfill_display_names(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    batch_size = 5000
    users = User.objects.filter(display_name="")
    while users.exists():
        batch = list(users[:batch_size])
        for user in batch:
            user.display_name = user.username
        User.objects.bulk_update(batch, ["display_name"], batch_size=batch_size)

def reverse_backfill(apps, schema_editor):
    pass  # Data migration, no reverse needed

class Migration(migrations.Migration):
    dependencies = [("accounts", "0015_add_display_name")]

    operations = [
        migrations.RunPython(backfill_display_names, reverse_backfill),
    ]
```

### SeparateDatabaseAndState

Remove a column from the Django model without dropping it from the database immediately:

```python
class Migration(migrations.Migration):
    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveField(model_name="user", name="legacy_field"),
            ],
            database_operations=[],  # Don't touch the DB yet
        ),
    ]
```

## golang-migrate (Go)

### Workflow

```bash
# Create migration pair
migrate create -ext sql -dir migrations -seq add_user_avatar

# Apply all pending migrations
migrate -path migrations -database "$DATABASE_URL" up

# Rollback last migration
migrate -path migrations -database "$DATABASE_URL" down 1

# Force version (fix dirty state)
migrate -path migrations -database "$DATABASE_URL" force VERSION
```

### Migration Files

```sql
-- migrations/000003_add_user_avatar.up.sql
ALTER TABLE users ADD COLUMN avatar_url TEXT;
CREATE INDEX CONCURRENTLY idx_users_avatar ON users (avatar_url) WHERE avatar_url IS NOT NULL;

-- migrations/000003_add_user_avatar.down.sql
DROP INDEX IF EXISTS idx_users_avatar;
ALTER TABLE users DROP COLUMN IF EXISTS avatar_url;
```

## Zero-Downtime Migration Strategy

For critical production changes, follow the expand-contract pattern:

```
Phase 1: EXPAND
  - Add new column/table (nullable or with default)
  - Deploy: app reads OLD, writes BOTH atomically
  - Drain old-only writers and in-flight transactions
  - Backfill in committed batches, then verify parity

Phase 2: MIGRATE
  - Deploy: app reads from NEW, writes to BOTH
  - Monitor parity and retain dual writes throughout the rollback window

Phase 3: CONTRACT
  - End rollback window; stop backfill and migrate constraints/dependencies
  - Deploy: app only uses NEW; drain all old-column users
  - Drop old column/table in separate migration
```

### Timeline Example

```
Day 1: Migration adds new_status column (nullable)
Day 1: Deploy app v2 — reads status, writes both columns atomically
Day 2: Drain old-only writers; backfill in batches; require zero mismatches
Day 3: Deploy app v3 — reads new_status, still writes both columns
Day 7: End rollback window; stop backfill; migrate constraints/dependencies
Day 7: Deploy app v4 — only uses new_status; drain old-column users
Later: Separate migration drops status after all contract gates pass
```

## Anti-Patterns

| Anti-Pattern | Why It Fails | Better Approach |
|-------------|-------------|-----------------|
| Manual SQL in production | No audit trail, unrepeatable | Always use migration files |
| Editing deployed migrations | Causes drift between environments | Create new migration instead |
| NOT NULL without default | Locks table, rewrites all rows | Add nullable, backfill, then add constraint |
| Inline index on large table | Blocks writes during build | CREATE INDEX CONCURRENTLY |
| Schema + data in one migration | Hard to rollback, long transactions | Separate migrations |
| Dropping column before removing code | Application errors on missing column | Remove code first, drop column next deploy |

## When to Use This Skill

- Planning database schema changes
- Implementing zero-downtime migrations
- Setting up migration tooling
- Troubleshooting migration issues
- Reviewing migration pull requests
