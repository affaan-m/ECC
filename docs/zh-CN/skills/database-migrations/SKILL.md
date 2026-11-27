---
name: database-migrations
description: 数据库迁移最佳实践，涵盖模式变更、数据迁移、回滚以及零停机部署，适用于PostgreSQL、MySQL及常用ORM（Prisma、Drizzle、Django、TypeORM、golang-migrate）。
origin: ECC
---

# 数据库迁移模式

为生产系统提供安全、可逆的数据库模式变更。

## 何时激活

* 创建或修改数据库表
* 添加/删除列或索引
* 运行数据迁移（回填、转换）
* 计划零停机模式变更
* 为新项目设置迁移工具

## 核心原则

1. **每个变更都是一次迁移** — 切勿手动更改生产数据库
2. **迁移在生产环境中是只进不退的** — 回滚使用新的前向迁移
3. **模式迁移和数据迁移是分开的** — 切勿在一个迁移中混合 DDL 和 DML
4. **针对生产规模的数据测试迁移** — 适用于 100 行的迁移可能在 1000 万行时锁定
5. **迁移一旦部署就是不可变的** — 切勿编辑已在生产中运行的迁移

## 迁移安全检查清单

应用任何迁移之前：

* \[ ] 迁移同时包含 UP 和 DOWN（或明确标记为不可逆）
* \[ ] 对大表没有全表锁（使用并发操作）
* \[ ] 新列有默认值或可为空（切勿添加没有默认值的 NOT NULL）
* \[ ] 索引是并发创建的（对于现有表，不与 CREATE TABLE 内联创建）
* \[ ] 数据回填是与模式变更分开的迁移
* \[ ] 已针对生产数据副本进行测试
* \[ ] 回滚计划已记录

## PostgreSQL 模式

### 安全地添加列

```sql
-- GOOD: Nullable column, no lock
ALTER TABLE users ADD COLUMN avatar_url TEXT;

-- GOOD: Column with default (Postgres 11+ is instant, no rewrite)
ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- BAD: NOT NULL without default on existing table (requires full rewrite)
ALTER TABLE users ADD COLUMN role TEXT NOT NULL;
-- This locks the table and rewrites every row
```

### 无停机添加索引

```sql
-- BAD: Blocks writes on large tables
CREATE INDEX idx_users_email ON users (email);

-- GOOD: Non-blocking, allows concurrent writes
CREATE INDEX CONCURRENTLY idx_users_email ON users (email);

-- Note: CONCURRENTLY cannot run inside a transaction block
-- Most migration tools need special handling for this
```

### 重命名列（零停机）

切勿在生产中直接重命名。使用扩展-收缩模式：

```sql
-- Step 1: Add new column (migration 001)
ALTER TABLE users ADD COLUMN display_name TEXT;

-- Step 2: Backfill data (migration 002, data migration)
UPDATE users SET display_name = username WHERE display_name IS NULL;

-- Step 3: Update application code to read/write both columns
-- Deploy application changes

-- Step 4: Stop writing to old column, drop it (migration 003)
ALTER TABLE users DROP COLUMN username;
```

### 安全地删除列

```sql
-- Step 1: Remove all application references to the column
-- Step 2: Deploy application without the column reference
-- Step 3: Drop column in next migration
ALTER TABLE orders DROP COLUMN legacy_status;

-- For Django: use SeparateDatabaseAndState to remove from model
-- without generating DROP COLUMN (then drop in next migration)
```

### 大型数据迁移

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

### 工作流

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

### 模式示例

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

### 自定义 SQL 迁移

对于 Prisma 无法表达的操作（并发索引、数据回填）：

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

### 工作流

```bash
# Generate migration from schema changes
npx drizzle-kit generate

# Apply migrations
npx drizzle-kit migrate

# Push schema directly (dev only, no migration file)
npx drizzle-kit push
```

### 模式示例

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

### 工作流

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

### 数据迁移

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

从 Django 模型中删除列，而不立即从数据库中删除：

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

### 工作流

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

### 迁移文件

```sql
-- migrations/000003_add_user_avatar.up.sql
ALTER TABLE users ADD COLUMN avatar_url TEXT;
CREATE INDEX CONCURRENTLY idx_users_avatar ON users (avatar_url) WHERE avatar_url IS NOT NULL;

-- migrations/000003_add_user_avatar.down.sql
DROP INDEX IF EXISTS idx_users_avatar;
ALTER TABLE users DROP COLUMN IF EXISTS avatar_url;
```

## 零停机迁移策略

对于关键的生产变更，遵循扩展-收缩模式：

```
Phase 1: EXPAND
  - 添加新列/表（可为空或带有默认值）
  - 部署：应用同时写入旧数据和新数据
  - 回填现有数据

Phase 2: MIGRATE
  - 部署：应用读取新数据，同时写入新旧数据
  - 验证数据一致性

Phase 3: CONTRACT
  - 部署：应用仅使用新数据
  - 在单独迁移中删除旧列/表
```

### 时间线示例

```
Day 1：迁移添加新的 `new_status` 列（可空）
Day 1：部署应用 v2 —— 同时写入 `status` 和 `new_status`
Day 2：运行针对现有行的回填迁移
Day 3：部署应用 v3 —— 仅从 `new_status` 读取
Day 7：迁移删除旧的 `status` 列
```

## 反模式

| 反模式 | 为何会失败 | 更好的方法 |
|-------------|-------------|-----------------|
| 在生产中手动执行 SQL | 没有审计追踪，不可重复 | 始终使用迁移文件 |
| 编辑已部署的迁移 | 导致环境间出现差异 | 改为创建新迁移 |
| 没有默认值的 NOT NULL | 锁定表，重写所有行 | 添加可为空列，回填数据，然后添加约束 |
| 在大表上内联创建索引 | 在构建期间阻塞写入 | 使用 CREATE INDEX CONCURRENTLY |
| 在一个迁移中混合模式和数据的变更 | 难以回滚，事务时间长 | 分开的迁移 |
| 在移除代码之前删除列 | 应用程序在缺失列时出错 | 先移除代码，下一次部署再删除列 |
