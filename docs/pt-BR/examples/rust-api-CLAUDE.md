# Serviço de API Rust — CLAUDE.md de Projeto

> Exemplo real para um serviço de API Rust com Axum, PostgreSQL e Docker.
> Copie para a raiz do seu projeto e customize para seu serviço.

## Visão Geral do Projeto

**Stack:** Rust 1.78+, Axum (web framework), SQLx (banco assíncrono), PostgreSQL, Tokio (runtime assíncrono), Docker

**Arquitetura:** Arquitetura em camadas com separação handler → service → repository. Axum para HTTP, SQLx para SQL verificado em tempo de compilação, middleware Tower para preocupações transversais.

## Regras Críticas

### Convenções Rust

- Use `thiserror` para erros de library, `anyhow` apenas em crates binários ou testes
- Sem `.unwrap()` ou `.expect()` em código de produção — propague erros com `?`
- Prefira `&str` a `String` em parâmetros de função; retorne `String` quando houver transferência de ownership
- Use `clippy` com `#![deny(clippy::all, clippy::pedantic)]` — corrija todos os warnings
- Derive `Debug` em todos os tipos públicos; derive `Clone`, `PartialEq` só quando necessário
- Sem blocos `unsafe` sem justificativa com comentário `// SAFETY:`

### Banco de Dados

- Todas as queries usam macros SQLx `query!` ou `query_as!` — verificadas em compile time contra o schema
- Migrations em `migrations/` com `sqlx migrate` — nunca alterar banco diretamente
- Use `sqlx::Pool<Postgres>` como estado compartilhado — nunca criar conexão por requisição
- Todas as queries usam placeholders parametrizados (`$1`, `$2`) — nunca string formatting

```rust
// BAD: String interpolation (SQL injection risk)
let q = format!("SELECT * FROM users WHERE id = '{}'", id);

// GOOD: Parameterized query, compile-time checked
let user = sqlx::query_as!(User, "SELECT * FROM users WHERE id = $1", id)
    .fetch_optional(&pool)
    .await?;
```

### Tratamento de Erro

- Defina enum de erro de domínio por módulo com `thiserror`
- Mapeie erros para respostas HTTP via `IntoResponse` — nunca exponha detalhes internos
- Use `tracing` para logs estruturados — nunca `println!` ou `eprintln!`

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

### Testes

- Testes unitários em módulos `#[cfg(test)]` dentro de cada arquivo fonte
- Testes de integração no diretório `tests/` usando PostgreSQL real (Testcontainers ou Docker)
- Use `#[sqlx::test]` para testes de banco com migration e rollback automáticos
- Faça mock de serviços externos com `mockall` ou `wiremock`

### Estilo de Código

- Tamanho máximo de linha: 100 caracteres (enforced by rustfmt)
- Agrupe imports: `std`, crates externas, `crate`/`super` — separados por linha em branco
- Módulos: um arquivo por módulo, `mod.rs` só para re-exports
- Tipos: PascalCase, funções/variáveis: snake_case, constantes: UPPER_SNAKE_CASE

## Estrutura de Arquivos

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

## Padrões-Chave

### Handler (Enxuto)

```rust
async fn create_user(
    State(ctx): State<AppState>,
    Json(payload): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<UserResponse>), AppError> {
    let user = ctx.user_service.create(payload).await?;
    Ok((StatusCode::CREATED, Json(UserResponse::from(user))))
}
```

### Service (Lógica de Negócio)

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

### Repository (Acesso a Dados)

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

### Teste de Integração

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

## Variáveis de Ambiente

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

## Estratégia de Teste

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

## Workflow ECC

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

## Fluxo Git

- `feat:` novas features, `fix:` correções de bug, `refactor:` mudanças de código
- Branches de feature a partir da `main`, PRs obrigatórios
- CI: `cargo fmt --check`, `cargo clippy`, `cargo test`, `cargo audit`
- Deploy: Docker multi-stage build com base `scratch` ou `distroless`
