---
name: eval-harness
description: 평가 주도 개발(EDD) 원칙을 구현하는 Claude Code 세션용 공식 평가 프레임워크
origin: ECC
tools: Read, Write, Edit, Bash, Grep, Glob
---

# 평가 하네스 스킬

Claude Code 세션을 위한 공식 평가 프레임워크로, 평가 주도 개발(EDD) 원칙을 구현합니다.

## 활성화 시점

- AI 지원 워크플로우에 평가 주도 개발(EDD) 설정 시
- Claude Code 작업 완료에 대한 합격/불합격 기준 정의 시
- pass@k 메트릭으로 에이전트 신뢰성 측정 시
- 프롬프트 또는 에이전트 변경에 대한 회귀 테스트 스위트 생성 시
- 모델 버전 간 에이전트 성능 벤치마킹 시

## 철학

평가 주도 개발은 평가를 "AI 개발의 단위 테스트"로 취급합니다:
- 구현 전에 예상 동작 정의
- 개발 중 지속적으로 평가 실행
- 각 변경 시 회귀 추적
- 신뢰성 측정을 위해 pass@k 메트릭 사용

## 평가 유형

### 기능 평가
Claude가 이전에 할 수 없었던 것을 할 수 있는지 테스트:
```markdown
[CAPABILITY EVAL: feature-name]
Task: Description of what Claude should accomplish
Success Criteria:
  - [ ] Criterion 1
  - [ ] Criterion 2
  - [ ] Criterion 3
Expected Output: Description of expected result
```

### 회귀 평가
변경 사항이 기존 기능을 손상시키지 않는지 확인:
```markdown
[REGRESSION EVAL: feature-name]
Baseline: SHA or checkpoint name
Tests:
  - existing-test-1: PASS/FAIL
  - existing-test-2: PASS/FAIL
  - existing-test-3: PASS/FAIL
Result: X/Y passed (previously Y/Y)
```

## 채점자 유형

### 1. 코드 기반 채점자
코드를 사용한 결정론적 검사:
```bash
# Check if file contains expected pattern
grep -q "export function handleAuth" src/auth.ts && echo "PASS" || echo "FAIL"

# Check if tests pass
npm test -- --testPathPattern="auth" && echo "PASS" || echo "FAIL"

# Check if build succeeds
npm run build && echo "PASS" || echo "FAIL"
```

### 2. 모델 기반 채점자
Claude를 사용하여 개방형 출력 평가:
```markdown
[MODEL GRADER PROMPT]
Evaluate the following code change:
1. Does it solve the stated problem?
2. Is it well-structured?
3. Are edge cases handled?
4. Is error handling appropriate?

Score: 1-5 (1=poor, 5=excellent)
Reasoning: [explanation]
```

### 3. 사람 채점자
수동 검토 플래그:
```markdown
[HUMAN REVIEW REQUIRED]
Change: Description of what changed
Reason: Why human review is needed
Risk Level: LOW/MEDIUM/HIGH
```

## 메트릭

### pass@k
"k번 시도 중 최소 한 번 성공"
- pass@1: 첫 번째 시도 성공률
- pass@3: 3번 시도 내 성공
- 일반적인 목표: pass@3 > 90%

### pass^k
"k번 시행 모두 성공"
- 신뢰성에 대한 더 높은 기준
- pass^3: 3회 연속 성공
- 핵심 경로에 사용

## 평가 워크플로우

### 1. 정의 (코딩 전)
```markdown
## EVAL DEFINITION: feature-xyz

### Capability Evals
1. Can create new user account
2. Can validate email format
3. Can hash password securely

### Regression Evals
1. Existing login still works
2. Session management unchanged
3. Logout flow intact

### Success Metrics
- pass@3 > 90% for capability evals
- pass^3 = 100% for regression evals
```

### 2. 구현
정의된 평가를 통과하기 위한 코드 작성.

