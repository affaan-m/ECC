---
name: coding-standards
description: Universal coding standards, best practices, and patterns for TypeScript, JavaScript, React, and Node.js development.
---

# 程式碼標準與最佳實務

適用於所有專案的通用程式碼標準。

## 程式碼品質原則

### 1. 可讀性優先
- 程式碼被閱讀的次數遠多於被撰寫的次數
- 使用清晰的變數和函式名稱
- 優先使用自文件化的程式碼而非註解
- 保持一致的格式化

### 2. KISS（保持簡單）
- 使用最簡單的解決方案
- 避免過度工程
- 不做過早優化
- 易於理解 > 聰明的程式碼

### 3. DRY（不重複自己）
- 將共用邏輯提取為函式
- 建立可重用的元件
- 在模組間共享工具函式
- 避免複製貼上程式設計

### 4. YAGNI（你不會需要它）
- 在需要之前不要建置功能
- 避免推測性的通用化
- 只在需要時增加複雜度
- 從簡單開始，需要時再重構

## TypeScript/JavaScript 標準

### 變數命名

```typescript
// PASS: 良好：描述性名稱
const marketSearchQuery = 'election'
const isUserAuthenticated = true
const totalRevenue = 1000

// FAIL: 不良：不清楚的名稱
const q = 'election'
const flag = true
const x = 1000
```

### 函式命名

```typescript
// PASS: 良好：動詞-名詞模式
async function fetchMarketData(marketId: string) { }
function calculateSimilarity(a: number[], b: number[]) { }
function isValidEmail(email: string): boolean { }

// FAIL: 不良：不清楚或只有名詞
async function market(id: string) { }
function similarity(a, b) { }
function email(e) { }
```

### 不可變性模式（關鍵）

```typescript
// PASS: 總是使用展開運算符
const updatedUser = {
  ...user,
  name: 'New Name'
}

const updatedArray = [...items, newItem]

// FAIL: 永遠不要直接修改
user.name = 'New Name'  // 不良
items.push(newItem)     // 不良
```

### 錯誤處理

```typescript
// PASS: 良好：完整的錯誤處理
async function fetchData(url: string) {
  try {
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Fetch failed:', error)
    throw new Error('Failed to fetch data')
  }
}

// FAIL: 不良：無錯誤處理
async function fetchData(url) {
  const response = await fetch(url)
  return response.json()
}
```

### Async/Await 最佳實務

```typescript
// PASS: 良好：可能時並行執行
const [users, markets, stats] = await Promise.all([
  fetchUsers(),
  fetchMarkets(),
  fetchStats()
])

// FAIL: 不良：不必要的順序執行
const users = await fetchUsers()
const markets = await fetchMarkets()
const stats = await fetchStats()
```

### 型別安全

```typescript
// PASS: 良好：正確的型別
interface Market {
  id: string
  name: string
  status: 'active' | 'resolved' | 'closed'
  created_at: Date
}

function getMarket(id: string): Promise<Market> {
  // 實作
}

// FAIL: 不良：使用 'any'
function getMarket(id: any): Promise<any> {
  // 實作
}
```

## React 最佳實務

### 元件結構

```typescript
// PASS: 良好：具有型別的函式元件
interface ButtonProps {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary'
}

export function Button({
  children,
  onClick,
  disabled = false,
  variant = 'primary'
}: ButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`btn btn-${variant}`}
    >
      {children}
    </button>
  )
}

// FAIL: 不良：無型別、結構不清楚
export function Button(props) {
  return <button onClick={props.onClick}>{props.children}</button>
}
```

### 自訂 Hooks

```typescript
// PASS: 良好：可重用的自訂 hook
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}

// 使用方式
const debouncedQuery = useDebounce(searchQuery, 500)
```

### 狀態管理

```typescript
// PASS: 良好：正確的狀態更新
const [count, setCount] = useState(0)

// 基於先前狀態的函式更新
setCount(prev => prev + 1)

// FAIL: 不良：直接引用狀態
setCount(count + 1)  // 在非同步情境中可能過時
```

### 條件渲染

```typescript
// PASS: 良好：清晰的條件渲染
{isLoading && <Spinner />}
{error && <ErrorMessage error={error} />}
{data && <DataDisplay data={data} />}

// FAIL: 不良：三元地獄
{isLoading ? <Spinner /> : error ? <ErrorMessage error={error} /> : data ? <DataDisplay data={data} /> : null}
```

## API 設計標準

### REST API 慣例

```
GET    /api/markets              # 列出所有市場
GET    /api/markets/:id          # 取得特定市場
POST   /api/markets              # 建立新市場
PUT    /api/markets/:id          # 更新市場（完整）
PATCH  /api/markets/:id          # 更新市場（部分）
DELETE /api/markets/:id          # 刪除市場

# 過濾用查詢參數
GET /api/markets?status=active&limit=10&offset=0
```

### 回應格式

```typescript
// PASS: 良好：一致的回應結構
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  meta?: {
    total: number
    page: number
    limit: number
  }
}

// 成功回應
return NextResponse.json({
  success: true,
  data: markets,
  meta: { total: 100, page: 1, limit: 10 }
})

// 錯誤回應
return NextResponse.json({
  success: false,
  error: 'Invalid request'
}, { status: 400 })
```

### 輸入驗證

