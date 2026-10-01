---
name: postgres-patterns
description: PostgreSQL database patterns for query optimization, schema design, indexing, and security. Based on Supabase best practices.
---

# PostgreSQL パターン

PostgreSQLベストプラクティスのクイックリファレンス。詳細なガイダンスについては、`database-reviewer` エージェントを使用してください。

## 起動タイミング

- SQLクエリまたはマイグレーションの作成時
- データベーススキーマの設計時
- 低速クエリのトラブルシューティング時
- Row Level Securityの実装時
- コネクションプーリングの設定時

## クイックリファレンス

### インデックスチートシート

| クエリパターン | インデックスタイプ | 例 |
|--------------|------------|---------|
| `WHERE col = value` | B-tree（デフォルト） | `CREATE INDEX idx ON t (col)` |
| `WHERE col > value` | B-tree | `CREATE INDEX idx ON t (col)` |
| `WHERE a = x AND b > y` | 複合 | `CREATE INDEX idx ON t (a, b)` |
| `WHERE jsonb @> '{}'` | GIN | `CREATE INDEX idx ON t USING gin (col)` |
| `WHERE tsv @@ query` | GIN | `CREATE INDEX idx ON t USING gin (col)` |
| 時系列範囲 | BRIN | `CREATE INDEX idx ON t USING brin (col)` |

### データタイプクイックリファレンス

| 用途 | 正しいタイプ | 避けるべき |
|----------|-------------|-------|
| ID | `bigint` | `int`、ランダムUUID |
| 文字列 | `text` | `varchar(255)` |
| タイムスタンプ | `timestamptz` | `timestamp` |
| 金額 | `numeric(10,2)` | `float` |
| フラグ | `boolean` | `varchar`、`int` |

### 一般的なパターン

**複合インデックスの順序:**
```sql
-- 等価列を最初に、次に範囲列
CREATE INDEX idx ON orders (status, created_at);
-- 次の場合に機能: WHERE status = 'pending' AND created_at > '2024-01-01'
```

**カバリングインデックス:**
```sql
CREATE INDEX idx ON users (email) INCLUDE (name, created_at);
-- SELECT email, name, created_at のテーブル検索を回避
```

**部分インデックス:**
```sql
CREATE INDEX idx ON users (email) WHERE deleted_at IS NULL;
-- より小さなインデックス、アクティブユーザーのみを含む
```

**RLSポリシー（最適化）:**
```sql
CREATE POLICY policy ON orders
  USING ((SELECT auth.uid()) = user_id);  -- SELECTでラップ！
```

**UPSERT:**
```sql
INSERT INTO settings (user_id, key, value)
VALUES (123, 'theme', 'dark')
ON CONFLICT (user_id, key)
DO UPDATE SET value = EXCLUDED.value;
```

**カーソルページネーション:**
```sql
SELECT * FROM products WHERE id > $last_id ORDER BY id LIMIT 20;
-- O(1) vs OFFSET は O(n)
```

**キュー処理:**
```sql
UPDATE jobs SET status = 'processing'
WHERE id = (
  SELECT id FROM jobs WHERE status = 'pending'
  ORDER BY created_at LIMIT 1
  FOR UPDATE SKIP LOCKED
) RETURNING *;
```

### アンチパターン検出

```sql
-- インデックスのない外部キーを検索
-- 有効な非部分B-treeの先頭キーに外部キー全列がない候補を確認
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

-- 低速クエリを検索
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC;

-- テーブル肥大化をチェック
SELECT relname, n_dead_tup, last_vacuum
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

### 設定テンプレート

```sql
-- 接続制限（RAMに応じて調整）
ALTER SYSTEM SET max_connections = 100;
ALTER SYSTEM SET work_mem = '8MB';

-- タイムアウト
ALTER SYSTEM SET idle_in_transaction_session_timeout = '30s';
ALTER SYSTEM SET statement_timeout = '30s';

-- モニタリング
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- セキュリティデフォルト
REVOKE ALL ON SCHEMA public FROM public;

SELECT pg_reload_conf();
```

## 関連

- Agent: `database-reviewer` - 完全なデータベースレビューワークフロー
- Skill: `clickhouse-io` - ClickHouse分析パターン
- Skill: `backend-patterns` - APIとバックエンドパターン

---

*[Supabase Agent Skills](Supabase Agent Skills (credit: Supabase team))（MITライセンス）に基づく*
