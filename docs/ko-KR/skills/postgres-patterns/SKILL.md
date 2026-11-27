---
name: postgres-patterns
description: 쿼리 최적화, 스키마 설계, 인덱싱, 보안을 위한 PostgreSQL 데이터베이스 패턴. Supabase 모범 사례 기반.
origin: ECC
---

# PostgreSQL 패턴

PostgreSQL 모범 사례 빠른 참조. 자세한 가이드는 `database-reviewer` 에이전트를 사용하세요.

## 활성화 시점

- SQL 쿼리 또는 마이그레이션을 작성할 때
- 데이터베이스 스키마를 설계할 때
- 느린 쿼리를 문제 해결할 때
- Row Level Security를 구현할 때
- 커넥션 풀링을 설정할 때

## 빠른 참조

### 인덱스 치트 시트

| 쿼리 패턴 | 인덱스 유형 | 예시 |
|--------------|------------|---------|
| `WHERE col = value` | B-tree (기본값) | `CREATE INDEX idx ON t (col)` |
| `WHERE col > value` | B-tree | `CREATE INDEX idx ON t (col)` |
| `WHERE a = x AND b > y` | Composite | `CREATE INDEX idx ON t (a, b)` |
| `WHERE jsonb @> '{}'` | GIN | `CREATE INDEX idx ON t USING gin (col)` |
| `WHERE tsv @@ query` | GIN | `CREATE INDEX idx ON t USING gin (col)` |
| 시계열 범위 | BRIN | `CREATE INDEX idx ON t USING brin (col)` |

### 데이터 타입 빠른 참조

| 사용 사례 | 올바른 타입 | 지양 |
|----------|-------------|-------|
| ID | `bigint` | `int`, random UUID |
| 문자열 | `text` | `varchar(255)` |
| 타임스탬프 | `timestamptz` | `timestamp` |
| 금액 | `numeric(10,2)` | `float` |
| 플래그 | `boolean` | `varchar`, `int` |

### 일반 패턴

**복합 인덱스 순서:**
```sql
-- Equality columns first, then range columns
CREATE INDEX idx ON orders (status, created_at);
-- Works for: WHERE status = 'pending' AND created_at > '2024-01-01'
```

**커버링 인덱스:**
```sql
CREATE INDEX idx ON users (email) INCLUDE (name, created_at);
-- Avoids table lookup for SELECT email, name, created_at
```

**부분 인덱스:**
```sql
CREATE INDEX idx ON users (email) WHERE deleted_at IS NULL;
-- Smaller index, only includes active users
```

**RLS 정책 (최적화):**
```sql
CREATE POLICY policy ON orders
  USING ((SELECT auth.uid()) = user_id);  -- Wrap in SELECT!
```

**UPSERT:**
```sql
INSERT INTO settings (user_id, key, value)
VALUES (123, 'theme', 'dark')
ON CONFLICT (user_id, key)
DO UPDATE SET value = EXCLUDED.value;
```

**커서 페이지네이션:**
```sql
SELECT * FROM products WHERE id > $last_id ORDER BY id LIMIT 20;
-- O(1) vs OFFSET which is O(n)
```

**큐 처리:**
```sql
UPDATE jobs SET status = 'processing'
WHERE id = (
  SELECT id FROM jobs WHERE status = 'pending'
  ORDER BY created_at LIMIT 1
  FOR UPDATE SKIP LOCKED
) RETURNING *;
```

### 안티패턴 감지

```sql
-- Find unindexed foreign keys
SELECT conrelid::regclass, a.attname
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
WHERE c.contype = 'f'
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.conrelid AND a.attnum = ANY(i.indkey)
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

### 구성 템플릿

```sql
-- Connection limits (adjust for RAM)
ALTER SYSTEM SET max_connections = 100;
ALTER SYSTEM SET work_mem = '8MB';

-- Timeouts
ALTER SYSTEM SET idle_in_transaction_session_timeout = '30s';
ALTER SYSTEM SET statement_timeout = '30s';

-- Monitoring
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Security defaults
REVOKE ALL ON SCHEMA public FROM public;

SELECT pg_reload_conf();
```

## 관련 항목

- 에이전트: `database-reviewer` - 전체 데이터베이스 리뷰 워크플로우
- 스킬: `clickhouse-io` - ClickHouse 분석 패턴
- 스킬: `backend-patterns` - API 및 백엔드 패턴

---

*Supabase Agent Skills 기반 (크레딧: Supabase 팀) (MIT License)*
