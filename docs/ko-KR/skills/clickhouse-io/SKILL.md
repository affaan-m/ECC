---
name: clickhouse-io
description: 고성능 분석 워크로드를 위한 ClickHouse 데이터베이스 패턴, 쿼리 최적화, 분석 및 데이터 엔지니어링 모범 사례.
origin: ECC
---

# ClickHouse 분석 패턴

고성능 분석 및 데이터 엔지니어링을 위한 ClickHouse 전용 패턴.

## 활성화 시점

- ClickHouse 테이블 스키마 설계 시 (MergeTree 엔진 선택)
- 분석 쿼리 작성 시 (집계, 윈도우 함수, 조인)
- 쿼리 성능 최적화 시 (파티션 프루닝, 프로젝션, 구체화된 뷰)
- 대량 데이터 수집 시 (배치 삽입, Kafka 통합)
- PostgreSQL/MySQL에서 ClickHouse로 분석 마이그레이션 시
- 실시간 대시보드 또는 시계열 분석 구현 시

## 개요

ClickHouse는 온라인 분석 처리(OLAP)를 위한 컬럼 지향 데이터베이스 관리 시스템(DBMS)입니다. 대규모 데이터셋에 대한 빠른 분석 쿼리에 최적화되어 있습니다.

**주요 특징:**
- 컬럼 지향 저장소
- 데이터 압축
- 병렬 쿼리 실행
- 분산 쿼리
- 실시간 분석

## 테이블 설계 패턴

### MergeTree 엔진 (가장 일반적)

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

### ReplacingMergeTree (중복 제거)

```sql
-- 중복이 있을 수 있는 데이터용 (예: 여러 소스에서 수집된 경우)
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

### AggregatingMergeTree (사전 집계)

```sql
-- 집계 메트릭을 유지하기 위한 용도
CREATE TABLE market_stats_hourly (
    hour DateTime,
    market_id String,
    total_volume AggregateFunction(sum, UInt64),
    total_trades AggregateFunction(count, UInt32),
    unique_users AggregateFunction(uniq, String)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (hour, market_id);

-- 집계된 데이터 조회
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

## 쿼리 최적화 패턴

### 효율적인 필터링

```sql
-- PASS: 좋음: 인덱스된 컬럼을 먼저 사용
SELECT *
FROM markets_analytics
WHERE date >= '2025-01-01'
  AND market_id = 'market-123'
  AND volume > 1000
ORDER BY date DESC
LIMIT 100;

-- FAIL: 나쁨: 비인덱스 컬럼을 먼저 필터링
SELECT *
FROM markets_analytics
WHERE volume > 1000
  AND market_name LIKE '%election%'
  AND date >= '2025-01-01';
```

### 집계

```sql
-- PASS: 좋음: ClickHouse 전용 집계 함수를 사용
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

-- PASS: 백분위수에는 quantile 사용 (percentile보다 효율적)
SELECT
    quantile(0.50)(trade_size) AS median,
    quantile(0.95)(trade_size) AS p95,
    quantile(0.99)(trade_size) AS p99
FROM trades
WHERE created_at >= now() - INTERVAL 1 HOUR;
```

### 윈도우 함수

```sql
-- 누적 합계 계산
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

## 데이터 삽입 패턴

### 배치 삽입 (권장)

```typescript
import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD
})

// PASS: 배치 삽입 (효율적)
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

