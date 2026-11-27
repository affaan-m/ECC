# Rust API 服务 — 项目 CLAUDE.md

> 使用 Axum、PostgreSQL 和 Docker 构建 Rust API 服务的真实示例。
> 将此文件复制到您的项目根目录，并根据您的服务进行自定义。

## 项目概述

**技术栈：** Rust 1.78+, Axum (Web 框架), SQLx (异步数据库), PostgreSQL, Tokio (异步运行时), Docker

**架构：** 采用分层架构，包含 handler → service → repository 分离。Axum 用于 HTTP，SQLx 用于编译时类型检查的 SQL，Tower 中间件用于横切关注点。

## 关键规则

### Rust 约定

* 库错误使用 `thiserror`，仅在二进制 crate 或测试中使用 `anyhow`
* 生产代码中不使用 `.unwrap()` 或 `.expect()` — 使用 `?` 传播错误
* 函数参数中优先使用 `&str` 而非 `String`；所有权转移时返回 `String`
* 使用 `clippy` 和 `#![deny(clippy::all, clippy::pedantic)]` — 修复所有警告
* 在所有公共类型上派生 `Debug`；仅在需要时派生 `Clone`、`PartialEq`
* 除非有 `// SAFETY:` 注释说明理由，否则不使用 `unsafe` 块

### 数据库

* 所有查询使用 SQLx 的 `query!` 或 `query_as!` 宏 — 针对模式进行编译时验证
* 在 `migrations/` 中使用 `sqlx migrate` 进行迁移 — 切勿直接修改数据库
* 使用 `sqlx::Pool<Postgres>` 作为共享状态 — 切勿为每个请求创建连接
* 所有查询使用参数化占位符 (`$1`, `$2`) — 切勿使用字符串格式化

```rust
// BAD: String interpolation (SQL injection risk)
let q = format!("SELECT * FROM users WHERE id = '{}'", id);

// GOOD: Parameterized query, compile-time checked
let user = sqlx::query_as!(User, "SELECT * FROM users WHERE id = $1", id)
    .fetch_optional(&pool)
    .await?;
```

### 错误处理

* 为每个模块使用 `thiserror` 定义一个领域错误枚举
* 通过 `IntoResponse` 将错误映射到 HTTP 响应 — 切勿暴露内部细节
* 使用 `tracing` 进行结构化日志记录 — 切勿使用 `println!` 或 `eprintln!`

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

### 测试

* 单元测试放在每个源文件内的 `#[cfg(test)]` 模块中
* 集成测试放在 `tests/` 目录中，使用真实的 PostgreSQL (Testcontainers 或 Docker)
* 使用 `#[sqlx::test]` 进行数据库测试，包含自动迁移和回滚
* 使用 `mockall` 或 `wiremock` 模拟外部服务

### 代码风格

* 最大行长度：100 个字符（由 rustfmt 强制执行）
* 导入分组：`std`、外部 crate、`crate`/`super` — 用空行分隔
* 模块：每个模块一个文件，`mod.rs` 仅用于重新导出
* 类型：PascalCase，函数/变量：snake\_case，常量：UPPER\_SNAKE\_CASE

## 文件结构

```
src/
  main.rs              # 入口点、服务器设置、优雅关闭
  lib.rs               # 用于集成测试的重新导出
  config.rs            # 使用 envy 或 figment 的环境配置
  router.rs            # 包含所有路由的 Axum 路由器
  middleware/
    auth.rs            # JWT 提取与验证
    logging.rs         # 请求/响应追踪
  handlers/
    mod.rs             # 路由处理器（精简版——委托给服务层）
    users.rs
    orders.rs
  services/
    mod.rs             # 业务逻辑
    users.rs
    orders.rs
  repositories/
    mod.rs             # 数据库访问（SQLx 查询）
    users.rs
    orders.rs
  domain/
    mod.rs             # 领域类型、错误枚举
    user.rs
    order.rs
migrations/
  001_create_users.sql
  002_create_orders.sql
tests/
  common/mod.rs        # 共享测试辅助工具、测试服务器设置
  api_users.rs         # 用户端点的集成测试
  api_orders.rs        # 订单端点的集成测试
```

## 关键模式

### Handler (薄层)

```rust
async fn create_user(
    State(ctx): State<AppState>,
    Json(payload): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<UserResponse>), AppError> {
    let user = ctx.user_service.create(payload).await?;
    Ok((StatusCode::CREATED, Json(UserResponse::from(user))))
}
```

### Service (业务逻辑)

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

### Repository (数据访问)

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

### 集成测试

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

## 环境变量

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

## 测试策略

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

## ECC 工作流

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

## Git 工作流

* `feat:` 新功能，`fix:` 错误修复，`refactor:` 代码变更
* 从 `main` 创建功能分支，需要 PR
* CI：`cargo fmt --check`、`cargo clippy`、`cargo test`、`cargo audit`
* 部署：使用 `scratch` 或 `distroless` 基础镜像的 Docker 多阶段构建
