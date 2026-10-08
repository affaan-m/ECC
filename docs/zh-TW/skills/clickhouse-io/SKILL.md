---
name: clickhouse-io
description: ClickHouse database patterns, query optimization, analytics, and data engineering best practices for high-performance analytical workloads.
---

# ClickHouse 分析模式

用於高效能分析和資料工程的 ClickHouse 特定模式。

## 概述

ClickHouse 是一個列式資料庫管理系統（DBMS），用於線上分析處理（OLAP）。它針對大型資料集的快速分析查詢進行了優化。

**關鍵特性：**
- 列式儲存
- 資料壓縮
- 平行查詢執行
- 分散式查詢
- 即時分析

## 表格設計模式

### MergeTree 引擎（最常見）

```sql
CREATE TABLE markets_analytics (
    date Date,
    market_id String,
    market_name String,
    volume UInt64,
    trades UInt32,
    unique_traders UInt32,
    avg_trade_size Float64,
    created_at DateTime
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, market_id)
SETTINGS index_granularity = 8192;
```

### ReplacingMergeTree（去重）

```sql
-- 用於可能有重複的資料（例如來自多個來源）
CREATE TABLE user_events (
    event_id String,
    user_id String,
    event_type String,
    timestamp DateTime,
    properties String
) ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (user_id, event_id, timestamp)
PRIMARY KEY (user_id, event_id);
```

去重依據完整的 `ORDER BY` 元組 `(user_id, event_id, timestamp)`，而不是較短的 `PRIMARY KEY`。此範例假設事件時間戳記不變，使重試保持相同排序鍵和月份分割區。背景合併非同步發生，且僅在分割區內進行；需要無重複結果時，應使用 `FINAL` 等查詢時去重。不要在每次讀取前強制磁碟合併。

```sql
SELECT user_id, event_id, timestamp, properties
FROM user_events FINAL
WHERE user_id = 'user-123';
```

### AggregatingMergeTree（預聚合）

```sql
-- 用於維護聚合指標
CREATE TABLE market_stats_hourly (
    hour DateTime,
    market_id String,
    total_volume AggregateFunction(sum, UInt64),
    total_trades AggregateFunction(count, UInt32),
    unique_users AggregateFunction(uniq, String)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (hour, market_id);

-- 查詢聚合資料
SELECT
    hour,
    market_id,
    sumMerge(total_volume) AS volume,
    countMerge(total_trades) AS trades,
    uniqMerge(unique_users) AS users
FROM market_stats_hourly
WHERE hour >= toStartOfHour(now() - INTERVAL 24 HOUR)
GROUP BY hour, market_id
ORDER BY hour DESC;
```

## 查詢優化模式

### 高效過濾

```sql
-- PASS: 良好：先使用索引欄位
SELECT *
FROM markets_analytics
WHERE date >= '2025-01-01'
  AND market_id = 'market-123'
  AND volume > 1000
ORDER BY date DESC
LIMIT 100;

-- FAIL: 不良：先過濾非索引欄位
SELECT *
FROM markets_analytics
WHERE volume > 1000
  AND market_name LIKE '%election%'
  AND date >= '2025-01-01';
```

### 聚合

```sql
-- PASS: 良好：使用 ClickHouse 特定聚合函式
SELECT
    toStartOfDay(created_at) AS day,
    market_id,
    sum(volume) AS total_volume,
    count() AS total_trades,
    uniq(trader_id) AS unique_traders,
    avg(trade_size) AS avg_size
FROM trades
WHERE created_at >= today() - INTERVAL 7 DAY
GROUP BY day, market_id
ORDER BY day DESC, total_volume DESC;

-- PASS: 使用 quantile 計算百分位數（比 percentile 更高效）
SELECT
    quantile(0.50)(trade_size) AS median,
    quantile(0.95)(trade_size) AS p95,
    quantile(0.99)(trade_size) AS p99
FROM trades
WHERE created_at >= now() - INTERVAL 1 HOUR;
```

### 視窗函式

```sql
-- 計算累計總和
SELECT
    date,
    market_id,
    volume,
    sum(volume) OVER (
        PARTITION BY market_id
        ORDER BY date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cumulative_volume
FROM markets_analytics
WHERE date >= today() - INTERVAL 30 DAY
ORDER BY market_id, date;
```

