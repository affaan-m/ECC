---
name: checkpoint
description: 워크플로우에서 checkpoint를 생성, 검증, 조회 또는 정리합니다.
---

# Checkpoint 명령어

워크플로우에서 checkpoint를 생성하거나 검증합니다.

## 사용법

`/checkpoint [create|verify|list|clear] [name]`

## Checkpoint 생성

Checkpoint를 생성할 때:

1. `/verify quick`를 실행하여 현재 상태가 깨끗한지 확인합니다
2. Checkpoint 이름으로 git stash 또는 commit을 생성합니다
3. `.claude/checkpoints.log`에 checkpoint를 기록합니다:

```bash
echo "$(date +%Y-%m-%d-%H:%M) | $CHECKPOINT_NAME | $(git rev-parse --short HEAD)" >> .claude/checkpoints.log
```

4. Checkpoint 생성 완료를 보고합니다

## Checkpoint 검증

Checkpoint와 대조하여 검증할 때:

1. 로그에서 checkpoint를 읽습니다
2. 현재 상태를 checkpoint와 비교합니다:
   - Checkpoint 이후 추가된 파일
   - Checkpoint 이후 수정된 파일
   - 현재와 당시의 테스트 통과율
   - 현재와 당시의 커버리지

3. 보고:
```
CHECKPOINT COMPARISON: $NAME
============================
Files changed: X
Tests: +Y passed / -Z failed
Coverage: +X% / -Y%
Build: [PASS/FAIL]
```

## Checkpoint 목록

모든 checkpoint를 다음 정보와 함께 표시합니다:
- 이름
- 타임스탬프
- Git SHA
- 상태 (current, behind, ahead)

## 워크플로우

일반적인 checkpoint 흐름:

```
[시작] --> /checkpoint create "feature-start"
   |
[구현] --> /checkpoint create "core-done"
   |
[테스트] --> /checkpoint verify "core-done"
   |
[리팩토링] --> /checkpoint create "refactor-done"
   |
[PR] --> /checkpoint verify "feature-start"
```

## 인자

$ARGUMENTS:
- `create <name>` - 이름이 지정된 checkpoint를 생성합니다
- `verify <name>` - 이름이 지정된 checkpoint와 검증합니다
- `list` - 모든 checkpoint를 표시합니다
- `clear` - 이전 checkpoint를 제거합니다 (최근 5개만 유지)
