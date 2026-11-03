---
name: ecc-postgres
description: Review PostgreSQL queries, schema design, indexes, RLS, pooling, and staged schema/data migrations.
---

# PostgreSQL and migrations

Inspect the database version, migration tool, schema, query plans, and workload.
Use parameterized queries. Check tenant isolation and transaction/pool behavior,
including RLS execution roles, long transactions, and connection limits.

For query plans, indexes, schema choices, or RLS, read [PostgreSQL](references/postgres.md).
For schema changes or backfills, read [migrations](references/migrations.md).
Use only the section matching the installed migration tool; framework examples
do not imply introducing that framework. Check locking, rollback, and compatibility
with old/new app versions. Production changes require the task's actual authorization.
