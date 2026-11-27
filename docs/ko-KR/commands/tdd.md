---
description: 테스트 주도 개발 워크플로우 강제. 인터페이스를 스캐폴딩하고, 테스트를 먼저 생성한 후 통과할 최소한의 코드를 구현합니다. 80% 이상 커버리지를 보장합니다.
---

# TDD 커맨드

이 커맨드는 **tdd-guide** 에이전트를 호출하여 테스트 주도 개발 방법론을 강제합니다.

## 이 커맨드가 하는 것

1. **인터페이스 스캐폴딩** - 타입/인터페이스를 먼저 정의
2. **테스트 먼저 생성** - 실패하는 테스트 작성 (RED)
3. **최소한의 코드 구현** - 통과하기에 충분한 코드만 작성 (GREEN)
4. **리팩토링** - 테스트를 통과시키면서 코드 개선 (REFACTOR)
5. **커버리지 확인** - 80% 이상 테스트 커버리지 보장

## 사용 시점

`/tdd`를 사용해야 할 때:
- 새 기능 구현
- 새 함수/컴포넌트 추가
- 버그 수정 (버그를 재현하는 테스트를 먼저 작성)
- 기존 코드 리팩토링
- 핵심 비즈니스 로직 구현

## 작동 방식

tdd-guide 에이전트가 수행하는 작업:

1. 입출력에 대한 **인터페이스 정의**
2. (코드가 아직 존재하지 않으므로) **실패하는 테스트 작성**
3. 올바른 이유로 실패하는지 **테스트 실행** 및 확인
4. 테스트를 통과하도록 **최소한의 구현 작성**
5. 통과하는지 **테스트 실행** 및 확인
6. 테스트를 통과시키면서 코드 **리팩토링**
7. **커버리지 확인** 및 80% 미만이면 테스트 추가

## TDD 사이클

```
RED → GREEN → REFACTOR → REPEAT

RED:      실패하는 테스트 작성
GREEN:    통과할 최소한의 코드 작성
REFACTOR: 코드 개선, 테스트 계속 통과 유지
REPEAT:   다음 기능/시나리오
```

## 사용 예시

````
User: /tdd 마켓 유동성 점수를 계산하는 함수가 필요합니다

Agent (tdd-guide):
# TDD 세션: 마켓 유동성 점수 계산기

## 1단계: 인터페이스 정의 (SCAFFOLD)

```typescript
// lib/liquidity.ts
export interface MarketData {
  totalVolume: number
  bidAskSpread: number
  activeTraders: number
  lastTradeTime: Date
}

export function calculateLiquidityScore(market: MarketData): number {
  // TODO: 구현
  throw new Error('Not implemented')
}
```

## 2단계: 실패하는 테스트 작성 (RED)

```typescript
// lib/liquidity.test.ts
import { calculateLiquidityScore } from './liquidity'

describe('calculateLiquidityScore', () => {
  it('should return high score for liquid market', () => {
    const market = {
      totalVolume: 100000,
      bidAskSpread: 0.01,
      activeTraders: 500,
      lastTradeTime: new Date()
    }

    const score = calculateLiquidityScore(market)

    expect(score).toBeGreaterThan(80)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('should return low score for illiquid market', () => {
    const market = {
      totalVolume: 100,
      bidAskSpread: 0.5,
      activeTraders: 2,
      lastTradeTime: new Date(Date.now() - 86400000) // 1일 전
    }

    const score = calculateLiquidityScore(market)

    expect(score).toBeLessThan(30)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  it('should handle edge case: zero volume', () => {
    const market = {
      totalVolume: 0,
      bidAskSpread: 0,
      activeTraders: 0,
      lastTradeTime: new Date()
    }

    const score = calculateLiquidityScore(market)

    expect(score).toBe(0)
  })
})
```

## 3단계: 테스트 실행 - 실패 확인

```bash
npm test lib/liquidity.test.ts

FAIL lib/liquidity.test.ts
  ✕ should return high score for liquid market (2 ms)
    Error: Not implemented

1 test failed, 0 passed
```

PASS: 예상대로 테스트 실패. 구현 준비 완료.

## 4단계: 최소한의 코드 구현 (GREEN)

```typescript
// lib/liquidity.ts
export function calculateLiquidityScore(market: MarketData): number {
  // 거래량 0인 엣지 케이스 처리
  if (market.totalVolume === 0) {
    return 0
  }

  // 구성 요소별 점수 계산 (0-100 스케일)
  const volumeScore = Math.min(market.totalVolume / 1000, 100)
  const spreadScore = Math.max(100 - (market.bidAskSpread * 1000), 0)
  const traderScore = Math.min(market.activeTraders / 10, 100)

  // 최근 활동 보너스
  const hoursSinceLastTrade = (Date.now() - market.lastTradeTime.getTime()) / (1000 * 60 * 60)
  const recencyScore = Math.max(100 - (hoursSinceLastTrade * 10), 0)

  // 가중 평균
  const score = (
    volumeScore * 0.4 +
    spreadScore * 0.3 +
    traderScore * 0.2 +
    recencyScore * 0.1
  )

  return Math.min(Math.max(score, 0), 100) // 0-100으로 클램핑
}
```

