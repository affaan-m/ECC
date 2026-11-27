---
description: Go용 TDD 워크플로우 강제. 테이블 기반 테스트를 먼저 작성한 후 구현. go test -cover로 80% 이상 커버리지 검증.
---

# Go TDD 커맨드

이 커맨드는 관용적 Go 테스팅 패턴을 사용하여 Go 코드에 테스트 주도 개발 방법론을 강제합니다.

## 이 커맨드가 하는 것

1. **타입/인터페이스 정의**: 함수 시그니처를 먼저 스캐폴딩
2. **테이블 기반 테스트 작성**: 포괄적인 테스트 케이스 생성 (RED)
3. **테스트 실행**: 올바른 이유로 테스트가 실패하는지 확인
4. **코드 구현**: 통과하기 위한 최소한의 코드 작성 (GREEN)
5. **리팩토링**: 테스트를 통과시키면서 개선
6. **커버리지 확인**: 80% 이상 커버리지 확보

## 사용 시점

`/go-test`를 사용해야 할 때:
- 새로운 Go 함수 구현
- 기존 코드에 테스트 커버리지 추가
- 버그 수정 (실패하는 테스트를 먼저 작성)
- 핵심 비즈니스 로직 구현
- Go에서 TDD 워크플로우 학습

## TDD 사이클

```
RED     → 실패하는 테이블 기반 테스트 작성
GREEN   → 통과하기 위한 최소한의 코드 구현
REFACTOR → 코드 개선, 테스트는 통과 유지
REPEAT  → 다음 테스트 케이스
```

## 예시 세션

````
User: /go-test 이메일 주소를 검증하는 함수가 필요합니다

Agent:
# TDD 세션: 이메일 검증기

## 1단계: 인터페이스 정의

```go
// validator/email.go
package validator

// ValidateEmail은 주어진 문자열이 유효한 이메일 주소인지 확인합니다.
// 유효하면 nil을 반환하고, 그렇지 않으면 이슈를 설명하는 error를 반환합니다.
func ValidateEmail(email string) error {
    panic("not implemented")
}
```

## 2단계: 테이블 기반 테스트 작성 (RED)

```go
// validator/email_test.go
package validator

import (
    "testing"
)

func TestValidateEmail(t *testing.T) {
    tests := []struct {
        name    string
        email   string
        wantErr bool
    }{
        // 유효한 이메일
        {"단순 이메일", "user@example.com", false},
        {"서브도메인 포함", "user@mail.example.com", false},
        {"플러스 포함", "user+tag@example.com", false},
        {"점 포함", "first.last@example.com", false},

        // 유효하지 않은 이메일
        {"빈 문자열", "", true},
        {"@ 기호 없음", "userexample.com", true},
        {"도메인 없음", "user@", true},
        {"로컬 파트 없음", "@example.com", true},
        {"이중 @", "user@@example.com", true},
        {"공백 포함", "user @example.com", true},
        {"TLD 없음", "user@example", true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := ValidateEmail(tt.email)
            if tt.wantErr && err == nil {
                t.Errorf("ValidateEmail(%q) = nil; want error", tt.email)
            }
            if !tt.wantErr && err != nil {
                t.Errorf("ValidateEmail(%q) = %v; want nil", tt.email, err)
            }
        })
    }
}
```

## 3단계: 테스트 실행 - 실패 확인

```bash
$ go test ./validator/...

--- FAIL: TestValidateEmail (0.00s)
    --- FAIL: TestValidateEmail/단순_이메일 (0.00s)
        panic: not implemented

FAIL
```

✓ 예상대로 테스트 실패 (panic).

## 4단계: 최소한의 코드 구현 (GREEN)

```go
// validator/email.go
package validator

import (
    "errors"
    "regexp"
)

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)

var (
    ErrEmailEmpty   = errors.New("email cannot be empty")
    ErrEmailInvalid = errors.New("email format is invalid")
)

func ValidateEmail(email string) error {
    if email == "" {
        return ErrEmailEmpty
    }
    if !emailRegex.MatchString(email) {
        return ErrEmailInvalid
    }
    return nil
}
```

## 5단계: 테스트 실행 - 통과 확인

```bash
$ go test ./validator/...

PASS
ok      project/validator    0.003s
```

✓ 모든 테스트 통과!

## 6단계: 커버리지 확인

```bash
$ go test -cover ./validator/...

PASS
coverage: 100.0% of statements
ok      project/validator    0.003s
```

✓ 커버리지: 100%

## TDD 완료!
````

## 테스트 패턴

### 테이블 기반 테스트
```go
tests := []struct {
    name     string
    input    InputType
    want     OutputType
    wantErr  bool
}{
    {"케이스 1", input1, want1, false},
    {"케이스 2", input2, want2, true},
}

for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
        got, err := Function(tt.input)
        // 단언문
    })
}
```

### 병렬 테스트
```go
for _, tt := range tests {
    tt := tt // 캡처
    t.Run(tt.name, func(t *testing.T) {
        t.Parallel()
        // 테스트 본문
    })
}
```

### 테스트 헬퍼
```go
func setupTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db := createDB()
    t.Cleanup(func() { db.Close() })
    return db
}
```

## 커버리지 커맨드

```bash
# 기본 커버리지
go test -cover ./...

# 커버리지 프로파일
go test -coverprofile=coverage.out ./...

# 브라우저에서 확인
go tool cover -html=coverage.out

# 함수별 커버리지
go tool cover -func=coverage.out

# 레이스 감지와 함께
go test -race -cover ./...
```

## 커버리지 목표

| 코드 유형 | 목표 |
|-----------|------|
| 핵심 비즈니스 로직 | 100% |
| 공개 API | 90%+ |
| 일반 코드 | 80%+ |
| 생성된 코드 | 제외 |

## TDD 모범 사례

**해야 할 것:**
- 구현 전에 테스트를 먼저 작성
- 각 변경 후 테스트 실행
- 포괄적인 커버리지를 위해 테이블 기반 테스트 사용
- 구현 세부사항이 아닌 동작 테스트
- 엣지 케이스 포함 (빈 값, nil, 최대값)

**하지 말아야 할 것:**
- 테스트 전에 구현 작성
- RED 단계 건너뛰기
- private 함수를 직접 테스트
- 테스트에서 `time.Sleep` 사용
- 불안정한 테스트 무시

## 관련 커맨드

- `/go-build` - build 에러 수정
- `/go-review` - 구현 후 코드 리뷰
- `/verify` - 전체 검증 루프

## 관련 항목

- 스킬: `skills/golang-testing/`
- 스킬: `skills/tdd-workflow/`
