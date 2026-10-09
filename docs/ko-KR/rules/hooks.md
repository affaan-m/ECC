# 훅 시스템

## 훅 유형

- **PreToolUse**: 도구 실행 전 (유효성 검증, 매개변수 수정)
- **PostToolUse**: 도구 실행 후 (자동 포맷, 검사)
- **Stop**: 세션 종료 시 (최종 검증)

## 자동 수락 권한

주의하여 사용:
- 신뢰할 수 있는, 잘 정의된 계획에서만 활성화
- 탐색적 작업에서는 비활성화
- dangerously-skip-permissions 플래그를 절대 사용하지 않기
- 대신 `~/.claude/settings.json`(또는 프로젝트의 `.claude/settings.json`)에서 `permissions.allow` 규칙을 설정

## TodoWrite 모범 사례

TodoWrite 도구 활용:
- 다단계 작업의 진행 상황 추적
- 지시사항 이해도 검증
- 실시간 방향 조정 가능
- 세부 구현 단계 표시

Todo 목록으로 확인 가능한 것:
- 순서가 맞지 않는 단계
- 누락된 항목
- 불필요한 추가 항목
- 잘못된 세분화 수준
- 잘못 해석된 요구사항
