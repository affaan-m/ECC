---
name: postgres-patterns
description: Sorgu optimizasyonu, şema tasarımı, indeksleme ve güvenlik için PostgreSQL veritabanı kalıpları. Supabase en iyi uygulamalarına dayanır.
origin: ECC
---

# PostgreSQL Kalıpları

PostgreSQL en iyi uygulamaları için hızlı referans. Detaylı kılavuz için `database-reviewer` agent'ını kullanın.

## Ne Zaman Aktifleştirmeli

- SQL sorguları veya migration'lar yazarken
- Veritabanı şemaları tasarlarken
- Yavaş sorguları troubleshoot ederken
- Row Level Security uygularken
- Connection pooling kurarken

## Hızlı Referans

### İndeks Hile Sayfası

| Sorgu Kalıbı | İndeks Tipi | Örnek |
|--------------|------------|---------|
| `WHERE col = value` | B-tree (varsayılan) | `CREATE INDEX idx ON t (col)` |
| `WHERE col > value` | B-tree | `CREATE INDEX idx ON t (col)` |
| `WHERE a = x AND b > y` | Composite | `CREATE INDEX idx ON t (a, b)` |
| `WHERE jsonb @> '{}'` | GIN | `CREATE INDEX idx ON t USING gin (col)` |
| `WHERE tsv @@ query` | GIN | `CREATE INDEX idx ON t USING gin (col)` |
| Zaman serisi aralıkları | BRIN | `CREATE INDEX idx ON t USING brin (col)` |

### Veri Tipi Hızlı Referans

| Kullanım Senaryosu | Doğru Tip | Kaçın |
|----------|-------------|-------|
| ID'ler | `bigint` | `int`, rastgele UUID |
| String'ler | `text` | `varchar(255)` |
| Timestamp'ler | `timestamptz` | `timestamp` |
| Para | `numeric(10,2)` | `float` |
| Flag'ler | `boolean` | `varchar`, `int` |

### Yaygın Kalıplar

**Composite İndeks Sırası:**
```sql
-- Önce eşitlik sütunları, sonra aralık sütunları
CREATE INDEX idx ON orders (status, created_at);
-- Şunlar için çalışır: WHERE status = 'pending' AND created_at > '2024-01-01'
```

**Covering İndeks:**
```sql
CREATE INDEX idx ON users (email) INCLUDE (name, created_at);
-- SELECT email, name, created_at için tablo aramasını önler
```

**Partial İndeks:**
```sql
CREATE INDEX idx ON users (email) WHERE deleted_at IS NULL;
-- Daha küçük indeks, sadece aktif kullanıcıları içerir
```

**RLS Policy (Optimize Edilmiş):**
```sql
CREATE POLICY policy ON orders
  USING ((SELECT auth.uid()) = user_id);  -- SELECT'e sar!
```

**UPSERT:**
```sql
INSERT INTO settings (user_id, key, value)
VALUES (123, 'theme', 'dark')
ON CONFLICT (user_id, key)
DO UPDATE SET value = EXCLUDED.value;
```

**Cursor Sayfalama:**
```sql
SELECT * FROM products WHERE id > $last_id ORDER BY id LIMIT 20;
-- O(1) vs O(n) olan OFFSET
```

**Kuyruk İşleme:**
```sql
UPDATE jobs SET status = 'processing'
WHERE id = (
  SELECT id FROM jobs WHERE status = 'pending'
  ORDER BY created_at LIMIT 1
  FOR UPDATE SKIP LOCKED
) RETURNING *;
```

### Anti-Kalıp Tespiti

```sql
-- İndekslenmemiş foreign key'leri bul
SELECT conrelid::regclass, a.attname
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
WHERE c.contype = 'f'
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.conrelid AND a.attnum = ANY(i.indkey)
  );

-- Yavaş sorguları bul
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC;

-- Tablo bloat'ını kontrol et
SELECT relname, n_dead_tup, last_vacuum
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

### Yapılandırma Şablonu

```sql
-- Bağlantı limitleri (RAM için ayarla)
ALTER SYSTEM SET max_connections = 100;
ALTER SYSTEM SET work_mem = '8MB';

-- Timeout'lar
ALTER SYSTEM SET idle_in_transaction_session_timeout = '30s';
ALTER SYSTEM SET statement_timeout = '30s';

-- İzleme
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Güvenlik varsayılanları
REVOKE ALL ON SCHEMA public FROM public;

SELECT pg_reload_conf();
```

## İlgili

- Agent: `database-reviewer` - Tam veritabanı inceleme iş akışı
- Skill: `clickhouse-io` - ClickHouse analytics kalıpları
- Skill: `backend-patterns` - API ve backend kalıpları

---

*Supabase Agent Skills'e dayanır (kredi: Supabase ekibi) (MIT License)*
