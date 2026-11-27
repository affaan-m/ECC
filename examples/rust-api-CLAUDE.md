# Rust API Service — Project CLAUDE.md

> Real-world example for a Rust API service with Axum, PostgreSQL, and Docker.
> Copy this to your project root and customize for your service.

## Project Overview

**Stack:** Rust 1.78+, Axum (web framework), SQLx (async database), PostgreSQL, Tokio (async runtime), Docker

**Architecture:** Layered architecture with handler → service → repository separation. Axum for HTTP, SQLx for type-checked SQL at compile time, Tower middleware for cross-cutting concerns.

## Critical Rules

### Rust Conventions

- Use `thiserror` for library errors, `anyhow` only in binary crates or tests
- No `.unwrap()` or `.expect()` in production code — propagate errors with `?`
- Prefer `&str` over `String` in function parameters; return `String` when ownership transfers
- Use `clippy` with `#![deny(clippy::all, clippy::pedantic)]` — fix all warnings
- Derive `Debug` on all public types; derive `Clone`, `PartialEq` only when needed
- No `unsafe` blocks unless justified with a `// SAFETY:` comment

### Database

- All queries use SQLx `query!` or `query_as!` macros — compile-time verified against the schema
- Migrations in `migrations/` using `sqlx migrate` — never alter the database directly
- Use `sqlx::Pool<Postgres>` as shared state — never create connections per request
- All queries use parameterized placeholders (`$1`, `$2`) — never string formatting

```rust
// BAD: String interpolation (SQL injection risk)
let q = format!("SELECT * FROM users WHERE id = '{}'", id);

// GOOD: Parameterized query, compile-time checked
let user = sqlx::query_as!(User, "SELECT * FROM users WHERE id = $1", id)
    .fetch_optional(&pool)
    .await?;
```

### Error Handling

- Define a domain error enum per module with `thiserror`
- Map errors to HTTP responses via `IntoResponse` — never expose internal details
- Use `tracing` for structured logging — never `println!` or `eprintln!`

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
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            Self::NotFound => (StatusCode::NOT_FOUND, self.to_string()),
            Self::Validation(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, self.to_string()),
            Self::Internal(err) => {
                tracing::error!(?err, "internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal error".into())
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}
```

### Testing

- Unit tests in `#[cfg(test)]` modules within each source file
- Integration tests in `tests/` directory using a real PostgreSQL (Testcontainers or Docker)
- Use `#[sqlx::test]` for database tests with automatic migration and rollback
- Mock external services with `mockall` or `wiremock`

### Code Style

- Max line length: 100 characters (enforced by rustfmt)
- Group imports: `std`, external crates, `crate`/`super` — separated by blank lines
- Modules: one file per module, `mod.rs` only for re-exports
- Types: PascalCase, functions/variables: snake_case, constants: UPPER_SNAKE_CASE

## File Structure

```
src/
  main.rs              # Entrypoint, server setup, graceful shutdown
  lib.rs               # Re-exports for integration tests
  config.rs            # Environment config with envy or figment
  router.rs            # Axum router with all routes
  middleware/
    auth.rs            # JWT extraction and validation
    logging.rs         # Request/response tracing
  handlers/
    mod.rs             # Route handlers (thin — delegate to services)
    users.rs
    orders.rs
  services/
    mod.rs             # Business logic
    users.rs
    orders.rs
  repositories/
    mod.rs             # Database access (SQLx queries)
    users.rs
    orders.rs
  domain/
    mod.rs             # Domain types, error enums
    user.rs
    order.rs
migrations/
  001_create_users.sql
  002_create_orders.sql
tests/
  common/mod.rs        # Shared test helpers, test server setup
  api_users.rs         # Integration tests for user endpoints
  api_orders.rs        # Integration tests for order endpoints
```

## Key Patterns

### Handler (Thin)

```rust
async fn create_user(
    State(ctx): State<AppState>,
    Json(payload): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<UserResponse>), AppError> {
    let user = ctx.user_service.create(payload).await?;
    Ok((StatusCode::CREATED, Json(UserResponse::from(user))))
}
```

### Service (Business Logic)

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

### Repository (Data Access)

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

### Integration Test

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
    // Create first user
    create_test_user(&app, "alice@example.com").await;
    // Attempt duplicate
    let response = create_user_request(&app, "alice@example.com").await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
```

## Environment Variables

```bash
# Server
HOST=0.0.0.0
PORT=8080
RUST_LOG=info,tower_http=debug

# Database
DATABASE_URL=postgres://user:pass@localhost:5432/myapp

# Auth
JWT_SECRET=your-secret-key-min-32-chars
JWT_EXPIRY_HOURS=24

# Optional
CORS_ALLOWED_ORIGINS=http://localhost:3000
```

## Testing Strategy

```bash
# Run all tests
cargo test

# Run with output
cargo test -- --nocapture

# Run specific test module
cargo test api_users

# Check coverage (requires cargo-llvm-cov)
cargo llvm-cov --html
open target/llvm-cov/html/index.html

# Lint
cargo clippy -- -D warnings

# Format check
cargo fmt -- --check
```

## ECC Workflow

```bash
# Planning
/plan "Add order fulfillment with Stripe payment"

# Development with TDD
/tdd                    # cargo test-based TDD workflow

# Review
/code-review            # Rust-specific code review
/security-scan          # Dependency audit + unsafe scan

# Verification
/verify                 # Build, clippy, test, security scan
```

## Git Workflow

- `feat:` new features, `fix:` bug fixes, `refactor:` code changes
- Feature branches from `main`, PRs required
- CI: `cargo fmt --check`, `cargo clippy`, `cargo test`, `cargo audit`
- Deploy: Docker multi-stage build with `scratch` or `distroless` base
