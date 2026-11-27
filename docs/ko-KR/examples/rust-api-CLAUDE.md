# Rust API Service — 프로젝트 CLAUDE.md

> Axum, PostgreSQL, Docker를 사용하는 Rust API 서비스의 실전 예시입니다.
> 프로젝트 루트에 복사하여 서비스에 맞게 커스터마이즈하세요.

## 프로젝트 개요

**기술 스택:** Rust 1.78+, Axum (웹 프레임워크), SQLx (비동기 데이터베이스), PostgreSQL, Tokio (비동기 런타임), Docker

**아키텍처:** handler -> service -> repository로 분리된 레이어드 아키텍처. HTTP에 Axum, 컴파일 타임에 타입이 검증되는 SQL에 SQLx, 횡단 관심사에 Tower 미들웨어 사용.

## 필수 규칙

### Rust 규칙

- 라이브러리 오류에 `thiserror`, 바이너리 크레이트나 테스트에서만 `anyhow` 사용
- 프로덕션 코드에서 `.unwrap()`이나 `.expect()` 사용 금지 — `?`로 오류 전파
- 함수 매개변수에 `String`보다 `&str` 선호; 소유권 이전 시 `String` 반환
- `#![deny(clippy::all, clippy::pedantic)]`과 함께 `clippy` 사용 — 모든 경고 수정
- 모든 공개 타입에 `Debug` derive; `Clone`, `PartialEq`는 필요할 때만 derive
- `// SAFETY:` 주석으로 정당화하지 않는 한 `unsafe` 블록 사용 금지

### 데이터베이스

- 모든 쿼리에 SQLx `query!` 또는 `query_as!` 매크로 사용 — 스키마에 대해 컴파일 타임에 검증
- 마이그레이션은 `migrations/`에 `sqlx migrate` 사용 — 데이터베이스를 직접 변경하지 않기
- 공유 상태로 `sqlx::Pool<Postgres>` 사용 — 요청마다 커넥션을 생성하지 않기
- 모든 쿼리에 parameterized placeholder (`$1`, `$2`) 사용 — 문자열 포매팅 사용 금지

```rust
// 나쁜 예: 문자열 보간 (SQL injection 위험)
let q = format!("SELECT * FROM users WHERE id = '{}'", id);

// 좋은 예: parameterized 쿼리, 컴파일 타임에 검증
let user = sqlx::query_as!(User, "SELECT * FROM users WHERE id = $1", id)
    .fetch_optional(&pool)
    .await?;
```

### 오류 처리

- 모듈별로 `thiserror`를 사용한 도메인 오류 enum 정의
- `IntoResponse`를 통해 오류를 HTTP 응답으로 매핑 — 내부 세부 정보를 노출하지 않기
- 구조화된 로깅에 `tracing` 사용 — `println!`이나 `eprintln!` 사용 금지

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Resource not found")]
    NotFound,
    #[error("Validation failed: {0}")]
    Validation(String),
    #[error("Unauthorized")]
    Unauthorized,
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            Self::NotFound => (StatusCode::NOT_FOUND, self.to_string()),
            Self::Validation(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, self.to_string()),
            Self::Database(err) => {
                tracing::error!(?err, "database error");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal error".into())
            }
            Self::Io(err) => {
                tracing::error!(?err, "internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal error".into())
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}
```

### 테스트

- 각 소스 파일 내의 `#[cfg(test)]` 모듈에서 단위 테스트
- `tests/` 디렉토리에서 실제 PostgreSQL을 사용한 통합 테스트 (Testcontainers 또는 Docker)
- 자동 마이그레이션과 롤백이 포함된 데이터베이스 테스트에 `#[sqlx::test]` 사용
- 외부 서비스 모킹에 `mockall` 또는 `wiremock` 사용

### 코드 스타일

- 최대 줄 길이: 100자 (rustfmt에 의해 강제)
- import 그룹화: `std`, 외부 크레이트, `crate`/`super` — 빈 줄로 구분
- 모듈: 모듈당 파일 하나, `mod.rs`는 re-export용으로만 사용
- 타입: PascalCase, 함수/변수: snake_case, 상수: UPPER_SNAKE_CASE

## 파일 구조

