---
name: tdd-workflow
description: Use this skill when writing new features, fixing bugs, or refactoring code. Enforces test-driven development with 80%+ coverage including unit, integration, and E2E tests.
---

# 測試驅動開發工作流程

此技能確保所有程式碼開發遵循 TDD 原則，並具有完整的測試覆蓋率。

## 何時啟用

- 撰寫新功能或功能性程式碼
- 修復 Bug 或問題
- 重構現有程式碼
- 新增 API 端點
- 建立新元件

## 核心原則

### 1. 測試先於程式碼
總是先寫測試，然後實作程式碼使測試通過。

### 2. 覆蓋率要求
- 最低 80% 覆蓋率（單元 + 整合 + E2E）
- 涵蓋所有邊界案例
- 測試錯誤情境
- 驗證邊界條件

### 3. 測試類型

#### 單元測試
- 個別函式和工具
- 元件邏輯
- 純函式
- 輔助函式和工具

#### 整合測試
- API 端點
- 資料庫操作
- 服務互動
- 外部 API 呼叫

#### E2E 測試（Playwright）
- 關鍵使用者流程
- 完整工作流程
- 瀏覽器自動化
- UI 互動

## TDD 工作流程步驟

### 步驟 1：撰寫使用者旅程
```
身為 [角色]，我想要 [動作]，以便 [好處]

範例：
身為使用者，我想要語意搜尋市場，
以便即使沒有精確關鍵字也能找到相關市場。
```

### 步驟 2：產生測試案例
為每個使用者旅程建立完整的測試案例：

```typescript
describe('Semantic Search', () => {
  it('returns relevant markets for query', async () => {
    // 測試實作
  })

  it('handles empty query gracefully', async () => {
    // 測試邊界案例
  })

  it('falls back to substring search when Redis unavailable', async () => {
    // 測試回退行為
  })

  it('sorts results by similarity score', async () => {
    // 測試排序邏輯
  })
})
```

### 步驟 3：執行測試（應該失敗）
```bash
npm test
# 測試應該失敗 - 我們還沒實作
```

### 步驟 4：實作程式碼
撰寫最少的程式碼使測試通過：

```typescript
// 由測試引導的實作
export async function searchMarkets(query: string) {
  // 實作在此
}
```

### 步驟 5：再次執行測試
```bash
npm test
# 測試現在應該通過
```

### 步驟 6：重構
在保持測試通過的同時改善程式碼品質：
- 移除重複
- 改善命名
- 優化效能
- 增強可讀性

### 步驟 7：驗證覆蓋率
```bash
npm run test:coverage
# 驗證達到 80%+ 覆蓋率
```

## 測試模式

### 單元測試模式（Jest/Vitest）
```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from './Button'

describe('Button Component', () => {
  it('renders with correct text', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const handleClick = jest.fn()
    render(<Button onClick={handleClick}>Click</Button>)

    fireEvent.click(screen.getByRole('button'))

    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Click</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
```

### API 整合測試模式
```typescript
import { NextRequest } from 'next/server'
import { GET } from './route'

describe('GET /api/markets', () => {
  it('returns markets successfully', async () => {
    const request = new NextRequest('http://localhost/api/markets')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(Array.isArray(data.data)).toBe(true)
  })

  it('validates query parameters', async () => {
    const request = new NextRequest('http://localhost/api/markets?limit=invalid')
    const response = await GET(request)

    expect(response.status).toBe(400)
  })

  it('handles database errors gracefully', async () => {
    // Mock 資料庫失敗
    const request = new NextRequest('http://localhost/api/markets')
    // 測試錯誤處理
  })
})
```

### E2E 測試模式（Playwright）
```typescript
import { test, expect } from '@playwright/test'

test('user can search and filter markets', async ({ page }) => {
  // 導航到市場頁面
  await page.goto('/')
  await page.click('a[href="/markets"]')

  // 驗證頁面載入
  await expect(page.locator('h1')).toContainText('Markets')

  // 搜尋市場
  await page.fill('input[placeholder="Search markets"]', 'election')

  // 等待 debounce 和結果
  await page.waitForTimeout(600)

  // 驗證搜尋結果顯示
  const results = page.locator('[data-testid="market-card"]')
  await expect(results).toHaveCount(5, { timeout: 5000 })

  // 驗證結果包含搜尋詞
  const firstResult = results.first()
  await expect(firstResult).toContainText('election', { ignoreCase: true })

  // 依狀態篩選
  await page.click('button:has-text("Active")')

  // 驗證篩選結果
  await expect(results).toHaveCount(3)
})

test('user can create a new market', async ({ page }) => {
  // 先登入
  await page.goto('/creator-dashboard')

  // 填寫市場建立表單
  await page.fill('input[name="name"]', 'Test Market')
  await page.fill('textarea[name="description"]', 'Test description')
  await page.fill('input[name="endDate"]', '2025-12-31')

  // 提交表單
  await page.click('button[type="submit"]')

  // 驗證成功訊息
  await expect(page.locator('text=Market created successfully')).toBeVisible()

  // 驗證重導向到市場頁面
  await expect(page).toHaveURL(/\/markets\/test-market/)
})
```

