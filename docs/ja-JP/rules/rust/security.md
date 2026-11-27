---
paths:
  - "**/*.rs"
---
# Rust セキュリティ

> このファイルは [common/security.md](../common/security.md) を Rust 固有のコンテンツで拡張します。

## シークレット管理

- API キー、トークン、資格情報をソースコードにハードコードしない
- 環境変数を使用する: `std::env::var("API_KEY")`
- 必要なシークレットが起動時に欠落している場合は即座に失敗する
- `.env` ファイルは `.gitignore` に含める

```rust
// 悪い例
const API_KEY: &str = "sk-abc123...";

// 良い例 — 早期バリデーション付きの環境変数
fn load_api_key() -> anyhow::Result<String> {
    std::env::var("PAYMENT_API_KEY")
        .context("PAYMENT_API_KEY must be set")
}
```

## SQL インジェクション防止

- 常にパラメータ化クエリを使用する — ユーザー入力を SQL 文字列にフォーマットしない
- バインドパラメータ付きのクエリビルダーまたは ORM（sqlx、diesel、sea-orm）を使用する

```rust
// 悪い例 — フォーマット文字列による SQL インジェクション
let query = format!("SELECT * FROM users WHERE name = '{name}'");
sqlx::query(&query).fetch_one(&pool).await?;

// 良い例 — sqlx によるパラメータ化クエリ
// プレースホルダ構文はバックエンドにより異なる: Postgres: $1  |  MySQL: ?  |  SQLite: $1
sqlx::query("SELECT * FROM users WHERE name = $1")
    .bind(&name)
    .fetch_one(&pool)
    .await?;
```

## 入力バリデーション

- 処理前にシステム境界ですべてのユーザー入力を検証する
- 型システムを使用して不変条件を強制する（newtype パターン）
- バリデーションではなくパースする — 境界で非構造化データを型付き構造体に変換する
- 無効な入力は明確なエラーメッセージで拒否する

```rust
// バリデーションではなくパースする — 無効な状態は表現不可能
pub struct Email(String);

impl Email {
    pub fn parse(input: &str) -> Result<Self, ValidationError> {
        let trimmed = input.trim();
        let at_pos = trimmed.find('@')
            .filter(|&p| p > 0 && p < trimmed.len() - 1)
            .ok_or_else(|| ValidationError::InvalidEmail(input.to_string()))?;
        let domain = &trimmed[at_pos + 1..];
        if trimmed.len() > 254 || !domain.contains('.') {
            return Err(ValidationError::InvalidEmail(input.to_string()));
        }
        // 本番環境では、バリデーション済みメールクレート（例: `email_address`）の使用を推奨
        Ok(Self(trimmed.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}
```

## アンセーフコード

- `unsafe` ブロックを最小限にする — 安全な抽象化を優先する
- すべての `unsafe` ブロックには不変条件を説明する `// SAFETY:` コメントが必要
- 利便性のためにボローチェッカーを迂回するために `unsafe` を使用しない
- レビュー時にすべての `unsafe` コードを監査する — 正当な理由なしに使用するのは危険信号である
- C ライブラリには `safe` な FFI ラッパーを優先する

```rust
// 良い例 — safety コメントが必要なすべての不変条件を文書化
let widget: &Widget = {
    // SAFETY: `ptr` は non-null、アライン済み、初期化された Widget を指し、
    // そのライフタイム中にミュータブル参照やミューテーションは存在しない。
    unsafe { &*ptr }
};

// 悪い例 — safety の正当化がない
unsafe { &*ptr }
```

## 依存関係のセキュリティ

- `cargo audit` を実行して依存関係の既知の CVE をスキャンする
- `cargo deny check` でライセンスとアドバイザリのコンプライアンスを確認する
- `cargo tree` で推移的依存関係を監査する
- 依存関係を最新に保つ — Dependabot または Renovate を設定する
- 依存関係数を最小限にする — 新しいクレートを追加する前に評価する

```bash
# セキュリティ監査
cargo audit

# アドバイザリ、重複バージョン、制限付きライセンスの拒否
cargo deny check

# 依存関係ツリーの検査
cargo tree
cargo tree -d  # 重複のみ表示
```

## エラーメッセージ

- API レスポンスに内部パス、スタックトレース、データベースエラーを公開しない
- 詳細なエラーはサーバー側でログに記録する。クライアントには汎用メッセージを返す
- 構造化されたサーバー側ロギングには `tracing` または `log` を使用する

```rust
// エラーを適切なステータスコードと汎用メッセージにマッピングする
// （例では axum を使用。レスポンス型はフレームワークに合わせて調整する）
match order_service.find_by_id(id) {
    Ok(order) => Ok((StatusCode::OK, Json(order))),
    Err(ServiceError::NotFound(_)) => {
        tracing::info!(order_id = id, "order not found");
        Err((StatusCode::NOT_FOUND, "Resource not found"))
    }
    Err(e) => {
        tracing::error!(order_id = id, error = %e, "unexpected error");
        Err((StatusCode::INTERNAL_SERVER_ERROR, "Internal server error"))
    }
}
```

## 参考

アンセーフコードのガイドラインと所有権パターンについてはスキル: `rust-patterns` を参照。
一般的なセキュリティチェックリストについてはスキル: `security-review` を参照。
