---
paths:
  - "**/*.rs"
  - "**/Cargo.toml"
---
# Rust フック

> このファイルは [common/hooks.md](../common/hooks.md) を Rust 固有のコンテンツで拡張します。

## PostToolUse フック

`~/.claude/settings.json` で設定する:

- **cargo fmt**: `.rs` ファイルを編集後に自動フォーマットする
- **cargo clippy**: Rust ファイルの編集後にリントチェックを実行する
- **cargo check**: 変更後にコンパイルを検証する（`cargo build` よりも高速）
