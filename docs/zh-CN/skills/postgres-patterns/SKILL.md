---
name: postgres-patterns
description: 用于查询优化、模式设计、索引和安全性的PostgreSQL数据库模式。基于Supabase最佳实践。
origin: ECC
---

# PostgreSQL 模式

PostgreSQL 最佳实践快速参考。如需详细指导，请使用 `database-reviewer` 智能体。

## 何时激活

* 编写 SQL 查询或迁移时
* 设计数据库模式时
* 排查慢查询时
* 实施行级安全性时
* 设置连接池时

## 快速参考

### 索引速查表

| 查询模式 | 索引类型 | 示例 |
|--------------|------------|---------|
| `WHERE col = value` | B-tree（默认） | `CREATE INDEX idx ON t (col)` |
| `WHERE col > value` | B-tree | `CREATE INDEX idx ON t (col)` |
| `WHERE a = x AND b > y` | 复合索引 | `CREATE INDEX idx ON t (a, b)` |
| `WHERE jsonb @> '{}'` | GIN | `CREATE INDEX idx ON t USING gin (col)` |
| `WHERE tsv @@ query` | GIN | `CREATE INDEX idx ON t USING gin (col)` |
| 时间序列范围查询 | BRIN | `CREATE INDEX idx ON t USING brin (col)` |

### 数据类型快速参考

| 使用场景 | 正确类型 | 避免使用 |
|----------|-------------|-------|
| ID | `bigint` | `int`，随机 UUID |
| 字符串 | `text` | `varchar(255)` |
| 时间戳 | `timestamptz` | `timestamp` |
| 货币 | `numeric(10,2)` | `float` |
| 标志位 | `boolean` | `varchar`，`int` |

### 常见模式

**复合索引顺序：**

```sql
-- Equality columns first, then range columns
CREATE INDEX idx ON orders (status, created_at);
-- Works for: WHERE status = 'pending' AND created_at > '2024-01-01'
```

**覆盖索引：**

```sql
CREATE INDEX idx ON users (email) INCLUDE (name, created_at);
-- Avoids table lookup for SELECT email, name, created_at
```

**部分索引：**

```sql
CREATE INDEX idx ON users (email) WHERE deleted_at IS NULL;
-- Smaller index, only includes active users
```

**RLS 策略（优化版）：**

```sql
CREATE POLICY policy ON orders
  USING ((SELECT auth.uid()) = user_id);  -- Wrap in SELECT!
```

**UPSERT：**

```sql
INSERT INTO settings (user_id, key, value)
VALUES (123, 'theme', 'dark')
ON CONFLICT (user_id, key)
DO UPDATE SET value = EXCLUDED.value;
```

**游标分页：**

```sql
SELECT * FROM products WHERE id > $last_id ORDER BY id LIMIT 20;
-- O(1) vs OFFSET which is O(n)
```

**队列处理：**

```sql
UPDATE jobs SET status = 'processing'
WHERE id = (
  SELECT id FROM jobs WHERE status = 'pending'
  ORDER BY created_at LIMIT 1
  FOR UPDATE SKIP LOCKED
) RETURNING *;
```

### 反模式检测\*\*

```sql
-- Find unindexed foreign keys
-- 检查缺少以完整外键列为前导键的有效非部分 B-tree 索引的候选
SELECT c.conrelid::regclass AS table_name, c.conname AS constraint_name
FROM pg_constraint c
WHERE c.contype = 'f'
  AND NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_am am ON am.oid = idx.relam
    WHERE i.indrelid = c.conrelid
      AND i.indisvalid AND i.indisready AND i.indislive
      AND i.indpred IS NULL
      AND am.amname = 'btree'
      AND i.indnkeyatts >= cardinality(c.conkey)
      AND ARRAY(
        SELECT key.attnum
        FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS key(attnum, position)
        WHERE key.position <= cardinality(c.conkey)
        ORDER BY key.attnum
      ) = ARRAY(SELECT attnum FROM unnest(c.conkey) AS fk(attnum) ORDER BY attnum)
  );

-- Find slow queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC;

-- Check table bloat
SELECT relname, n_dead_tup, last_vacuum
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

### 配置模板

```sql
-- Connection limits (adjust for RAM)
ALTER SYSTEM SET max_connections = 100;
ALTER SYSTEM SET work_mem = '8MB';

-- Timeouts
ALTER SYSTEM SET idle_in_transaction_session_timeout = '30s';
ALTER SYSTEM SET statement_timeout = '30s';

-- Security defaults
REVOKE ALL ON SCHEMA public FROM public;

SELECT pg_reload_conf();
```

以下 `compute_query_id` 设置仅适用于 PostgreSQL 14 及以后版本；PostgreSQL 13 及更早版本应省略此设置。

`pg_reload_conf()` 只重新加载支持 reload 的设置；修改 `max_connections` 必须重启服务器。使用 `pg_stat_statements` 前，将它加入 `shared_preload_libraries` 并保留已有条目，内置查询标识使用 `compute_query_id = auto` 或 `on`；如果由外部模块计算查询标识，则设为 `off`。如果修改了预加载列表，重启服务器，然后连接到每个需要统计视图的数据库并执行：

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

## 相关

* 智能体：`database-reviewer` - 完整的数据库审查工作流
* 技能：`clickhouse-io` - ClickHouse 分析模式
* 技能：`backend-patterns` - API 和后端模式

***

*基于 Supabase 代理技能（致谢：Supabase 团队）（MIT 许可证）*
