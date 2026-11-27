---
name: iterative-retrieval
description: 서브에이전트 컨텍스트 문제를 해결하기 위한 점진적 컨텍스트 검색 개선 패턴
origin: ECC
---

# 반복적 검색 패턴

서브에이전트가 작업을 시작하기 전까지 필요한 컨텍스트를 알 수 없는 멀티 에이전트 워크플로우의 "컨텍스트 문제"를 해결합니다.

## 활성화 시점

- 사전에 예측할 수 없는 코드베이스 컨텍스트가 필요한 서브에이전트를 생성할 때
- 컨텍스트가 점진적으로 개선되는 멀티 에이전트 워크플로우를 구축할 때
- 에이전트 작업에서 "컨텍스트 초과" 또는 "컨텍스트 누락" 실패를 겪을 때
- 코드 탐색을 위한 RAG 유사 검색 파이프라인을 설계할 때
- 에이전트 오케스트레이션에서 토큰 사용량을 최적화할 때

## 문제

서브에이전트는 제한된 컨텍스트로 생성됩니다. 다음을 알 수 없습니다:
- 관련 코드가 포함된 파일
- 코드베이스에 존재하는 패턴
- 프로젝트에서 사용하는 용어

표준 접근법의 실패:
- **모든 것을 전송**: 컨텍스트 제한 초과
- **아무것도 전송하지 않음**: 에이전트가 중요한 정보를 갖지 못함
- **필요한 것을 추측**: 종종 잘못됨

## 해결책: 반복적 검색

컨텍스트를 점진적으로 개선하는 4단계 루프:

```
┌─────────────────────────────────────────────┐
│                                             │
│   ┌──────────┐      ┌──────────┐            │
│   │ DISPATCH │─────│ EVALUATE │            │
│   └──────────┘      └──────────┘            │
│        ▲                  │                 │
│        │                  ▼                 │
│   ┌──────────┐      ┌──────────┐            │
│   │   LOOP   │─────│  REFINE  │            │
│   └──────────┘      └──────────┘            │
│                                             │
│        Max 3 cycles, then proceed           │
└─────────────────────────────────────────────┘
```

### 1단계: DISPATCH

후보 파일을 수집하기 위한 초기 광범위 쿼리:

```javascript
// Start with high-level intent
const initialQuery = {
  patterns: ['src/**/*.ts', 'lib/**/*.ts'],
  keywords: ['authentication', 'user', 'session'],
  excludes: ['*.test.ts', '*.spec.ts']
};

// Dispatch to retrieval agent
const candidates = await retrieveFiles(initialQuery);
```

### 2단계: EVALUATE

검색된 콘텐츠의 관련성 평가:

```javascript
function evaluateRelevance(files, task) {
  return files.map(file => ({
    path: file.path,
    relevance: scoreRelevance(file.content, task),
    reason: explainRelevance(file.content, task),
    missingContext: identifyGaps(file.content, task)
  }));
}
```

점수 기준:
- **높음 (0.8-1.0)**: 대상 기능을 직접 구현
- **중간 (0.5-0.7)**: 관련 패턴이나 타입을 포함
- **낮음 (0.2-0.4)**: 간접적으로 관련
- **없음 (0-0.2)**: 관련 없음, 제외

### 3단계: REFINE

평가를 기반으로 검색 기준 업데이트:

```javascript
function refineQuery(evaluation, previousQuery) {
  return {
    // Add new patterns discovered in high-relevance files
    patterns: [...previousQuery.patterns, ...extractPatterns(evaluation)],

    // Add terminology found in codebase
    keywords: [...previousQuery.keywords, ...extractKeywords(evaluation)],

    // Exclude confirmed irrelevant paths
    excludes: [...previousQuery.excludes, ...evaluation
      .filter(e => e.relevance < 0.2)
      .map(e => e.path)
    ],

    // Target specific gaps
    focusAreas: evaluation
      .flatMap(e => e.missingContext)
      .filter(unique)
  };
}
```

### 4단계: LOOP

개선된 기준으로 반복 (최대 3회):

```javascript
async function iterativeRetrieve(task, maxCycles = 3) {
  let query = createInitialQuery(task);
  let bestContext = [];

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    const candidates = await retrieveFiles(query);
    const evaluation = evaluateRelevance(candidates, task);

    // Check if we have sufficient context
    const highRelevance = evaluation.filter(e => e.relevance >= 0.7);
    if (highRelevance.length >= 3 && !hasCriticalGaps(evaluation)) {
      return highRelevance;
    }

    // Refine and continue
    query = refineQuery(evaluation, query);
    bestContext = mergeContext(bestContext, highRelevance);
  }

  return bestContext;
}
```

## 실용적인 예시

### 예시 1: 버그 수정 컨텍스트

```
Task: "Fix the authentication token expiry bug"

Cycle 1:
  DISPATCH: Search for "token", "auth", "expiry" in src/**
  EVALUATE: Found auth.ts (0.9), tokens.ts (0.8), user.ts (0.3)
  REFINE: Add "refresh", "jwt" keywords; exclude user.ts

Cycle 2:
  DISPATCH: Search refined terms
  EVALUATE: Found session-manager.ts (0.95), jwt-utils.ts (0.85)
  REFINE: Sufficient context (2 high-relevance files)

Result: auth.ts, tokens.ts, session-manager.ts, jwt-utils.ts
```

### 예시 2: 기능 구현

```
Task: "Add rate limiting to API endpoints"

Cycle 1:
  DISPATCH: Search "rate", "limit", "api" in routes/**
  EVALUATE: No matches - codebase uses "throttle" terminology
  REFINE: Add "throttle", "middleware" keywords

Cycle 2:
  DISPATCH: Search refined terms
  EVALUATE: Found throttle.ts (0.9), middleware/index.ts (0.7)
  REFINE: Need router patterns

Cycle 3:
  DISPATCH: Search "router", "express" patterns
  EVALUATE: Found router-setup.ts (0.8)
  REFINE: Sufficient context

Result: throttle.ts, middleware/index.ts, router-setup.ts
```

## 에이전트와의 통합

에이전트 프롬프트에서 사용:

```markdown
When retrieving context for this task:
1. Start with broad keyword search
2. Evaluate each file's relevance (0-1 scale)
3. Identify what context is still missing
4. Refine search criteria and repeat (max 3 cycles)
5. Return files with relevance >= 0.7
```

## 모범 사례

1. **광범위하게 시작하여 점진적으로 좁히기** - 초기 쿼리를 과도하게 지정하지 않기
2. **코드베이스 용어 학습** - 첫 번째 사이클에서 주로 네이밍 컨벤션이 드러남
3. **누락된 것 추적** - 명시적 격차 식별이 개선을 주도
4. **"충분히 좋은" 수준에서 중단** - 관련성 높은 파일 3개가 보통 수준의 파일 10개보다 나음
5. **자신 있게 제외** - 관련성 낮은 파일은 관련성이 높아지지 않음

## 관련 항목

- [The Longform Guide](https://x.com/affaanmustafa/status/2014040193557471352) - 서브에이전트 오케스트레이션 섹션
- `continuous-learning` 스킬 - 시간이 지남에 따라 개선되는 패턴
- `~/.claude/agents/`의 에이전트 정의
