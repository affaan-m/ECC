---
name: postgres-patterns
description: PostgreSQL database patterns for query optimization, schema design, indexing, and security. Based on Supabase best practices.
---

# PostgreSQL 模式

PostgreSQL 最佳實務快速參考。詳細指南請使用 `database-reviewer` agent。

## 何時啟用

- 撰寫 SQL 查詢或 migrations
- 設計資料庫 schema
- 疑難排解慢查詢
- 實作 Row Level Security
- 設定連線池

## 快速參考

### 索引速查表

| 查詢模式 | 索引類型 | 範例 |
|---------|---------|------|
| `WHERE col = value` | B-tree（預設） | `CREATE INDEX idx ON t (col)` |
| `WHERE col > value` | B-tree | `CREATE INDEX idx ON t (col)` |
| `WHERE a = x AND b > y` | 複合 | `CREATE INDEX idx ON t (a, b)` |
| `WHERE jsonb @> '{}'` | GIN | `CREATE INDEX idx ON t USING gin (col)` |
| `WHERE tsv @@ query` | GIN | `CREATE INDEX idx ON t USING gin (col)` |
| 時間序列範圍 | BRIN | `CREATE INDEX idx ON t USING brin (col)` |

### 資料類型快速參考

| 使用情況 | 正確類型 | 避免 |
|---------|---------|------|
| IDs | `bigint` | `int`、隨機 UUID |
| 字串 | `text` | `varchar(255)` |
| 時間戳 | `timestamptz` | `timestamp` |
| 金額 | `numeric(10,2)` | `float` |
| 旗標 | `boolean` | `varchar`、`int` |

### 常見模式

**複合索引順序：**
```sql
-- 等值欄位優先，然後是範圍欄位
CREATE INDEX idx ON orders (status, created_at);
-- 適用於：WHERE status = 'pending' AND created_at > '2024-01-01'
```

**覆蓋索引：**
```sql
CREATE INDEX idx ON users (email) INCLUDE (name, created_at);
-- 避免 SELECT email, name, created_at 時的表格查詢
```

**部分索引：**
```sql
CREATE INDEX idx ON users (email) WHERE deleted_at IS NULL;
-- 更小的索引，只包含活躍使用者
```

**RLS 政策（優化）：**
```sql
CREATE POLICY policy ON orders
  USING ((SELECT auth.uid()) = user_id);  -- 用 SELECT 包裝！
```

**UPSERT：**
```sql
INSERT INTO settings (user_id, key, value)
VALUES (123, 'theme', 'dark')
ON CONFLICT (user_id, key)
DO UPDATE SET value = EXCLUDED.value;
```

**游標分頁：**
```sql
SELECT * FROM products WHERE id > $last_id ORDER BY id LIMIT 20;
-- O(1) vs OFFSET 是 O(n)
```

**佇列處理：**
```sql
UPDATE jobs SET status = 'processing'
WHERE id = (
  SELECT id FROM jobs WHERE status = 'pending'
  ORDER BY created_at LIMIT 1
  FOR UPDATE SKIP LOCKED
) RETURNING *;
```

### 反模式偵測

```sql
-- 找出未建索引的外鍵
SELECT conrelid::regclass, a.attname
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
WHERE c.contype = 'f'
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.conrelid AND a.attnum = ANY(i.indkey)
  );

-- 找出慢查詢
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC;

-- 檢查表格膨脹
SELECT relname, n_dead_tup, last_vacuum
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

### 設定範本

```sql
-- 連線限制（依 RAM 調整）
ALTER SYSTEM SET max_connections = 100;
ALTER SYSTEM SET work_mem = '8MB';

-- 逾時
ALTER SYSTEM SET idle_in_transaction_session_timeout = '30s';
ALTER SYSTEM SET statement_timeout = '30s';

-- 安全預設值
REVOKE ALL ON SCHEMA public FROM public;

SELECT pg_reload_conf();
```

以下 `compute_query_id` 設定僅適用於 PostgreSQL 14 及以後版本；PostgreSQL 13 及更早版本應省略此設定。

`pg_reload_conf()` 只重新載入支援 reload 的設定；修改 `max_connections` 必須重新啟動伺服器。使用 `pg_stat_statements` 前，將它加入 `shared_preload_libraries` 並保留既有項目，內建查詢識別碼使用 `compute_query_id = auto` 或 `on`；若由外部模組計算查詢識別碼，則設為 `off`。若修改了預載入清單，重新啟動伺服器，然後連線到每個需要統計檢視的資料庫並執行：

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

## 相關

- Agent：`database-reviewer` - 完整資料庫審查工作流程
- Skill：`clickhouse-io` - ClickHouse 分析模式
- Skill：`backend-patterns` - API 和後端模式

---

*基於 [Supabase Agent Skills](Supabase Agent Skills (credit: Supabase team))（MIT 授權）*
