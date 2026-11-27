---
name: tdd-workflow
description: 在编写新功能、修复错误或重构代码时使用此技能。强制执行测试驱动开发，确保单元测试、集成测试和端到端测试的覆盖率超过80%。
origin: ECC
---

# 测试驱动开发工作流

此技能确保所有代码开发遵循TDD原则，并具备全面的测试覆盖率。

## 何时激活

* 编写新功能或功能
* 修复错误或问题
* 重构现有代码
* 添加API端点
* 创建新组件

## 核心原则

### 1. 测试优先于代码

始终先编写测试，然后实现代码以使测试通过。

### 2. 覆盖率要求

* 最低80%覆盖率（单元 + 集成 + 端到端）
* 覆盖所有边缘情况
* 测试错误场景
* 验证边界条件

### 3. 测试类型

#### 单元测试

* 单个函数和工具
* 组件逻辑
* 纯函数
* 辅助函数和工具

#### 集成测试

* API端点
* 数据库操作
* 服务交互
* 外部API调用

#### 端到端测试 (Playwright)

* 关键用户流程
* 完整工作流
* 浏览器自动化
* UI交互

## TDD 工作流步骤

### 步骤 1: 编写用户旅程

```
作为一个[角色]，我希望能够[行动]，以便[获得收益]

示例：
作为一个用户，我希望能够进行语义搜索市场，
这样即使没有精确的关键词，我也能找到相关的市场。
```

### 步骤 2: 生成测试用例

针对每个用户旅程，创建全面的测试用例：

```typescript
describe('Semantic Search', () => {
  it('returns relevant markets for query', async () => {
    // Test implementation
  })

  it('handles empty query gracefully', async () => {
    // Test edge case
  })

  it('falls back to substring search when Redis unavailable', async () => {
    // Test fallback behavior
  })

  it('sorts results by similarity score', async () => {
    // Test sorting logic
  })
})
```

### 步骤 3: 运行测试（它们应该失败）

```bash
npm test
# Tests should fail - we haven't implemented yet
```

### 步骤 4: 实现代码

编写最少的代码以使测试通过：

```typescript
// Implementation guided by tests
export async function searchMarkets(query: string) {
  // Implementation here
}
```

### 步骤 5: 再次运行测试

```bash
npm test
# Tests should now pass
```

### 步骤 6: 重构

在保持测试通过的同时提高代码质量：

* 消除重复
* 改进命名
* 优化性能
* 增强可读性

### 步骤 7: 验证覆盖率

```bash
npm run test:coverage
# Verify 80%+ coverage achieved
```

## 测试模式

### 单元测试模式 (Jest/Vitest)

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

### API 集成测试模式

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
    // Mock database failure
    const request = new NextRequest('http://localhost/api/markets')
    // Test error handling
  })
})
```

### 端到端测试模式 (Playwright)

```typescript
import { test, expect } from '@playwright/test'

test('user can search and filter markets', async ({ page }) => {
  // Navigate to markets page
  await page.goto('/')
  await page.click('a[href="/markets"]')

  // Verify page loaded
  await expect(page.locator('h1')).toContainText('Markets')

  // Search for markets
  await page.fill('input[placeholder="Search markets"]', 'election')

  // Wait for debounce and results
  await page.waitForTimeout(600)

  // Verify search results displayed
  const results = page.locator('[data-testid="market-card"]')
  await expect(results).toHaveCount(5, { timeout: 5000 })

  // Verify results contain search term
  const firstResult = results.first()
  await expect(firstResult).toContainText('election', { ignoreCase: true })

  // Filter by status
  await page.click('button:has-text("Active")')

  // Verify filtered results
  await expect(results).toHaveCount(3)
})