### 3. 평가
```bash
# Run capability evals
[Run each capability eval, record PASS/FAIL]

# Run regression evals
npm test -- --testPathPattern="existing"

# Generate report
```

### 4. 보고서
```markdown
EVAL REPORT: feature-xyz
========================

Capability Evals:
  create-user:     PASS (pass@1)
  validate-email:  PASS (pass@2)
  hash-password:   PASS (pass@1)
  Overall:         3/3 passed

Regression Evals:
  login-flow:      PASS
  session-mgmt:    PASS
  logout-flow:     PASS
  Overall:         3/3 passed

Metrics:
  pass@1: 67% (2/3)
  pass@3: 100% (3/3)

Status: READY FOR REVIEW
```

## 통합 패턴

### 구현 전
```
/eval define feature-name
```
`.claude/evals/feature-name.md`에 평가 정의 파일 생성

### 구현 중
```
/eval check feature-name
```
현재 평가를 실행하고 상태 보고

### 구현 후
```
/eval report feature-name
```
전체 평가 보고서 생성

## 평가 저장소

프로젝트에 평가 저장:
```
.claude/
  evals/
    feature-xyz.md      # 평가 정의
    feature-xyz.log     # 평가 실행 이력
    baseline.json       # 회귀 베이스라인
```

## 모범 사례

1. **코딩 전에 평가 정의** - 성공 기준에 대한 명확한 사고를 강제
2. **자주 평가 실행** - 회귀를 조기에 포착
3. **시간에 따른 pass@k 추적** - 신뢰성 추세 모니터링
4. **가능하면 코드 채점자 사용** - 결정론적 > 확률적
5. **보안에는 사람 검토** - 보안 검사를 완전히 자동화하지 말 것
6. **평가를 빠르게 유지** - 느린 평가는 실행되지 않음
7. **코드와 함께 평가 버전 관리** - 평가는 일급 산출물

## 예시: 인증 추가

```markdown
## EVAL: add-authentication

### Phase 1: 정의 (10분)
Capability Evals:
- [ ] User can register with email/password
- [ ] User can login with valid credentials
- [ ] Invalid credentials rejected with proper error
- [ ] Sessions persist across page reloads
- [ ] Logout clears session

Regression Evals:
- [ ] Public routes still accessible
- [ ] API responses unchanged
- [ ] Database schema compatible

### Phase 2: 구현 (가변)
[Write code]

### Phase 3: 평가
Run: /eval check add-authentication

### Phase 4: 보고서
EVAL REPORT: add-authentication
==============================
Capability: 5/5 passed (pass@3: 100%)
Regression: 3/3 passed (pass^3: 100%)
Status: SHIP IT
```

## 제품 평가 (v1.8)

행동 품질을 단위 테스트만으로 포착할 수 없을 때 제품 평가를 사용하세요.

### 채점자 유형

1. 코드 채점자 (결정론적 어서션)
2. 규칙 채점자 (정규식/스키마 제약 조건)
3. 모델 채점자 (LLM 심사위원 루브릭)
4. 사람 채점자 (모호한 출력에 대한 수동 판정)

### pass@k 가이드

- `pass@1`: 직접 신뢰성
- `pass@3`: 제어된 재시도 하에서의 실용적 신뢰성
- `pass^3`: 안정성 테스트 (3회 모두 통과해야 함)

권장 임계값:
- 기능 평가: pass@3 >= 0.90
- 회귀 평가: 릴리스 핵심 경로에 pass^3 = 1.00

### 평가 안티패턴

- 알려진 평가 예시에 프롬프트 과적합
- 정상 경로 출력만 측정
- 합격률을 쫓으면서 비용과 지연 시간 변동 무시
- 릴리스 게이트에 불안정한 채점자 허용

### 최소 평가 산출물 레이아웃

- `.claude/evals/<feature>.md` 정의
- `.claude/evals/<feature>.log` 실행 이력
- `docs/releases/<version>/eval-summary.md` 릴리스 스냅샷
