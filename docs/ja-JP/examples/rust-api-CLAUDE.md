# Rust API サービス — プロジェクト CLAUDE.md

> Axum、PostgreSQL、Dockerを使用したRust APIサービスの実世界サンプル。
> これをプロジェクトのルートにコピーしてサービスに合わせてカスタマイズしてください。

## プロジェクト概要

**スタック:** Rust 1.78+, Axum（Webフレームワーク）, SQLx（非同期データベース）, PostgreSQL, Tokio（非同期ランタイム）, Docker

**アーキテクチャ:** ハンドラー → サービス → リポジトリの分離を持つレイヤードアーキテクチャ。HTTPにAxum、コンパイル時に型チェックされたSQLにSQLx、横断的関心事にTowerミドルウェアを使用。

## 重要なルール

### Rust の規約

- ライブラリエラーには `thiserror` を使用し、`anyhow` はバイナリクレートまたはテストのみ
- 本番コードで `.unwrap()` や `.expect()` を使用しない — `?` でエラーを伝播させる
- 関数パラメーターでは `String` より `&str` を優先し、所有権が移転するときは `String` を返す
- `#![deny(clippy::all, clippy::pedantic)]` で `clippy` を使用 — すべての警告を修正する
- すべての公開型に `Debug` を導出し、`Clone`、`PartialEq` は必要な場合のみ導出する
- `// SAFETY:` コメントによる正当化がない限り `unsafe` ブロックは使用しない

### データベース

- すべてのクエリはSQLxの `query!` または `query_as!` マクロを使用 — スキーマに対してコンパイル時に検証される
- `migrations/` のマイグレーションは `sqlx migrate` を使用 — データベースを直接変更しない
- 共有状態として `sqlx::Pool<Postgres>` を使用 — リクエストごとにコネクションを作成しない
- すべてのクエリはパラメータ化プレースホルダー（`$1`, `$2`）を使用 — 文字列フォーマットは禁止

```rust
// 悪い例: 文字列補間（SQLインジェクションリスク）
let q = format!("SELECT * FROM users WHERE id = '{}'", id);

// 良い例: パラメータ化クエリ、コンパイル時チェック済み
let user = sqlx::query_as!(User, "SELECT * FROM users WHERE id = $1", id)
    .fetch_optional(&pool)
    .await?;
```

### エラーハンドリング

- `thiserror` でモジュールごとにドメインエラーenumを定義する
- `IntoResponse` でエラーをHTTPレスポンスにマップ — 内部詳細を公開しない
- 構造化ロギングには `tracing` を使用 — `println!` や `eprintln!` は使用しない

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

### テスト

- 各ソースファイル内の `#[cfg(test)]` モジュールにユニットテストを記述する
- `tests/` ディレクトリに実際のPostgreSQL（TestcontainersまたはDocker）を使用した統合テストを記述する
- 自動マイグレーションとロールバック付きのデータベーステストには `#[sqlx::test]` を使用する
- 外部サービスのモックには `mockall` または `wiremock` を使用する

### コードスタイル

- 最大行長: 100文字（rustfmtにより強制）
- インポートのグループ化: `std`、外部クレート、`crate`/`super` — 空白行で区切る
- モジュール: モジュールごとに1ファイル、`mod.rs` は再エクスポートのみ
- 型: PascalCase、関数/変数: snake_case、定数: UPPER_SNAKE_CASE

## ファイル構成

```
src/
  main.rs              # エントリーポイント、サーバーセットアップ、グレースフルシャットダウン
  lib.rs               # 統合テスト用の再エクスポート
  config.rs            # envyまたはfigmentによる環境設定
  router.rs            # すべてのルートを持つAxumルーター
  middleware/
    auth.rs            # JWT抽出とバリデーション
    logging.rs         # リクエスト/レスポンスのトレーシング
  handlers/
    mod.rs             # ルートハンドラー（薄く — サービスに委任）
    users.rs
    orders.rs
  services/
    mod.rs             # ビジネスロジック
    users.rs
    orders.rs
  repositories/
    mod.rs             # データベースアクセス（SQLxクエリ）
    users.rs
    orders.rs
  domain/
    mod.rs             # ドメイン型、エラーenum
    user.rs
    order.rs
migrations/
  001_create_users.sql
  002_create_orders.sql
tests/
  common/mod.rs        # 共有テストヘルパー、テストサーバーセットアップ
  api_users.rs         # ユーザーエンドポイントの統合テスト
  api_orders.rs        # 注文エンドポイントの統合テスト
```

## 主要なパターン

### ハンドラー（薄く）

```rust
async fn create_user(
    State(ctx): State<AppState>,
    Json(payload): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<UserResponse>), AppError> {
    let user = ctx.user_service.create(payload).await?;
    Ok((StatusCode::CREATED, Json(UserResponse::from(user))))
}
```

### サービス（ビジネスロジック）

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

### リポジトリ（データアクセス）

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

### 統合テスト

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
    // 最初のユーザーを作成
    create_test_user(&app, "alice@example.com").await;
    // 重複を試みる
    let response = create_user_request(&app, "alice@example.com").await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
```

## 環境変数

```bash
# サーバー
HOST=0.0.0.0
PORT=8080
RUST_LOG=info,tower_http=debug

# データベース
DATABASE_URL=postgres://user:pass@localhost:5432/myapp

# 認証
JWT_SECRET=your-secret-key-min-32-chars
JWT_EXPIRY_HOURS=24

# 任意
CORS_ALLOWED_ORIGINS=http://localhost:3000
```

## テスト戦略

```bash
# すべてのテストを実行
cargo test

# 出力付きで実行
cargo test -- --nocapture

# 特定のテストモジュールを実行
cargo test api_users

# カバレッジチェック（cargo-llvm-covが必要）
cargo llvm-cov --html
open target/llvm-cov/html/index.html

# リント
cargo clippy -- -D warnings

# フォーマットチェック
cargo fmt -- --check
```

## ECCワークフロー

```bash
# 計画
/plan "Add order fulfillment with Stripe payment"

# TDDによる開発
/tdd                    # cargo test ベースのTDDワークフロー

# レビュー
/code-review            # Rust固有のコードレビュー
/security-scan          # 依存関係監査 + unsafeスキャン

# 検証
/verify                 # ビルド、clippy、テスト、セキュリティスキャン
```

## Git ワークフロー

- `feat:` 新機能、`fix:` バグ修正、`refactor:` コード変更
- `main` からフィーチャーブランチを切り、PRが必要
- CI: `cargo fmt --check`, `cargo clippy`, `cargo test`, `cargo audit`
- デプロイ: `scratch` または `distroless` ベースのDockerマルチステージビルド