## 測試檔案組織

```
src/
├── components/
│   ├── Button/
│   │   ├── Button.tsx
│   │   ├── Button.test.tsx          # 單元測試
│   │   └── Button.stories.tsx       # Storybook
│   └── MarketCard/
│       ├── MarketCard.tsx
│       └── MarketCard.test.tsx
├── app/
│   └── api/
│       └── markets/
│           ├── route.ts
│           └── route.test.ts         # 整合測試
└── e2e/
    ├── markets.spec.ts               # E2E 測試
    ├── trading.spec.ts
    └── auth.spec.ts
```

## Mock 外部服務

### Supabase Mock
```typescript
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({
          data: [{ id: 1, name: 'Test Market' }],
          error: null
        }))
      }))
    }))
  }
}))
```

### Redis Mock
```typescript
jest.mock('@/lib/redis', () => ({
  searchMarketsByVector: jest.fn(() => Promise.resolve([
    { slug: 'test-market', similarity_score: 0.95 }
  ])),
  checkRedisHealth: jest.fn(() => Promise.resolve({ connected: true }))
}))
```

### OpenAI Mock
```typescript
jest.mock('@/lib/openai', () => ({
  generateEmbedding: jest.fn(() => Promise.resolve(
    new Array(1536).fill(0.1) // Mock 1536 維嵌入向量
  ))
}))
```

## 測試覆蓋率驗證

### 執行覆蓋率報告
```bash
npm run test:coverage
```

### 覆蓋率門檻
```json
{
  "jest": {
    "coverageThresholds": {
      "global": {
        "branches": 80,
        "functions": 80,
        "lines": 80,
        "statements": 80
      }
    }
  }
}
```

## 常見測試錯誤避免

### FAIL: 錯誤：測試實作細節
```typescript
// 不要測試內部狀態
expect(component.state.count).toBe(5)
```

### PASS: 正確：測試使用者可見行為
```typescript
// 測試使用者看到的內容
expect(screen.getByText('Count: 5')).toBeInTheDocument()
```

### FAIL: 錯誤：脆弱的選擇器
```typescript
// 容易壞掉
await page.click('.css-class-xyz')
```

### PASS: 正確：語意選擇器
```typescript
// 對變更有彈性
await page.click('button:has-text("Submit")')
await page.click('[data-testid="submit-button"]')
```

### FAIL: 錯誤：無測試隔離
```typescript
// 測試互相依賴
test('creates user', () => { /* ... */ })
test('updates same user', () => { /* 依賴前一個測試 */ })
```

### PASS: 正確：獨立測試
```typescript
// 每個測試設置自己的資料
test('creates user', () => {
  const user = createTestUser()
  // 測試邏輯
})

test('updates user', () => {
  const user = createTestUser()
  // 更新邏輯
})
```

## 持續測試

### 開發期間的 Watch 模式
```bash
npm test -- --watch
# 檔案變更時自動執行測試
```

### Pre-Commit Hook
```bash
# 每次 commit 前執行
npm test && npm run lint
```

### CI/CD 整合
```yaml
# GitHub Actions
- name: Run Tests
  run: npm test -- --coverage
- name: Upload Coverage
  uses: codecov/codecov-action@v3
```

## 最佳實務

1. **先寫測試** - 總是 TDD
2. **一個測試一個斷言** - 專注單一行為
3. **描述性測試名稱** - 解釋測試內容
4. **Arrange-Act-Assert** - 清晰的測試結構
5. **Mock 外部依賴** - 隔離單元測試
6. **測試邊界案例** - Null、undefined、空值、大值
7. **測試錯誤路徑** - 不只是快樂路徑
8. **保持測試快速** - 單元測試每個 < 50ms
9. **測試後清理** - 無副作用
10. **檢視覆蓋率報告** - 識別缺口

## 成功指標

- 達到 80%+ 程式碼覆蓋率
- 所有測試通過（綠色）
- 無跳過或停用的測試
- 快速測試執行（單元測試 < 30s）
- E2E 測試涵蓋關鍵使用者流程
- 測試在生產前捕捉 Bug

---

**記住**：測試不是可選的。它們是實現自信重構、快速開發和生產可靠性的安全網。