## 資料插入模式

### 批量插入（推薦）

```typescript
import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD
})

// PASS: 批量插入（高效）
async function bulkInsertTrades(trades: Trade[]) {
  await clickhouse.insert({
    table: 'trades',
    values: trades.map(trade => ({
      id: trade.id,
      market_id: trade.market_id,
      user_id: trade.user_id,
      amount: trade.amount,
      timestamp: trade.timestamp.toISOString()
    })),
    format: 'JSONEachRow'
  })
}

// FAIL: 個別插入（慢）
async function insertTrade(trade: Trade) {
  // 不要在迴圈中這樣做！
  await clickhouse.insert({
    table: 'trades',
    values: [{
      id: trade.id,
      market_id: trade.market_id,
      user_id: trade.user_id,
      amount: trade.amount,
      timestamp: trade.timestamp.toISOString()
    }],
    format: 'JSONEachRow'
  })
}
```

### 串流插入

```typescript
// 用於持續資料攝取
import { Readable } from 'node:stream'

async function streamInserts(dataSource: AsyncIterable<Record<string, unknown>>) {
  await clickhouse.insert({
    table: 'trades',
    values: Readable.from(dataSource, { objectMode: true }),
    format: 'JSONEachRow'
  })
}
```

## 物化視圖

### 即時聚合

```sql
-- 建立每小時統計的物化視圖
CREATE MATERIALIZED VIEW market_stats_hourly_mv
TO market_stats_hourly
AS SELECT
    toStartOfHour(timestamp) AS hour,
    market_id,
    sumState(amount) AS total_volume,
    countState() AS total_trades,
    uniqState(user_id) AS unique_users
FROM trades
GROUP BY hour, market_id;

-- 查詢物化視圖
SELECT
    hour,
    market_id,
    sumMerge(total_volume) AS volume,
    countMerge(total_trades) AS trades,
    uniqMerge(unique_users) AS users
FROM market_stats_hourly
WHERE hour >= now() - INTERVAL 24 HOUR
GROUP BY hour, market_id;
```

## 效能監控

### 查詢效能

```sql
-- 檢查慢查詢
SELECT
    query_id,
    user,
    query,
    query_duration_ms,
    read_rows,
    read_bytes,
    memory_usage
FROM system.query_log
WHERE type = 'QueryFinish'
  AND query_duration_ms > 1000
  AND event_time >= now() - INTERVAL 1 HOUR
ORDER BY query_duration_ms DESC
LIMIT 10;
```

### 表格統計

```sql
-- 檢查表格大小
SELECT
    database,
    table,
    formatReadableSize(sum(bytes)) AS size,
    sum(rows) AS rows,
    max(modification_time) AS latest_modification
FROM system.parts
WHERE active
GROUP BY database, table
ORDER BY sum(bytes) DESC;
```

## 常見分析查詢

### 時間序列分析

```sql
-- 每日活躍使用者
SELECT
    toDate(timestamp) AS date,
    uniq(user_id) AS daily_active_users
FROM events
WHERE timestamp >= today() - INTERVAL 30 DAY
GROUP BY date
ORDER BY date;

-- 留存分析
-- 以每位使用者首次觀測到的活動日期劃分群組，每位使用者每天只計一次
SELECT
    signup_date,
    countIf(days_since_signup = 0) AS day_0,
    countIf(days_since_signup = 1) AS day_1,
    countIf(days_since_signup = 7) AS day_7,
    countIf(days_since_signup = 30) AS day_30
FROM (
    SELECT DISTINCT
        user_id,
        min(toDate(timestamp)) OVER (PARTITION BY user_id) AS signup_date,
        toDate(timestamp) AS activity_date,
        dateDiff('day', signup_date, activity_date) AS days_since_signup
    FROM events
)
GROUP BY signup_date
ORDER BY signup_date DESC;
```

### 漏斗分析