## 5단계: 테스트 실행 - 통과 확인

```bash
npm test lib/liquidity.test.ts

PASS lib/liquidity.test.ts
  ✓ should return high score for liquid market (3 ms)
  ✓ should return low score for illiquid market (2 ms)
  ✓ should handle edge case: zero volume (1 ms)

3 tests passed
```

PASS: 모든 테스트 통과!

## 6단계: 리팩토링 (IMPROVE)

```typescript
// lib/liquidity.ts - 상수와 가독성 향상을 위한 리팩토링
const WEIGHTS = {
  VOLUME: 0.4,
  SPREAD: 0.3,
  TRADERS: 0.2,
  RECENCY: 0.1,
} as const

const SCALE_FACTORS = {
  VOLUME: 1000,
  SPREAD: 1000,
  TRADERS: 10,
  RECENCY_PENALTY: 10,
} as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function calculateLiquidityScore(market: MarketData): number {
  if (market.totalVolume === 0) return 0

  const volumeScore = Math.min(market.totalVolume / SCALE_FACTORS.VOLUME, 100)
  const spreadScore = clamp(100 - (market.bidAskSpread * SCALE_FACTORS.SPREAD), 0, 100)
  const traderScore = Math.min(market.activeTraders / SCALE_FACTORS.TRADERS, 100)

  const hoursSinceLastTrade = (Date.now() - market.lastTradeTime.getTime()) / (1000 * 60 * 60)
  const recencyScore = clamp(100 - (hoursSinceLastTrade * SCALE_FACTORS.RECENCY_PENALTY), 0, 100)

  const weightedScore =
    volumeScore * WEIGHTS.VOLUME +
    spreadScore * WEIGHTS.SPREAD +
    traderScore * WEIGHTS.TRADERS +
    recencyScore * WEIGHTS.RECENCY

  return clamp(weightedScore, 0, 100)
}
```

## 7단계: 테스트가 여전히 통과하는지 확인

```bash
npm test lib/liquidity.test.ts

PASS lib/liquidity.test.ts
  ✓ should return high score for liquid market (3 ms)
  ✓ should return low score for illiquid market (2 ms)
  ✓ should handle edge case: zero volume (1 ms)

3 tests passed
```

PASS: 리팩토링 완료, 테스트 여전히 통과!

## 8단계: 커버리지 확인

```bash
npm test -- --coverage lib/liquidity.test.ts

File           | % Stmts | % Branch | % Funcs | % Lines
---------------|---------|----------|---------|--------
liquidity.ts   |   100   |   100    |   100   |   100

Coverage: 100% PASS: (목표: 80%)
```

PASS: TDD 세션 완료!
````

## TDD 모범 사례

**해야 할 것:**
- 구현 전에 테스트를 먼저 작성
- 구현 전에 테스트를 실행하여 실패하는지 확인
- 테스트를 통과하기 위한 최소한의 코드 작성
- 테스트가 통과한 후에만 리팩토링
- 엣지 케이스와 에러 시나리오 추가
- 80% 이상 커버리지 목표 (핵심 코드는 100%)

**하지 말아야 할 것:**
- 테스트 전에 구현 작성
- 각 변경 후 테스트 실행 건너뛰기
- 한 번에 너무 많은 코드 작성
- 실패하는 테스트 무시
- 구현 세부사항 테스트 (동작을 테스트)
- 모든 것을 mock (통합 테스트 선호)

## 포함할 테스트 유형

**단위 테스트** (함수 수준):
- 정상 경로 시나리오
- 엣지 케이스 (빈 값, null, 최대값)
- 에러 조건
- 경계값

**통합 테스트** (컴포넌트 수준):
- API 엔드포인트
- 데이터베이스 작업
- 외부 서비스 호출
- hooks가 포함된 React 컴포넌트

**E2E 테스트** (`/e2e` 커맨드 사용):
- 핵심 사용자 흐름
- 다단계 프로세스
- 풀 스택 통합

## 커버리지 요구사항

- **80% 최소** - 모든 코드에 대해
- **100% 필수** - 다음 항목에 대해:
  - 금융 계산
  - 인증 로직
  - 보안에 중요한 코드
  - 핵심 비즈니스 로직

## 중요 사항

**필수**: 테스트는 반드시 구현 전에 작성해야 합니다. TDD 사이클은 다음과 같습니다:

1. **RED** - 실패하는 테스트 작성
2. **GREEN** - 통과하도록 구현
3. **REFACTOR** - 코드 개선

절대 RED 단계를 건너뛰지 마세요. 절대 테스트 전에 코드를 작성하지 마세요.

## 다른 커맨드와의 연동

- `/plan`을 먼저 사용하여 무엇을 만들지 이해
- `/tdd`를 사용하여 테스트와 함께 구현
- `/build-fix`를 사용하여 빌드 에러 발생 시 수정
- `/code-review`를 사용하여 구현 리뷰
- `/test-coverage`를 사용하여 커버리지 검증

## 관련 에이전트

이 커맨드는 `tdd-guide` 에이전트를 호출합니다:
`~/.claude/agents/tdd-guide.md`

그리고 `tdd-workflow` 스킬을 참조할 수 있습니다:
`~/.claude/skills/tdd-workflow/`
