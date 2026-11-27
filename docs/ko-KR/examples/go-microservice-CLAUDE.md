# Go Microservice — 프로젝트 CLAUDE.md

> PostgreSQL, gRPC, Docker를 사용하는 Go 마이크로서비스의 실전 예시입니다.
> 프로젝트 루트에 복사하여 서비스에 맞게 커스터마이즈하세요.

## 프로젝트 개요

**기술 스택:** Go 1.22+, PostgreSQL, gRPC + REST (grpc-gateway), Docker, sqlc (타입 안전 SQL), Wire (의존성 주입)

**아키텍처:** domain, repository, service, handler 레이어로 구성된 클린 아키텍처. gRPC를 기본 전송 프로토콜로 사용하고, 외부 클라이언트를 위한 REST gateway 제공.

## 필수 규칙

### Go 규칙

- Effective Go와 Go Code Review Comments 가이드를 따를 것
- 오류 래핑에 `errors.New` / `fmt.Errorf`와 `%w` 사용 — 오류를 문자열 매칭하지 않기
- `init()` 함수 사용 금지 — `main()`이나 생성자에서 명시적으로 초기화
- 전역 가변 상태 금지 — 생성자를 통해 의존성 전달
- Context는 반드시 첫 번째 매개변수이며 모든 레이어를 통해 전파

### 데이터베이스

- 모든 쿼리는 `queries/`에 순수 SQL로 작성 — sqlc가 타입 안전한 Go 코드를 생성
- 마이그레이션은 `migrations/`에 golang-migrate 사용 — 데이터베이스를 직접 변경하지 않기
- 다중 단계 작업에는 `pgx.Tx`를 통한 트랜잭션 사용
- 모든 쿼리에 parameterized placeholder (`$1`, `$2`) 사용 — 문자열 포매팅 사용 금지

### 오류 처리

- 오류를 반환하고, panic하지 않기 — panic은 진정으로 복구 불가능한 상황에만 사용
- 컨텍스트와 함께 오류 래핑: `fmt.Errorf("creating user: %w", err)`
- 비즈니스 로직을 위한 sentinel 오류는 `domain/errors.go`에 정의
- handler 레이어에서 도메인 오류를 gRPC status 코드로 매핑

```go
// 도메인 레이어 — sentinel 오류
var (
    ErrUserNotFound  = errors.New("user not found")
    ErrEmailTaken    = errors.New("email already registered")
)

// Handler 레이어 — gRPC status로 매핑
func toGRPCError(err error) error {
    switch {
    case errors.Is(err, domain.ErrUserNotFound):
        return status.Error(codes.NotFound, err.Error())
    case errors.Is(err, domain.ErrEmailTaken):
        return status.Error(codes.AlreadyExists, err.Error())
    default:
        return status.Error(codes.Internal, "internal error")
    }
}
```

### 코드 스타일

- 코드나 주석에 이모지 사용 금지
- 외부로 공개되는 타입과 함수에는 반드시 doc 주석 작성
- 함수는 50줄 이하로 유지 — 헬퍼 함수로 분리
- 여러 케이스가 있는 모든 로직에 table-driven 테스트 사용
- signal 채널에는 `bool`이 아닌 `struct{}` 사용

## 파일 구조

```
cmd/
  server/
    main.go              # 진입점, Wire 주입, 우아한 종료
internal/
  domain/                # 비즈니스 타입과 인터페이스
    user.go              # User 엔티티와 repository 인터페이스
    errors.go            # Sentinel 오류
  service/               # 비즈니스 로직
    user_service.go
    user_service_test.go
  repository/            # 데이터 접근 (sqlc 생성 + 커스텀)
    postgres/
      user_repo.go
      user_repo_test.go  # testcontainers를 사용한 통합 테스트
  handler/               # gRPC + REST 핸들러
    grpc/
      user_handler.go
    rest/
      user_handler.go
  config/                # 설정 로딩
    config.go
proto/                   # Protobuf 정의
  user/v1/
    user.proto
queries/                 # sqlc용 SQL 쿼리
  user.sql
migrations/              # 데이터베이스 마이그레이션
  001_create_users.up.sql
  001_create_users.down.sql
```

## 주요 패턴

### Repository 인터페이스

```go
type UserRepository interface {
    Create(ctx context.Context, user *User) error
    FindByID(ctx context.Context, id uuid.UUID) (*User, error)
    FindByEmail(ctx context.Context, email string) (*User, error)
    Update(ctx context.Context, user *User) error
    Delete(ctx context.Context, id uuid.UUID) error
}
```

