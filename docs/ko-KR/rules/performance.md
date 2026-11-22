# 성능 최적화

## 모델 선택 전략

**Haiku 4.5** (Sonnet 능력의 90%, 3배 비용 절감):
- 자주 호출되는 경량 에이전트
- 페어 프로그래밍과 코드 생성
- 멀티 에이전트 시스템의 워커 에이전트

**Sonnet 5** (최고의 코딩 모델):
- 주요 개발 작업
- 멀티 에이전트 워크플로우 오케스트레이션
- 복잡한 코딩 작업

**Opus 5** (가장 깊은 추론):
- 복잡한 아키텍처 의사결정
- 최대 추론 요구사항
- 리서치 및 분석 작업

## 컨텍스트 윈도우 관리

컨텍스트 윈도우의 마지막 20%에서는 다음을 피하세요:
- 대규모 리팩토링
- 여러 파일에 걸친 기능 구현
- 복잡한 상호작용 디버깅

컨텍스트 민감도가 낮은 작업:
- 단일 파일 수정
- 독립적인 유틸리티 생성
- 문서 업데이트
- 단순한 버그 수정

## 확장 사고 + 계획 모드

Claude Code에서는 적응형 추론을 통해 모델이 작업마다 얼마나 생각할지 스스로 결정합니다. Fable 모델, Sonnet 5 이상, Opus 4.7 이상에서는 고정 토큰 예산 대신 effort로 추론을 제어합니다. 사용 가능한 레벨은 모델에 따라 다릅니다.

사고 제어 방법:
- **Effort**: 세션에서는 `/effort`, 시작할 때는 `--effort <level>`, 또는 `CLAUDE_CODE_EFFORT_LEVEL`을 사용합니다. 환경 변수는 두 방법보다 우선하므로, 다른 제어를 사용하기 전에 정의된 곳에서 제거하고 Claude Code를 다시 시작하세요. `~/.claude/settings.json`의 `modelSettings`에 모델별 레벨을 저장할 수 있습니다. 이전 사용자 수준 `effortLevel` 키는 Opus 5.5 이상 모델에 적용되지 않습니다.
- **전환**: Option+T (macOS) / Alt+T (Windows/Linux), 또는 설정의 `alwaysThinkingEnabled`. Opus 5.5, Sonnet 5.5, Fable 모델에서는 사고를 비활성화할 수 없습니다.
- **고정 예산**: 적응형 추론 모델에서 Claude Code는 양수 `MAX_THINKING_TOKENS` 값을 무시합니다. Opus 4.6 또는 Sonnet 4.6에서는 `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1`을 설정하면 `MAX_THINKING_TOKENS`로 고정 예산을 사용할 수 있습니다.
- **상세 모드**: Ctrl+O로 사고 출력 확인

지원되는 제어 방법은 [Claude Code 모델 설정](https://code.claude.com/docs/en/model-config#adjust-effort-level)과 [환경 변수](https://code.claude.com/docs/en/env-vars)를 참고하세요.

깊은 추론이 필요한 복잡한 작업:
1. 현재 레벨을 확인하고 `/effort`로 지원되는 더 높은 레벨을 선택하세요. Opus 4.7은 이미 `xhigh`에서 시작하므로 `high`는 레벨을 낮춥니다
2. 구조적 접근을 위해 **계획 모드** 활성화
3. 철저한 분석을 위해 여러 라운드의 비판 수행
4. 다양한 관점을 위해 역할 분리 서브에이전트 사용

## 빌드 문제 해결

빌드 실패 시:
1. **build-error-resolver** 에이전트 사용
2. 에러 메시지 분석
3. 점진적으로 수정
4. 각 수정 후 검증
