# Eval 커맨드

평가 기반 개발 워크플로우를 관리합니다.

## 사용법

`/eval [define|check|report|list|clean] [feature-name]`

## 평가 정의

`/eval define feature-name`

새로운 평가 정의를 생성합니다:

1. `.claude/evals/feature-name.md`에 템플릿을 생성합니다:

```markdown
## EVAL: feature-name
Created: $(date)

### Capability Evals
- [ ] [기능 1에 대한 설명]
- [ ] [기능 2에 대한 설명]

### Regression Evals
- [ ] [기존 동작 1이 여전히 작동함]
- [ ] [기존 동작 2이 여전히 작동함]

### Success Criteria
- capability eval에 대해 pass@3 > 90%
- regression eval에 대해 pass^3 = 100%
```

2. 사용자에게 구체적인 기준을 입력하도록 안내합니다

## 평가 확인

`/eval check feature-name`

기능에 대한 평가를 실행합니다:

1. `.claude/evals/feature-name.md`에서 평가 정의를 읽습니다
2. 각 capability eval에 대해:
   - 기준 검증을 시도합니다
   - PASS/FAIL을 기록합니다
   - `.claude/evals/feature-name.log`에 시도를 기록합니다
3. 각 regression eval에 대해:
   - 관련 테스트를 실행합니다
   - 기준선과 비교합니다
   - PASS/FAIL을 기록합니다
4. 현재 상태를 보고합니다:

```
EVAL CHECK: feature-name
========================
Capability: X/Y passing
Regression: X/Y passing
Status: IN PROGRESS / READY
```

## 평가 보고

`/eval report feature-name`

포괄적인 평가 보고서를 생성합니다:

```
EVAL REPORT: feature-name
=========================
Generated: $(date)

CAPABILITY EVALS
----------------
[eval-1]: PASS (pass@1)
[eval-2]: PASS (pass@2) - 재시도 필요했음
[eval-3]: FAIL - 비고 참조

REGRESSION EVALS
----------------
[test-1]: PASS
[test-2]: PASS
[test-3]: PASS

METRICS
-------
Capability pass@1: 67%
Capability pass@3: 100%
Regression pass^3: 100%

NOTES
-----
[이슈, 엣지 케이스 또는 관찰 사항]

RECOMMENDATION
--------------
[SHIP / NEEDS WORK / BLOCKED]
```

## 평가 목록

`/eval list`

모든 평가 정의를 표시합니다:

```
EVAL DEFINITIONS
================
feature-auth      [3/5 passing] IN PROGRESS
feature-search    [5/5 passing] READY
feature-export    [0/4 passing] NOT STARTED
```

## 인자

$ARGUMENTS:
- `define <name>` - 새 평가 정의 생성
- `check <name>` - 평가 실행 및 확인
- `report <name>` - 전체 보고서 생성
- `list` - 모든 평가 표시
- `clean` - 오래된 평가 로그 제거 (최근 10회 실행 유지)
