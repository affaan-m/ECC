---
description: Playwright로 E2E 테스트를 생성하고 실행합니다. 테스트 여정을 만들고, 테스트를 실행하며, 스크린샷/비디오/트레이스를 캡처하고, 아티팩트를 업로드합니다.
---

# E2E 커맨드

이 커맨드는 **e2e-runner** 에이전트를 호출하여 Playwright를 사용한 E2E 테스트를 생성, 유지, 실행합니다.

## 이 커맨드가 하는 것

1. **테스트 여정 생성** - 사용자 흐름에 대한 Playwright 테스트 생성
2. **E2E 테스트 실행** - 여러 브라우저에서 테스트 실행
3. **아티팩트 캡처** - 실패 시 스크린샷, 비디오, 트레이스
4. **결과 업로드** - HTML 보고서 및 JUnit XML
5. **불안정한 테스트 식별** - 불안정한 테스트를 격리

## 사용 시점

`/e2e`를 사용해야 할 때:
- 핵심 사용자 여정 테스트 (로그인, 거래, 결제)
- 다단계 흐름이 E2E로 작동하는지 검증
- UI 인터랙션 및 네비게이션 테스트
- 프론트엔드와 백엔드 간 통합 검증
- 프로덕션 배포 준비

## 작동 방식

e2e-runner 에이전트가 수행하는 작업:

1. **사용자 흐름 분석** 및 테스트 시나리오 식별
2. Page Object Model 패턴을 사용한 **Playwright 테스트 생성**
3. 여러 브라우저(Chrome, Firefox, Safari)에서 **테스트 실행**
4. 스크린샷, 비디오, 트레이스로 **실패 캡처**
5. 결과와 아티팩트로 **보고서 생성**
6. **불안정한 테스트 식별** 및 수정 권장

## 사용 예시

````
User: /e2e 마켓 검색 및 조회 흐름 테스트

Agent (e2e-runner):
# E2E 테스트 생성: 마켓 검색 및 조회 흐름

## 식별된 테스트 시나리오

**사용자 여정:** 마켓 검색 → 결과 확인 → 마켓 클릭 → 상세 정보 확인

**테스트 범위:**
1. 마켓 페이지로 이동
2. 시맨틱 검색 수행
3. 검색 결과 확인
4. 첫 번째 결과 클릭
5. 마켓 상세 페이지 로드 확인
6. 차트 렌더링 확인

## 생성된 테스트 코드

```typescript
// tests/e2e/markets/search-and-view.spec.ts
import { test, expect } from '@playwright/test'
import { MarketsPage } from '../../pages/MarketsPage'
import { MarketDetailsPage } from '../../pages/MarketDetailsPage'

test.describe('Market Search and View Flow', () => {
  test('user can search markets and view details', async ({ page }) => {
    // 1. 마켓 페이지로 이동
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // 페이지 로드 확인
    await expect(page).toHaveTitle(/Markets/)
    await expect(page.locator('h1')).toContainText('Markets')

    // 2. 시맨틱 검색 수행
    await marketsPage.searchMarkets('election')

    // API 응답 대기
    await page.waitForResponse(resp =>
      resp.url().includes('/api/markets/search') && resp.status() === 200
    )

    // 3. 검색 결과 확인
    const marketCards = marketsPage.marketCards
    await expect(marketCards.first()).toBeVisible()
    const resultCount = await marketCards.count()
    expect(resultCount).toBeGreaterThan(0)

    // 검색 결과 스크린샷 촬영
    await page.screenshot({ path: 'artifacts/search-results.png' })

    // 4. 첫 번째 결과 클릭
    const firstMarketTitle = await marketCards.first().textContent()
    await marketCards.first().click()

    // 5. 마켓 상세 페이지 로드 확인
    await expect(page).toHaveURL(/\/markets\/[a-z0-9-]+/)

    const detailsPage = new MarketDetailsPage(page)
    await expect(detailsPage.marketName).toBeVisible()
    await expect(detailsPage.marketDescription).toBeVisible()

    // 6. 차트 렌더링 확인
    await expect(detailsPage.priceChart).toBeVisible()

    // 마켓 이름 일치 확인
    const detailsTitle = await detailsPage.marketName.textContent()
    expect(detailsTitle?.toLowerCase()).toContain(
      firstMarketTitle?.toLowerCase().substring(0, 20) || ''
    )

    // 마켓 상세 스크린샷 촬영
    await page.screenshot({ path: 'artifacts/market-details.png' })
  })

  test('search with no results shows empty state', async ({ page }) => {
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // 존재하지 않는 마켓 검색
    await marketsPage.searchMarkets('xyznonexistentmarket123456')

    // 빈 상태 확인
    await expect(page.locator('[data-testid="no-results"]')).toBeVisible()
    await expect(page.locator('[data-testid="no-results"]')).toContainText(
      /no.*results|no.*markets/i
    )

    const marketCount = await marketsPage.marketCards.count()
    expect(marketCount).toBe(0)
  })

  test('can clear search and see all markets again', async ({ page }) => {
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // 초기 마켓 수
    const initialCount = await marketsPage.marketCards.count()

    // 검색 수행
    await marketsPage.searchMarkets('trump')
    await page.waitForLoadState('networkidle')

    // 필터링된 결과 확인
    const filteredCount = await marketsPage.marketCards.count()
    expect(filteredCount).toBeLessThan(initialCount)

    // 검색 초기화
    await marketsPage.searchInput.clear()
    await page.waitForLoadState('networkidle')

    // 모든 마켓이 다시 표시되는지 확인
    const finalCount = await marketsPage.marketCards.count()
    expect(finalCount).toBe(initialCount)
  })
})
```

