---
name: test-coverage
description: 테스트 커버리지를 분석하고, 80% 이상을 목표로 누락된 테스트를 식별하고 생성합니다.
---

# 테스트 커버리지

테스트 커버리지를 분석하고, 갭을 식별하며, 80% 이상 커버리지 달성을 위해 누락된 테스트를 생성합니다.

## 1단계: 테스트 프레임워크 감지

| 지표 | 커버리지 커맨드 |
|------|----------------|
| `jest.config.*` 또는 `package.json` jest | `npx jest --coverage --coverageReporters=json-summary` |
| `vitest.config.*` | `npx vitest run --coverage` |
| `pytest.ini` / `pyproject.toml` pytest | `pytest --cov=src --cov-report=json` |
| `Cargo.toml` | `cargo llvm-cov --json` |
| `pom.xml` with JaCoCo | `mvn test jacoco:report` |
| `go.mod` | `go test -coverprofile=coverage.out ./...` |

## 2단계: 커버리지 보고서 분석

1. 커버리지 커맨드 실행
2. 출력 파싱 (JSON 요약 또는 터미널 출력)
3. **80% 미만인 파일**을 최저순으로 정렬하여 목록화
4. 각 커버리지 미달 파일에 대해 다음을 식별:
   - 테스트되지 않은 함수 또는 메서드
   - 누락된 분기 커버리지 (if/else, switch, 에러 경로)
   - 분모를 부풀리는 데드 코드

## 3단계: 누락된 테스트 생성

각 커버리지 미달 파일에 대해 다음 우선순위에 따라 테스트를 생성합니다:

1. **Happy path** — 유효한 입력의 핵심 기능
2. **에러 처리** — 잘못된 입력, 누락된 데이터, 네트워크 실패
3. **엣지 케이스** — 빈 배열, null/undefined, 경계값 (0, -1, MAX_INT)
4. **분기 커버리지** — 각 if/else, switch case, 삼항 연산자

### 테스트 생성 규칙

- 소스 파일 옆에 테스트 배치: `foo.ts` → `foo.test.ts` (또는 프로젝트 컨벤션에 따름)
- 프로젝트의 기존 테스트 패턴 사용 (import 스타일, assertion 라이브러리, mocking 방식)
- 외부 의존성 mock 처리 (데이터베이스, API, 파일 시스템)
- 각 테스트는 독립적이어야 함 — 테스트 간 공유 가변 상태 없음
- 테스트 이름은 설명적으로: `test_create_user_with_duplicate_email_returns_409`

## 4단계: 검증

1. 전체 테스트 스위트 실행 — 모든 테스트가 통과해야 함
2. 커버리지 재실행 — 개선 확인
3. 여전히 80% 미만이면 나머지 갭에 대해 3단계 반복

## 5단계: 보고서

이전/이후 비교를 표시합니다:

```
커버리지 보고서
──────────────────────────────
파일                         이전    이후
src/services/auth.ts         45%     88%
src/utils/validation.ts      32%     82%
──────────────────────────────
전체:                        67%     84%  PASS:
```

## 집중 영역

- 복잡한 분기가 있는 함수 (높은 순환 복잡도)
- 에러 핸들러와 catch 블록
- 코드베이스 전반에서 사용되는 유틸리티 함수
- API 엔드포인트 핸들러 (요청 → 응답 흐름)
- 엣지 케이스: null, undefined, 빈 문자열, 빈 배열, 0, 음수