```sql
-- 轉換漏斗
SELECT
    countIf(step = 'viewed_market') AS viewed,
    countIf(step = 'clicked_trade') AS clicked,
    countIf(step = 'completed_trade') AS completed,
    round(clicked / viewed * 100, 2) AS view_to_click_rate,
    round(completed / clicked * 100, 2) AS click_to_completion_rate
FROM (
    SELECT
        user_id,
        session_id,
        event_type AS step
    FROM events
    WHERE event_date = today()
)
GROUP BY session_id;
```

### 世代分析

```sql
-- 按註冊月份的使用者世代
SELECT
    toStartOfMonth(signup_date) AS cohort,
    toStartOfMonth(activity_date) AS month,
    dateDiff('month', cohort, month) AS months_since_signup,
    count(DISTINCT user_id) AS active_users
FROM (
    SELECT
        user_id,
        min(toDate(timestamp)) OVER (PARTITION BY user_id) AS signup_date,
        toDate(timestamp) AS activity_date
    FROM events
)
GROUP BY cohort, month, months_since_signup
ORDER BY cohort, months_since_signup;
```

## 資料管線模式

### ETL 模式

```typescript
// 提取、轉換、載入
async function etlPipeline() {
  // 1. 從來源提取
  const rawData = await extractFromPostgres()

  // 2. 轉換
  const transformed = rawData.map(row => ({
    date: new Date(row.created_at).toISOString().split('T')[0],
    market_id: row.market_slug,
    volume: parseFloat(row.total_volume),
    trades: parseInt(row.trade_count)
  }))

  // 3. 載入到 ClickHouse
  await bulkInsertToClickHouse(transformed)
}

// 定期執行
setInterval(etlPipeline, 60 * 60 * 1000)  // 每小時
```

### 變更通知（LISTEN/NOTIFY）

```typescript
// 監聽 PostgreSQL 變更並同步到 ClickHouse
import { Client } from 'pg'

const pgClient = new Client({ connectionString: process.env.DATABASE_URL })

pgClient.on('error', (error) => {
  console.error('PostgreSQL listener connection failed:', error)
})

pgClient.on('notification', (msg) => {
  if (!msg.payload) return
  void forwardNotification(msg.payload)
})

async function forwardNotification(payload: string) {

  try {
    const update = JSON.parse(payload)

    await clickhouse.insert({
      table: 'market_updates',
      values: [
        {
          market_id: update.id,
          event_type: update.operation,  // INSERT, UPDATE, DELETE
          timestamp: new Date(),
          data: JSON.stringify(update.new_data)
        }
      ],
      format: 'JSONEachRow'
    })
  } catch (error) {
    console.error('Failed to forward market update:', error)
  }
}

async function startNotificationListener() {
  await pgClient.connect()
  await pgClient.query('LISTEN market_updates')
}

void startNotificationListener().catch(async (error) => {
  console.error('Failed to start notification listener:', error)
  try {
    await pgClient.end()
  } catch (closeError) {
    console.error('Failed to close PostgreSQL listener:', closeError)
  }
  process.exitCode = 1
})
```

此範例在工作階段監聽期間轉送應用程式發出的 JSON 通知。`LISTEN` 註冊隨工作階段結束而清除，因此不提供持久 CDC 或重播。需要保留監聽器停機期間的變更時，應使用邏輯解碼或持久 outbox。

## 最佳實務

### 1. 分區策略
- 按時間分區（通常按月或日）
- 避免太多分區（效能影響）
- 分區鍵使用 DATE 類型

### 2. 排序鍵
- 最常過濾的欄位放在最前面
- 考慮基數（高基數優先）
- 排序影響壓縮

### 3. 資料類型
- 使用最小的適當類型（UInt32 vs UInt64）
- 重複字串使用 LowCardinality
- 分類資料使用 Enum

### 4. 避免
- SELECT *（指定欄位）
- 對不需要去重的讀取使用不必要的 `FINAL`（正確性需要時保留 `FINAL` 或等效查詢時去重）
- 太多 JOINs（為分析反正規化）
- 小量頻繁插入（改用批量）

### 5. 監控
- 追蹤查詢效能
- 監控磁碟使用
- 檢查合併操作
- 審查慢查詢日誌

**記住**：ClickHouse 擅長分析工作負載。為你的查詢模式設計表格，批量插入，並利用物化視圖進行即時聚合。
