# Orchestrate 커맨드

복잡한 작업을 위한 순차적 에이전트 워크플로우입니다.

## 사용법

`/orchestrate [workflow-type] [task-description]`

## 워크플로우 유형

### feature
전체 기능 구현 워크플로우:
```
planner -> tdd-guide -> code-reviewer -> security-reviewer
```

### bugfix
버그 조사 및 수정 워크플로우:
```
planner -> tdd-guide -> code-reviewer
```

### refactor
안전한 리팩토링 워크플로우:
```
architect -> code-reviewer -> tdd-guide
```

### security
보안 중심 리뷰:
```
security-reviewer -> code-reviewer -> architect
```

## 실행 패턴

워크플로우의 각 에이전트에 대해:

1. 이전 에이전트의 컨텍스트로 **에이전트 호출**
2. 구조화된 핸드오프 문서로 **출력 수집**
3. 체인의 **다음 에이전트에 전달**
4. **결과를 종합**하여 최종 보고서 작성

## 핸드오프 문서 형식

에이전트 간에 핸드오프 문서를 생성합니다:

```markdown
## HANDOFF: [이전-에이전트] -> [다음-에이전트]

### Context
[수행된 작업 요약]

### Findings
[주요 발견 사항 또는 결정 사항]

### Files Modified
[수정된 파일 목록]

### Open Questions
[다음 에이전트를 위한 미해결 항목]

### Recommendations
[제안하는 다음 단계]
```

## 예시: Feature 워크플로우

```
/orchestrate feature "Add user authentication"
```

실행 순서:

1. **Planner 에이전트**
   - 요구사항 분석
   - 구현 계획 작성
   - 의존성 식별
   - 출력: `HANDOFF: planner -> tdd-guide`

2. **TDD Guide 에이전트**
   - planner 핸드오프 읽기
   - 테스트 먼저 작성
   - 테스트를 통과하도록 구현
   - 출력: `HANDOFF: tdd-guide -> code-reviewer`

3. **Code Reviewer 에이전트**
   - 구현 리뷰
   - 이슈 확인
   - 개선사항 제안
   - 출력: `HANDOFF: code-reviewer -> security-reviewer`

4. **Security Reviewer 에이전트**
   - 보안 감사
   - 취약점 점검
   - 최종 승인
   - 출력: 최종 보고서

## 최종 보고서 형식

```
ORCHESTRATION REPORT
====================
Workflow: feature
Task: Add user authentication
Agents: planner -> tdd-guide -> code-reviewer -> security-reviewer

SUMMARY
-------
[한 단락 요약]

AGENT OUTPUTS
-------------
Planner: [요약]
TDD Guide: [요약]
Code Reviewer: [요약]
Security Reviewer: [요약]

FILES CHANGED
-------------
[수정된 모든 파일 목록]

TEST RESULTS
------------
[테스트 통과/실패 요약]

SECURITY STATUS
---------------
[보안 발견 사항]

RECOMMENDATION
--------------
[SHIP / NEEDS WORK / BLOCKED]
```

## 병렬 실행

독립적인 검사에 대해서는 에이전트를 병렬로 실행합니다:

```markdown
### Parallel Phase
동시에 실행:
- code-reviewer (품질)
- security-reviewer (보안)
- architect (설계)

### Merge Results
출력을 단일 보고서로 통합
```

## 인자

$ARGUMENTS:
- `feature <description>` - 전체 기능 워크플로우
- `bugfix <description>` - 버그 수정 워크플로우
- `refactor <description>` - 리팩토링 워크플로우
- `security <description>` - 보안 리뷰 워크플로우
- `custom <agents> <description>` - 사용자 정의 에이전트 순서

## 사용자 정의 워크플로우 예시

```
/orchestrate custom "architect,tdd-guide,code-reviewer" "Redesign caching layer"
```

## 팁

1. 복잡한 기능에는 **planner부터 시작**하세요
2. merge 전에는 **항상 code-reviewer를 포함**하세요
3. 인증/결제/개인정보 처리에는 **security-reviewer를 사용**하세요
4. **핸드오프는 간결하게** 유지하세요 - 다음 에이전트에 필요한 것에 집중
5. 필요한 경우 에이전트 사이에 **검증을 실행**하세요