```
src/
  main.rs              # 진입점, 서버 설정, 우아한 종료
  lib.rs               # 통합 테스트를 위한 re-export
  config.rs            # envy 또는 figment을 사용한 환경 설정
  router.rs            # 모든 라우트가 포함된 Axum 라우터
  middleware/
    auth.rs            # JWT 추출 및 검증
    logging.rs         # 요청/응답 트레이싱
  handlers/
    mod.rs             # 라우트 핸들러 (얇게 — 서비스에 위임)
    users.rs
    orders.rs
  services/
    mod.rs             # 비즈니스 로직
    users.rs
    orders.rs
  repositories/
    mod.rs             # 데이터베이스 접근 (SQLx 쿼리)
    users.rs
    orders.rs
  domain/
    mod.rs             # 도메인 타입, 오류 enum
    user.rs
    order.rs
migrations/
  001_create_users.sql
  002_create_orders.sql
tests/
  common/mod.rs        # 공유 테스트 헬퍼, 테스트 서버 설정
  api_users.rs         # 사용자 엔드포인트 통합 테스트
  api_orders.rs        # 주문 엔드포인트 통합 테스트
```

## 주요 패턴

### Handler (얇은 레이어)

```rust
async fn create_user(
    State(ctx): State<AppState>,
    Json(payload): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<UserResponse>), AppError> {
    let user = ctx.user_service.create(payload).await?;
    Ok((StatusCode::CREATED, Json(UserResponse::from(user))))
}
```

### Service (비즈니스 로직)

```rust
impl UserService {
    pub async fn create(&self, req: CreateUserRequest) -> Result<User, AppError> {
        if self.repo.find_by_email(&req.email).await?.is_some() {
            return Err(AppError::Validation("Email already registered".into()));
        }

        let password_hash = hash_password(&req.password)?;
        let user = self.repo.insert(&req.email, &req.name, &password_hash).await?;

        Ok(user)
    }
}
```

### Repository (데이터 접근)

```rust
impl UserRepository {
    pub async fn find_by_email(&self, email: &str) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as!(User, "SELECT * FROM users WHERE email = $1", email)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn insert(
        &self,
        email: &str,
        name: &str,
        password_hash: &str,
    ) -> Result<User, sqlx::Error> {
        sqlx::query_as!(
            User,
            r#"INSERT INTO users (email, name, password_hash)
               VALUES ($1, $2, $3) RETURNING *"#,
            email, name, password_hash,
        )
        .fetch_one(&self.pool)
        .await
    }
}
```

### 통합 테스트

```rust
#[tokio::test]
async fn test_create_user() {
    let app = spawn_test_app().await;

    let response = app
        .client
        .post(&format!("{}/api/v1/users", app.address))
        .json(&json!({
            "email": "alice@example.com",
            "name": "Alice",
            "password": "securepassword123"
        }))
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status(), StatusCode::CREATED);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["email"], "alice@example.com");
}

#[tokio::test]
async fn test_create_user_duplicate_email() {
    let app = spawn_test_app().await;
    // 첫 번째 사용자 생성
    create_test_user(&app, "alice@example.com").await;
    // 중복 시도
    let response = create_user_request(&app, "alice@example.com").await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
```

## 환경 변수

```bash
# 서버
HOST=0.0.0.0
PORT=8080
RUST_LOG=info,tower_http=debug

# 데이터베이스
DATABASE_URL=postgres://user:pass@localhost:5432/myapp

# 인증
JWT_SECRET=your-secret-key-min-32-chars
JWT_EXPIRY_HOURS=24

# 선택 사항
CORS_ALLOWED_ORIGINS=http://localhost:3000
```

## 테스트 전략

```bash
# 전체 테스트 실행
cargo test

# 출력과 함께 실행
cargo test -- --nocapture

# 특정 테스트 모듈 실행
cargo test api_users

# 커버리지 확인 (cargo-llvm-cov 필요)
cargo llvm-cov --html
open target/llvm-cov/html/index.html

# 린트
cargo clippy -- -D warnings

# 포맷 검사
cargo fmt -- --check
```

## ECC 워크플로우

```bash
# 계획 수립
/plan "Add order fulfillment with Stripe payment"

# TDD로 개발
/tdd                    # cargo test 기반 TDD 워크플로우

# 리뷰
/code-review            # Rust 전용 코드 리뷰
/security-scan          # 의존성 감사 + unsafe 스캔

# 검증
/verify                 # 빌드, clippy, 테스트, 보안 스캔
```

## Git 워크플로우

- `feat:` 새 기능, `fix:` 버그 수정, `refactor:` 코드 변경
- `main`에서 feature 브랜치 생성, PR 필수
- CI: `cargo fmt --check`, `cargo clippy`, `cargo test`, `cargo audit`
- 배포: `scratch` 또는 `distroless` 베이스를 사용한 Docker 멀티스테이지 빌드