## 테스트 실행

```bash
# 생성된 테스트 실행
npx playwright test tests/e2e/markets/search-and-view.spec.ts

Running 3 tests using 3 workers

  ✓  [chromium] › search-and-view.spec.ts:5:3 › user can search markets and view details (4.2s)
  ✓  [chromium] › search-and-view.spec.ts:52:3 › search with no results shows empty state (1.8s)
  ✓  [chromium] › search-and-view.spec.ts:67:3 › can clear search and see all markets again (2.9s)

  3 passed (9.1s)

생성된 아티팩트:
- artifacts/search-results.png
- artifacts/market-details.png
- playwright-report/index.html
```

## 테스트 보고서

```
╔══════════════════════════════════════════════════════════════╗
║                    E2E 테스트 결과                            ║
╠══════════════════════════════════════════════════════════════╣
║ 상태:       PASS: 모든 테스트 통과                                ║
║ 전체:       3개 테스트                                        ║
║ 통과:       3 (100%)                                         ║
║ 실패:       0                                                ║
║ 불안정:     0                                                ║
║ 소요시간:   9.1s                                             ║
╚══════════════════════════════════════════════════════════════╝

아티팩트:
 스크린샷: 2개 파일
 비디오: 0개 파일 (실패 시에만)
 트레이스: 0개 파일 (실패 시에만)
 HTML 보고서: playwright-report/index.html

보고서 확인: npx playwright show-report
```

PASS: CI/CD 통합 준비가 완료된 E2E 테스트 모음!
````

## 테스트 아티팩트

테스트 실행 시 다음 아티팩트가 캡처됩니다:

**모든 테스트:**
- 타임라인과 결과가 포함된 HTML 보고서
- CI 통합을 위한 JUnit XML

**실패 시에만:**
- 실패 상태의 스크린샷
- 테스트의 비디오 녹화
- 디버깅을 위한 트레이스 파일 (단계별 재생)
- 네트워크 로그
- 콘솔 로그

## 아티팩트 확인

```bash
# 브라우저에서 HTML 보고서 확인
npx playwright show-report

# 특정 트레이스 파일 확인
npx playwright show-trace artifacts/trace-abc123.zip

# 스크린샷은 artifacts/ 디렉토리에 저장됨
open artifacts/search-results.png
```

## 불안정한 테스트 감지

테스트가 간헐적으로 실패하는 경우:

```
WARNING:  불안정한 테스트 감지됨: tests/e2e/markets/trade.spec.ts

테스트가 10회 중 7회 통과 (70% 통과율)

일반적인 실패 원인:
"요소 '[data-testid="confirm-btn"]'을 대기하는 중 타임아웃"

권장 수정 사항:
1. 명시적 대기 추가: await page.waitForSelector('[data-testid="confirm-btn"]')
2. 타임아웃 증가: { timeout: 10000 }
3. 컴포넌트의 레이스 컨디션 확인
4. 애니메이션에 의해 요소가 숨겨져 있지 않은지 확인

격리 권장: 수정될 때까지 test.fixme()로 표시
```

## 브라우저 구성

기본적으로 여러 브라우저에서 테스트가 실행됩니다:
- Chromium (데스크톱 Chrome)
- Firefox (데스크톱)
- WebKit (데스크톱 Safari)
- Mobile Chrome (선택 사항)

`playwright.config.ts`에서 브라우저를 조정할 수 있습니다.

## CI/CD 통합

CI 파이프라인에 추가:

```yaml
# .github/workflows/e2e.yml
- name: Install Playwright
  run: npx playwright install --with-deps

- name: Run E2E tests
  run: npx playwright test

- name: Upload artifacts
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: playwright-report/
```

## 모범 사례

**해야 할 것:**
- Page Object Model을 사용하여 유지보수성 향상
- data-testid 속성을 셀렉터로 사용
- 임의의 타임아웃 대신 API 응답을 대기
- 핵심 사용자 여정을 E2E로 테스트
- main에 merge하기 전에 테스트 실행
- 테스트 실패 시 아티팩트 검토

**하지 말아야 할 것:**
- 취약한 셀렉터 사용 (CSS 클래스는 변경될 수 있음)
- 구현 세부사항 테스트
- 프로덕션에 대해 테스트 실행
- 불안정한 테스트 무시
- 실패 시 아티팩트 검토 생략
- E2E로 모든 엣지 케이스 테스트 (단위 테스트 사용)

## 다른 커맨드와의 연동

- `/plan`을 사용하여 테스트할 핵심 여정 식별
- `/tdd`를 사용하여 단위 테스트 (더 빠르고 세밀함)
- `/e2e`를 사용하여 통합 및 사용자 여정 테스트
- `/code-review`를 사용하여 테스트 품질 검증

## 관련 에이전트

이 커맨드는 `e2e-runner` 에이전트를 호출합니다:
`~/.claude/agents/e2e-runner.md`

## 빠른 커맨드

```bash
# 모든 E2E 테스트 실행
npx playwright test

# 특정 테스트 파일 실행
npx playwright test tests/e2e/markets/search.spec.ts

# headed 모드로 실행 (브라우저 표시)
npx playwright test --headed

# 테스트 디버그
npx playwright test --debug

# 테스트 코드 생성
npx playwright codegen http://localhost:3000

# 보고서 확인
npx playwright show-report
```
