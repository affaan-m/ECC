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
SELECT conrelid::regclass, a.attname
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
WHERE c.contype = 'f'
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.conrelid AND a.attnum = ANY(i.indkey)
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

-- セキュリティデフォルト
REVOKE ALL ON SCHEMA public FROM public;

SELECT pg_reload_conf();
```

`pg_reload_conf()` は再読み込み可能な設定だけを反映します。`max_connections` の変更にはサーバーの再起動が必要です。`pg_stat_statements` を使用する前に、既存の項目を保持して `shared_preload_libraries` に追加し、組み込みのクエリ識別子には `compute_query_id = auto` または `on` を使用し、外部モジュールがクエリ識別子を計算する場合は `off` に設定します。プリロードの一覧を変更した場合はサーバーを再起動し、統計ビューが必要な各データベースに接続して次を実行します:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

## 関連

- Agent: `database-reviewer` - 完全なデータベースレビューワークフロー
- Skill: `clickhouse-io` - ClickHouse分析パターン
- Skill: `backend-patterns` - APIとバックエンドパターン

---

*[Supabase Agent Skills](Supabase Agent Skills (credit: Supabase team))（MITライセンス）に基づく*