### 의존성 주입을 사용한 Service

```go
type UserService struct {
    repo   domain.UserRepository
    hasher PasswordHasher
    logger *slog.Logger
}

func NewUserService(repo domain.UserRepository, hasher PasswordHasher, logger *slog.Logger) *UserService {
    return &UserService{repo: repo, hasher: hasher, logger: logger}
}

func (s *UserService) Create(ctx context.Context, req CreateUserRequest) (*domain.User, error) {
    existing, err := s.repo.FindByEmail(ctx, req.Email)
    if err != nil && !errors.Is(err, domain.ErrUserNotFound) {
        return nil, fmt.Errorf("checking email: %w", err)
    }
    if existing != nil {
        return nil, domain.ErrEmailTaken
    }

    hashed, err := s.hasher.Hash(req.Password)
    if err != nil {
        return nil, fmt.Errorf("hashing password: %w", err)
    }

    user := &domain.User{
        ID:       uuid.New(),
        Name:     req.Name,
        Email:    req.Email,
        Password: hashed,
    }
    if err := s.repo.Create(ctx, user); err != nil {
        return nil, fmt.Errorf("creating user: %w", err)
    }
    return user, nil
}
```

### Table-Driven 테스트

```go
func TestUserService_Create(t *testing.T) {
    tests := []struct {
        name    string
        req     CreateUserRequest
        setup   func(*MockUserRepo)
        wantErr error
    }{
        {
            name: "valid user",
            req:  CreateUserRequest{Name: "Alice", Email: "alice@example.com", Password: "secure123"},
            setup: func(m *MockUserRepo) {
                m.On("FindByEmail", mock.Anything, "alice@example.com").Return(nil, domain.ErrUserNotFound)
                m.On("Create", mock.Anything, mock.Anything).Return(nil)
            },
            wantErr: nil,
        },
        {
            name: "duplicate email",
            req:  CreateUserRequest{Name: "Alice", Email: "taken@example.com", Password: "secure123"},
            setup: func(m *MockUserRepo) {
                m.On("FindByEmail", mock.Anything, "taken@example.com").Return(&domain.User{}, nil)
            },
            wantErr: domain.ErrEmailTaken,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            repo := new(MockUserRepo)
            tt.setup(repo)
            svc := NewUserService(repo, &bcryptHasher{}, slog.Default())

            _, err := svc.Create(context.Background(), tt.req)

            if tt.wantErr != nil {
                assert.ErrorIs(t, err, tt.wantErr)
            } else {
                assert.NoError(t, err)
            }
        })
    }
}
```

## 환경 변수

```bash
# 데이터베이스
DATABASE_URL=postgres://user:pass@localhost:5432/myservice?sslmode=disable

# gRPC
GRPC_PORT=50051
REST_PORT=8080

# 인증
JWT_SECRET=           # 프로덕션에서는 vault에서 로드
TOKEN_EXPIRY=24h

# 관측 가능성
LOG_LEVEL=info        # debug, info, warn, error
OTEL_ENDPOINT=        # OpenTelemetry 콜렉터
```

## 테스트 전략

```bash
/go-test             # Go용 TDD 워크플로우
/go-review           # Go 전용 코드 리뷰
/go-build            # 빌드 오류 수정
```

### 테스트 명령어

```bash
# 단위 테스트 (빠름, 외부 의존성 없음)
go test ./internal/... -short -count=1

# 통합 테스트 (testcontainers를 위해 Docker 필요)
go test ./internal/repository/... -count=1 -timeout 120s

# 전체 테스트와 커버리지
go test ./... -coverprofile=coverage.out -count=1
go tool cover -func=coverage.out  # 요약
go tool cover -html=coverage.out  # 브라우저

# Race detector
go test ./... -race -count=1
```

## ECC 워크플로우

```bash
# 계획 수립
/plan "Add rate limiting to user endpoints"

# 개발
/go-test                  # Go 전용 패턴으로 TDD

# 리뷰
/go-review                # Go 관용구, 오류 처리, 동시성
/security-scan            # 시크릿 및 취약점 점검

# 머지 전 확인
go vet ./...
staticcheck ./...
```

## Git 워크플로우

- `feat:` 새 기능, `fix:` 버그 수정, `refactor:` 코드 변경
- `main`에서 feature 브랜치 생성, PR 필수
- CI: `go vet`, `staticcheck`, `go test -race`, `golangci-lint`
- 배포: CI에서 Docker 이미지 빌드, Kubernetes에 배포
