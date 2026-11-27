---
paths:
  - "**/*.rs"
---
# Rust コーディングスタイル

> このファイルは [common/coding-style.md](../common/coding-style.md) を Rust 固有のコンテンツで拡張します。

## フォーマット

- 強制には **rustfmt** を使用 — コミット前に必ず `cargo fmt` を実行する
- リントには **clippy** を使用 — `cargo clippy -- -D warnings`（警告をエラーとして扱う）
- 4スペースインデント（rustfmt デフォルト）
- 最大行幅: 100文字（rustfmt デフォルト）

## 不変性

Rust の変数はデフォルトで不変 — これを活用する:

- デフォルトで `let` を使用する。ミューテーションが必要な場合にのみ `let mut` を使用する
- その場でのミューテーションよりも新しい値を返すことを優先する
- 関数が割り当てる必要があるかどうかわからない場合は `Cow<'_, T>` を使用する

```rust
use std::borrow::Cow;

// 良い例 — デフォルトで不変、新しい値を返す
fn normalize(input: &str) -> Cow<'_, str> {
    if input.contains(' ') {
        Cow::Owned(input.replace(' ', "_"))
    } else {
        Cow::Borrowed(input)
    }
}

// 悪い例 — 不要なミューテーション
fn normalize_bad(input: &mut String) {
    *input = input.replace(' ', "_");
}
```

## 命名

標準的な Rust の規約に従う:
- 関数、メソッド、変数、モジュール、クレートには `snake_case`
- 型、トレイト、列挙型、型パラメータには `PascalCase`（UpperCamelCase）
- 定数とスタティックには `SCREAMING_SNAKE_CASE`
- ライフタイム: 短い小文字（`'a`、`'de`）— 複雑な場合は説明的な名前（`'input`）

## 所有権と借用

- デフォルトで借用（`&T`）する。格納または消費する必要がある場合にのみ所有権を取得する
- 根本原因を理解せずにボローチェッカーを満たすためにクローンしない
- 関数パラメータでは `String` よりも `&str`、`Vec<T>` よりも `&[T]` を受け入れる
- `String` を所有する必要があるコンストラクタには `impl Into<String>` を使用する

```rust
// 良い例 — 所有権が不要な場合は借用する
fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

// 良い例 — Into を使用してコンストラクタで所有権を取得する
fn new(name: impl Into<String>) -> Self {
    Self { name: name.into() }
}

// 悪い例 — &str で十分なのに String を取得する
fn word_count_bad(text: String) -> usize {
    text.split_whitespace().count()
}
```

## エラーハンドリング

- 伝搬には `Result<T, E>` と `?` を使用する — 本番コードでは `unwrap()` を使わない
- **ライブラリ**: `thiserror` で型付きエラーを定義する
- **アプリケーション**: 柔軟なエラーコンテキストには `anyhow` を使用する
- `.with_context(|| format!("failed to ..."))?` でコンテキストを追加する
- `unwrap()` / `expect()` はテストと本当に到達不可能な状態にのみ使用する

```rust
// 良い例 — thiserror によるライブラリエラー
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("failed to read config: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid config format: {0}")]
    Parse(String),
}

// 良い例 — anyhow によるアプリケーションエラー
use anyhow::Context;

fn load_config(path: &str) -> anyhow::Result<Config> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {path}"))?;
    toml::from_str(&content)
        .with_context(|| format!("failed to parse {path}"))
}
```

## ループよりもイテレータ

変換にはイテレータチェーンを優先する。複雑な制御フローにはループを使用する:

```rust
// 良い例 — 宣言的で合成可能
let active_emails: Vec<&str> = users.iter()
    .filter(|u| u.is_active)
    .map(|u| u.email.as_str())
    .collect();

// 良い例 — 早期リターンを伴う複雑なロジックにはループ
for user in &users {
    if let Some(verified) = verify_email(&user.email)? {
        send_welcome(&verified)?;
    }
}
```

## モジュール構成

型ごとではなく、ドメインごとに整理する:

```text
src/
├── main.rs
├── lib.rs
├── auth/           # ドメインモジュール
│   ├── mod.rs
│   ├── token.rs
│   └── middleware.rs
├── orders/         # ドメインモジュール
│   ├── mod.rs
│   ├── model.rs
│   └── service.rs
└── db/             # インフラストラクチャ
    ├── mod.rs
    └── pool.rs
```

## 可視性

- デフォルトはプライベート。内部共有には `pub(crate)` を使用する
- クレートのパブリック API の一部であるものだけに `pub` を付ける
- `lib.rs` からパブリック API を再エクスポートする

## 参考

包括的な Rust のイディオムとパターンについてはスキル: `rust-patterns` を参照。