```typescript
import { z } from 'zod'

// PASS: 良好：Schema 驗證
const CreateMarketSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  endDate: z.string().datetime(),
  categories: z.array(z.string()).min(1)
})

export async function POST(request: Request) {
  const body = await request.json()

  try {
    const validated = CreateMarketSchema.parse(body)
    // 使用驗證過的資料繼續處理
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        error: 'Validation failed',
        details: error.errors
      }, { status: 400 })
    }
  }
}
```

## 檔案組織

### 專案結構

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API 路由
│   ├── markets/           # 市場頁面
│   └── (auth)/           # 認證頁面（路由群組）
├── components/            # React 元件
│   ├── ui/               # 通用 UI 元件
│   ├── forms/            # 表單元件
│   └── layouts/          # 版面配置元件
├── hooks/                # 自訂 React hooks
├── lib/                  # 工具和設定
│   ├── api/             # API 客戶端
│   ├── utils/           # 輔助函式
│   └── constants/       # 常數
├── types/                # TypeScript 型別
└── styles/              # 全域樣式
```

### 檔案命名

```
components/Button.tsx          # 元件用 PascalCase
hooks/useAuth.ts              # hooks 用 camelCase 加 'use' 前綴
lib/formatDate.ts             # 工具用 camelCase
types/market.types.ts         # 型別用 camelCase 加 .types 後綴
```

## 註解與文件

### 何時註解

```typescript
// PASS: 良好：解釋「為什麼」而非「什麼」
// 使用指數退避以避免在服務中斷時壓垮 API
const delay = Math.min(1000 * Math.pow(2, retryCount), 30000)

// 為了處理大陣列的效能，此處刻意使用突變
items.push(newItem)

// FAIL: 不良：陳述顯而易見的事實
// 將計數器加 1
count++

// 將名稱設為使用者的名稱
name = user.name
```

### 公開 API 的 JSDoc

```typescript
/**
 * 使用語意相似度搜尋市場。
 *
 * @param query - 自然語言搜尋查詢
 * @param limit - 最大結果數量（預設：10）
 * @returns 按相似度分數排序的市場陣列
 * @throws {Error} 如果 OpenAI API 失敗或 Redis 不可用
 *
 * @example
 * ```typescript
 * const results = await searchMarkets('election', 5)
 * console.log(results[0].name) // "Trump vs Biden"
 * ```
 */
export async function searchMarkets(
  query: string,
  limit: number = 10
): Promise<Market[]> {
  // 實作
}
```

## 效能最佳實務

### 記憶化

```typescript
import { useMemo, useCallback } from 'react'

// PASS: 良好：記憶化昂貴的計算
const sortedMarkets = useMemo(() => {
  return markets.sort((a, b) => b.volume - a.volume)
}, [markets])

// PASS: 良好：記憶化回呼函式
const handleSearch = useCallback((query: string) => {
  setSearchQuery(query)
}, [])
```

### 延遲載入

```typescript
import { lazy, Suspense } from 'react'

// PASS: 良好：延遲載入重型元件
const HeavyChart = lazy(() => import('./HeavyChart'))

export function Dashboard() {
  return (
    <Suspense fallback={<Spinner />}>
      <HeavyChart />
    </Suspense>
  )
}
```

### 資料庫查詢

```typescript
// PASS: 良好：只選擇需要的欄位
const { data } = await supabase
  .from('markets')
  .select('id, name, status')
  .limit(10)

// FAIL: 不良：選擇所有欄位
const { data } = await supabase
  .from('markets')
  .select('*')
```

## 測試標準

### 測試結構（AAA 模式）

```typescript
test('calculates similarity correctly', () => {
  // Arrange（準備）
  const vector1 = [1, 0, 0]
  const vector2 = [0, 1, 0]

  // Act（執行）
  const similarity = calculateCosineSimilarity(vector1, vector2)

  // Assert（斷言）
  expect(similarity).toBe(0)
})
```

### 測試命名

```typescript
// PASS: 良好：描述性測試名稱
test('returns empty array when no markets match query', () => { })
test('throws error when OpenAI API key is missing', () => { })
test('falls back to substring search when Redis unavailable', () => { })

// FAIL: 不良：模糊的測試名稱
test('works', () => { })
test('test search', () => { })
```

## 程式碼異味偵測

注意這些反模式：

### 1. 過長函式
```typescript
// FAIL: 不良：函式超過 50 行
function processMarketData() {
  // 100 行程式碼
}

// PASS: 良好：拆分為較小的函式
function processMarketData() {
  const validated = validateData()
  const transformed = transformData(validated)
  return saveData(transformed)
}
```

### 2. 過深巢狀
```typescript
// FAIL: 不良：5 層以上巢狀
if (user) {
  if (user.isAdmin) {
    if (market) {
      if (market.isActive) {
        if (hasPermission) {
          // 做某事
        }
      }
    }
  }
}

// PASS: 良好：提前返回
if (!user) return
if (!user.isAdmin) return
if (!market) return
if (!market.isActive) return
if (!hasPermission) return

// 做某事
```

### 3. 魔術數字
```typescript
// FAIL: 不良：無解釋的數字
if (retryCount > 3) { }
setTimeout(callback, 500)

// PASS: 良好：命名常數
const MAX_RETRIES = 3
const DEBOUNCE_DELAY_MS = 500

if (retryCount > MAX_RETRIES) { }
setTimeout(callback, DEBOUNCE_DELAY_MS)
```

**記住**：程式碼品質是不可協商的。清晰、可維護的程式碼能實現快速開發和自信的重構。
