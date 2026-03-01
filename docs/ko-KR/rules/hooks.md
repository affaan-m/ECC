# Hook 시스템

## Hook 유형

- **PreToolUse**: 도구 실행 전 (검증, 매개변수 수정)
- **PostToolUse**: 도구 실행 후 (자동 포맷팅, 검사)
- **Stop**: 세션 종료 시 (최종 검증)

## 현재 Hook (~/.claude/settings.json)

### PreToolUse
- **tmux 알림**: 장시간 실행 명령에 tmux 사용 권장 (npm, pnpm, yarn, cargo 등)
- **git push 리뷰**: push 전 Zed에서 리뷰 열기
- **문서 차단기**: 불필요한 .md/.txt 파일 생성 차단

### PostToolUse
- **PR 생성**: PR URL 및 GitHub Actions 상태 기록
- **oxfmt**: 편집 후 JS/TS 파일 자동 포맷팅
- **TypeScript 검사**: .ts/.tsx 파일 편집 후 tsc 실행
- **console.log 경고**: 편집된 파일의 console.log에 대해 경고

### Stop
- **console.log 감사**: 세션 종료 전 모든 수정된 파일에서 console.log 검사

## 자동 수락 권한

신중하게 사용:
- 신뢰할 수 있고 명확히 정의된 계획에 대해 활성화
- 탐색적 작업에는 비활성화
- 절대 dangerously-skip-permissions flag를 사용하지 않음
- 대신 `~/.claude.json`에서 `allowedTools` 설정

## TodoWrite 모범 사례

TodoWrite 도구의 용도:
- 다단계 작업의 진행 상황 추적
- 지침에 대한 이해도 검증
- 실시간 조정 가능
- 세밀한 구현 단계 표시

할일 목록으로 파악할 수 있는 것:
- 순서가 잘못된 단계
- 누락된 항목
- 불필요한 중복 항목
- 잘못된 세분화 수준
- 잘못 이해된 요구사항
