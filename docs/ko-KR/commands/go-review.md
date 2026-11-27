---
description: 관용적 패턴, 동시성 안전성, 에러 처리, 보안에 대한 포괄적인 Go 코드 리뷰. go-reviewer 에이전트를 호출합니다.
---

# Go 코드 리뷰

이 커맨드는 **go-reviewer** 에이전트를 호출하여 Go 전용 포괄적 코드 리뷰를 수행합니다.

## 이 커맨드가 하는 것

1. **Go 변경사항 식별**: `git diff`로 수정된 `.go` 파일 찾기
2. **정적 분석 실행**: `go vet`, `staticcheck`, `golangci-lint` 실행
3. **보안 스캔**: SQL 인젝션, 커맨드 인젝션, 레이스 컨디션 검사
4. **동시성 리뷰**: 고루틴 안전성, 채널 사용, 뮤텍스 패턴 분석
5. **관용적 Go 검사**: Go 컨벤션과 모범 사례 준수 여부 확인
6. **보고서 생성**: 심각도별 이슈 분류

## 사용 시점

`/go-review`를 사용해야 할 때:
- Go 코드를 작성하거나 수정한 후
- Go 변경사항을 커밋하기 전
- Go 코드가 포함된 PR 리뷰 시
- 새 Go 코드베이스에 온보딩할 때
- 관용적 Go 패턴 학습 시

## 리뷰 카테고리

### CRITICAL (반드시 수정)
- SQL/커맨드 인젝션 취약점
- 동기화 없는 레이스 컨디션
- 고루틴 누수
- 하드코딩된 인증 정보
- unsafe 포인터 사용
- 핵심 경로에서 에러 무시

### HIGH (수정 권장)
- 컨텍스트 없는 에러 래핑 누락
- 에러 반환 대신 panic 사용
- 컨텍스트 전파 누락
- 데드락을 유발하는 버퍼 없는 채널
- 인터페이스 미충족 에러
- 뮤텍스 보호 누락

### MEDIUM (고려)
- 비관용적 코드 패턴
- 공개 항목에 godoc 주석 누락
- 비효율적인 문자열 연결
- 슬라이스 사전 할당 누락
- 테이블 기반 테스트 미사용

## 실행되는 자동 검사

```bash
# 정적 분석
go vet ./...

# 고급 검사 (설치된 경우)
staticcheck ./...
golangci-lint run

# 레이스 감지
go build -race ./...

# 보안 취약점
govulncheck ./...
```

## 사용 예시

````text
User: /go-review

Agent:
# Go 코드 리뷰 보고서

## 리뷰된 파일
- internal/handler/user.go (수정됨)
- internal/service/auth.go (수정됨)

## 정적 분석 결과
✓ go vet: 이슈 없음
✓ staticcheck: 이슈 없음

## 발견된 이슈

[CRITICAL] 레이스 컨디션
파일: internal/service/auth.go:45
이슈: 동기화 없이 공유 맵에 접근
```go
var cache = map[string]*Session{}  // 동시 접근!

func GetSession(id string) *Session {
    return cache[id]  // 레이스 컨디션
}
```
수정: sync.RWMutex 또는 sync.Map 사용
```go
var (
    cache   = map[string]*Session{}
    cacheMu sync.RWMutex
)

func GetSession(id string) *Session {
    cacheMu.RLock()
    defer cacheMu.RUnlock()
    return cache[id]
}
```

[HIGH] 에러 컨텍스트 누락
파일: internal/handler/user.go:28
이슈: 컨텍스트 없이 에러 반환
```go
return err  // 컨텍스트 없음
```
수정: 컨텍스트와 함께 래핑
```go
return fmt.Errorf("get user %s: %w", userID, err)
```

## 요약
- CRITICAL: 1
- HIGH: 1
- MEDIUM: 0

권장: FAIL: CRITICAL 이슈가 수정될 때까지 merge 차단
````

## 승인 기준

| 상태 | 조건 |
|------|------|
| PASS: 승인 | CRITICAL 또는 HIGH 이슈 없음 |
| WARNING: 경고 | MEDIUM 이슈만 있음 (주의하여 merge) |
| FAIL: 차단 | CRITICAL 또는 HIGH 이슈 발견 |

## 다른 커맨드와의 연동

- `/go-test`를 먼저 사용하여 테스트 통과 확인
- `/go-build`를 사용하여 build 에러 발생 시 수정
- `/go-review`를 커밋 전에 사용
- `/code-review`를 사용하여 Go 외 일반적인 관심사항 리뷰

## 관련 항목

- 에이전트: `agents/go-reviewer.md`
- 스킬: `skills/golang-patterns/`, `skills/golang-testing/`