test('user can create a new market', async ({ page }) => {
  // Login first
  await page.goto('/creator-dashboard')

  // Fill market creation form
  await page.fill('input[name="name"]', 'Test Market')
  await page.fill('textarea[name="description"]', 'Test description')
  await page.fill('input[name="endDate"]', '2025-12-31')

  // Submit form
  await page.click('button[type="submit"]')

  // Verify success message
  await expect(page.locator('text=Market created successfully')).toBeVisible()

  // Verify redirect to market page
  await expect(page).toHaveURL(/\/markets\/test-market/)
})
```

## 测试文件组织

```
src/
├── components/
│   ├── Button/
│   │   ├── Button.tsx
│   │   ├── Button.test.tsx          # 单元测试
│   │   └── Button.stories.tsx       # Storybook
│   └── MarketCard/
│       ├── MarketCard.tsx
│       └── MarketCard.test.tsx
├── app/
│   └── api/
│       └── markets/
│           ├── route.ts
│           └── route.test.ts         # 集成测试
└── e2e/
    ├── markets.spec.ts               # 端到端测试
    ├── trading.spec.ts
    └── auth.spec.ts
```

## 模拟外部服务

### Supabase 模拟

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

### Redis 模拟

```typescript
jest.mock('@/lib/redis', () => ({
  searchMarketsByVector: jest.fn(() => Promise.resolve([
    { slug: 'test-market', similarity_score: 0.95 }
  ])),
  checkRedisHealth: jest.fn(() => Promise.resolve({ connected: true }))
}))
```

### OpenAI 模拟

```typescript
jest.mock('@/lib/openai', () => ({
  generateEmbedding: jest.fn(() => Promise.resolve(
    new Array(1536).fill(0.1) // Mock 1536-dim embedding
  ))
}))
```

## 测试覆盖率验证

### 运行覆盖率报告

```bash
npm run test:coverage
```

### 覆盖率阈值

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

## 应避免的常见测试错误

### FAIL: 错误：测试实现细节

```typescript
// Don't test internal state
expect(component.state.count).toBe(5)
```

### PASS: 正确：测试用户可见的行为

```typescript
// Test what users see
expect(screen.getByText('Count: 5')).toBeInTheDocument()
```

### FAIL: 错误：脆弱的定位器

```typescript
// Breaks easily
await page.click('.css-class-xyz')
```

### PASS: 正确：语义化定位器

```typescript
// Resilient to changes
await page.click('button:has-text("Submit")')
await page.click('[data-testid="submit-button"]')
```

### FAIL: 错误：没有测试隔离

```typescript
// Tests depend on each other
test('creates user', () => { /* ... */ })
test('updates same user', () => { /* depends on previous test */ })
```

### PASS: 正确：独立的测试

```typescript
// Each test sets up its own data
test('creates user', () => {
  const user = createTestUser()
  // Test logic
})

test('updates user', () => {
  const user = createTestUser()
  // Update logic
})
```

## 持续测试

### 开发期间的监视模式

```bash
npm test -- --watch
# Tests run automatically on file changes
```

### 预提交钩子

```bash
# Runs before every commit
npm test && npm run lint
```

### CI/CD 集成

```yaml
# GitHub Actions
- name: Run Tests
  run: npm test -- --coverage
- name: Upload Coverage
  uses: codecov/codecov-action@v3
```

## 最佳实践

1. **先写测试** - 始终遵循TDD
2. **每个测试一个断言** - 专注于单一行为
3. **描述性的测试名称** - 解释测试内容
4. **组织-执行-断言** - 清晰的测试结构
5. **模拟外部依赖** - 隔离单元测试
6. **测试边缘情况** - Null、undefined、空、大量数据
7. **测试错误路径** - 不仅仅是正常路径
8. **保持测试快速** - 单元测试每个 < 50ms
9. **测试后清理** - 无副作用
10. **审查覆盖率报告** - 识别空白

## 成功指标

* 达到 80%+ 代码覆盖率
* 所有测试通过（绿色）
* 没有跳过或禁用的测试
* 快速测试执行（单元测试 < 30秒）
* 端到端测试覆盖关键用户流程
* 测试在生产前捕获错误

***

**记住**：测试不是可选的。它们是安全网，能够实现自信的重构、快速的开发和生产的可靠性。
