---
name: tdd-workflow
description: 새 기능 작성, 버그 수정 또는 코드 리팩터링 시 이 스킬을 사용하세요. 단위, 통합, E2E 테스트를 포함한 80% 이상의 커버리지로 테스트 주도 개발을 시행합니다.
origin: ECC
---

# 테스트 주도 개발 워크플로우

이 스킬은 모든 코드 개발이 포괄적인 테스트 커버리지와 함께 TDD 원칙을 따르도록 보장합니다.

## 활성화 시점

- 새 기능이나 기능성을 작성할 때
- 버그나 이슈를 수정할 때
- 기존 코드를 리팩터링할 때
- API 엔드포인트를 추가할 때
- 새 컴포넌트를 생성할 때

## 핵심 원칙

### 1. 코드보다 테스트가 먼저
항상 테스트를 먼저 작성한 후, 테스트를 통과시키는 코드를 구현합니다.

### 2. 커버리지 요구 사항
- 최소 80% 커버리지 (단위 + 통합 + E2E)
- 모든 엣지 케이스 커버
- 에러 시나리오 테스트
- 경계 조건 검증

### 3. 테스트 유형

#### 단위 테스트
- 개별 함수 및 유틸리티
- 컴포넌트 로직
- 순수 함수
- 헬퍼 및 유틸리티

#### 통합 테스트
- API 엔드포인트
- 데이터베이스 작업
- 서비스 상호작용
- 외부 API 호출

#### E2E 테스트 (Playwright)
- 핵심 사용자 플로우
- 완전한 워크플로우
- 브라우저 자동화
- UI 상호작용

## TDD 워크플로우 단계

### 단계 1: 사용자 여정 작성
```
As a [role], I want to [action], so that [benefit]

Example:
As a user, I want to search for markets semantically,
so that I can find relevant markets even without exact keywords.
```

### 단계 2: 테스트 케이스 생성
각 사용자 여정에 대해 포괄적인 테스트 케이스를 작성합니다:

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

### 단계 3: 테스트 실행 (실패해야 함)
```bash
npm test
# Tests should fail - we haven't implemented yet
```

### 단계 4: 코드 구현
테스트를 통과시키기 위한 최소한의 코드를 작성합니다:

```typescript
// Implementation guided by tests
export async function searchMarkets(query: string) {
  // Implementation here
}
```

### 단계 5: 테스트 재실행
```bash
npm test
# Tests should now pass
```

### 단계 6: 리팩터링
테스트가 통과하는 상태를 유지하면서 코드 품질을 개선합니다:
- 중복 제거
- 네이밍 개선
- 성능 최적화
- 가독성 향상

### 단계 7: 커버리지 확인
```bash
npm run test:coverage
# Verify 80%+ coverage achieved
```

## 테스트 패턴

### 단위 테스트 패턴 (Jest/Vitest)
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

### API 통합 테스트 패턴
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

### E2E 테스트 패턴 (Playwright)
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

  // Wait for stable search results instead of sleeping
  const results = page.locator('[data-testid="market-card"]')
  await expect(results.first()).toBeVisible({ timeout: 5000 })
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

## 테스트 파일 구성

```
src/
├── components/
│   ├── Button/
│   │   ├── Button.tsx
│   │   ├── Button.test.tsx          # Unit tests
│   │   └── Button.stories.tsx       # Storybook
│   └── MarketCard/
│       ├── MarketCard.tsx
│       └── MarketCard.test.tsx
├── app/
│   └── api/
│       └── markets/
│           ├── route.ts
│           └── route.test.ts         # Integration tests
└── e2e/
    ├── markets.spec.ts               # E2E tests
    ├── trading.spec.ts
    └── auth.spec.ts
```

## 외부 서비스 모킹

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
    new Array(1536).fill(0.1) // Mock 1536-dim embedding
  ))
}))
```

## 테스트 커버리지 검증

### 커버리지 리포트 실행
```bash
npm run test:coverage
```

### 커버리지 임계값
```json
{
  "jest": {
    "coverageThreshold": {
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

## 흔한 테스트 실수

### 잘못된 예: 구현 세부사항 테스트
```typescript
// Don't test internal state
expect(component.state.count).toBe(5)
```

### 올바른 예: 사용자에게 보이는 동작 테스트
```typescript
// Test what users see
expect(screen.getByText('Count: 5')).toBeInTheDocument()
```

### 잘못된 예: 취약한 셀렉터
```typescript
// Breaks easily
await page.click('.css-class-xyz')
```

### 올바른 예: 시맨틱 셀렉터
```typescript
// Resilient to changes
await page.click('button:has-text("Submit")')
await page.click('[data-testid="submit-button"]')
```

### 잘못된 예: 테스트 격리 없음
```typescript
// Tests depend on each other
test('creates user', () => { /* ... */ })
test('updates same user', () => { /* depends on previous test */ })
```

### 올바른 예: 독립적인 테스트
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

## 지속적 테스트

### 개발 중 Watch 모드
```bash
npm test -- --watch
# Tests run automatically on file changes
```

### Pre-Commit Hook
```bash
# Runs before every commit
npm test && npm run lint
```

### CI/CD 통합
```yaml
# GitHub Actions
- name: Run Tests
  run: npm test -- --coverage
- name: Upload Coverage
  uses: codecov/codecov-action@v3
```

## 모범 사례

1. **테스트 먼저 작성** - 항상 TDD
2. **테스트당 하나의 Assert** - 단일 동작에 집중
3. **설명적인 테스트 이름** - 무엇을 테스트하는지 설명
4. **Arrange-Act-Assert** - 명확한 테스트 구조
5. **외부 의존성 모킹** - 단위 테스트 격리
6. **엣지 케이스 테스트** - null, undefined, 빈 값, 큰 값
7. **에러 경로 테스트** - 정상 경로만이 아닌
8. **테스트 속도 유지** - 단위 테스트 각 50ms 미만
9. **테스트 후 정리** - 부작용 없음
10. **커버리지 리포트 검토** - 누락 부분 식별

## 성공 지표

- 80% 이상의 코드 커버리지 달성
- 모든 테스트 통과 (그린)
- 건너뛴 테스트나 비활성화된 테스트 없음
- 빠른 테스트 실행 (단위 테스트 30초 미만)
- E2E 테스트가 핵심 사용자 플로우를 커버
- 테스트가 프로덕션 이전에 버그를 포착

---

**기억하세요**: 테스트는 선택 사항이 아닙니다. 테스트는 자신감 있는 리팩터링, 빠른 개발, 그리고 프로덕션 안정성을 가능하게 하는 안전망입니다.