// FAIL: 개별 삽입 (느림)
async function insertTrade(trade: Trade) {
  // 루프 안에서 이렇게 하지 마세요!
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

### 스트리밍 삽입

```typescript
// 연속적인 데이터 수집용
import { Readable } from 'node:stream'

async function streamInserts(dataSource: AsyncIterable<Record<string, unknown>>) {
  await clickhouse.insert({
    table: 'trades',
    values: Readable.from(dataSource, { objectMode: true }),
    format: 'JSONEachRow'
  })
}
```

## 구체화된 뷰

### 실시간 집계

```sql
-- 시간별 통계를 위한 materialized view 생성
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

-- materialized view 조회
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

## 성능 모니터링

### 쿼리 성능

```sql
-- 느린 쿼리 확인
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

### 테이블 통계

```sql
-- 테이블 크기 확인
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

## 일반적인 분석 쿼리

### 시계열 분석

```sql
-- 일간 활성 사용자
SELECT
    toDate(timestamp) AS date,
    uniq(user_id) AS daily_active_users
FROM events
WHERE timestamp >= today() - INTERVAL 30 DAY
GROUP BY date
ORDER BY date;

-- 리텐션 분석
SELECT
    signup_date,
    countIf(days_since_signup = 0) AS day_0,
    countIf(days_since_signup = 1) AS day_1,
    countIf(days_since_signup = 7) AS day_7,
    countIf(days_since_signup = 30) AS day_30
FROM (
    SELECT
        user_id,
        min(toDate(timestamp)) AS signup_date,
        toDate(timestamp) AS activity_date,
        dateDiff('day', signup_date, activity_date) AS days_since_signup
    FROM events
    GROUP BY user_id, activity_date
)
GROUP BY signup_date
ORDER BY signup_date DESC;
```

### 퍼널 분석

```sql
-- 전환 퍼널
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

### 코호트 분석

```sql
-- 가입 월별 사용자 코호트
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

## 데이터 파이프라인 패턴

### ETL 패턴

```typescript
// 추출, 변환, 적재(ETL)
async function etlPipeline() {
  // 1. 소스에서 추출
  const rawData = await extractFromPostgres()

  // 2. 변환
  const transformed = rawData.map(row => ({
    date: new Date(row.created_at).toISOString().split('T')[0],
    market_id: row.market_slug,
    volume: parseFloat(row.total_volume),
    trades: parseInt(row.trade_count)
  }))

  // 3. ClickHouse에 적재
  await bulkInsertToClickHouse(transformed)
}

// 주기적으로 실행
let etlRunning = false

setInterval(async () => {
  if (etlRunning) return

  etlRunning = true
  try {
    await etlPipeline()
  } finally {
    etlRunning = false
  }
}, 60 * 60 * 1000)  // Every hour
```

### 변경 데이터 캡처 (CDC)

```typescript
// PostgreSQL 변경을 수신하고 ClickHouse와 동기화
import { Client } from 'pg'

const pgClient = new Client({ connectionString: process.env.DATABASE_URL })

pgClient.query('LISTEN market_updates')

pgClient.on('notification', async (msg) => {
  const update = JSON.parse(msg.payload)

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
})
```

## 모범 사례

### 1. 파티셔닝 전략
- 시간별 파티셔닝 (보통 월 또는 일)
- 파티션이 너무 많은 것 방지 (성능 영향)
- 파티션 키에 DATE 타입 사용

### 2. 정렬 키
- 가장 자주 필터링되는 컬럼을 먼저 배치
- 카디널리티 고려 (높은 카디널리티 먼저)
- 정렬이 압축에 영향을 미침

### 3. 데이터 타입
- 가장 작은 적절한 타입 사용 (UInt32 vs UInt64)
- 반복되는 문자열에 LowCardinality 사용
- 범주형 데이터에 Enum 사용

### 4. 피해야 할 것
- SELECT * (컬럼을 명시)
- FINAL (쿼리 전에 데이터를 병합)
- 너무 많은 JOIN (분석을 위해 비정규화)
- 작은 빈번한 삽입 (배치 처리)

### 5. 모니터링
- 쿼리 성능 추적
- 디스크 사용량 모니터링
- 병합 작업 확인
- 슬로우 쿼리 로그 검토

**기억하세요**: ClickHouse는 분석 워크로드에 탁월합니다. 쿼리 패턴에 맞게 테이블을 설계하고, 배치 삽입을 사용하며, 실시간 집계를 위해 구체화된 뷰를 활용하세요.
