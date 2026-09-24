---
description: Rustビルドエラー、ボローチェッカーの問題、依存関係の問題をインクリメンタルに修正します。最小限の外科的修正のためにrust-build-resolverエージェントを呼び出します。
---

# Rustビルドと修正

このコマンドは**rust-build-resolver**エージェントを呼び出し、Rustビルドエラーを最小限の変更でインクリメンタルに修正します。

## このコマンドの動作

1. **診断を実行**: `cargo check`、`cargo clippy`、`cargo fmt --check`を実行
2. **エラーを解析**: エラーコードと影響を受けるファイルを特定
3. **インクリメンタルに修正**: 一度に1つのエラー
4. **各修正を検証**: 各変更後に`cargo check`を再実行
5. **サマリーを報告**: 修正されたものと残りを表示

## 使用するタイミング

`/rust-build`を使用するのは:
- `cargo build`または`cargo check`がエラーで失敗する場合
- `cargo clippy`が警告を報告する場合
- ボローチェッカーやライフタイムエラーがコンパイルをブロックする場合
- Cargo依存関係の解決が失敗する場合
- ビルドを壊す変更をプルした後

## 実行される診断コマンド

```bash
# プライマリビルドチェック
cargo check 2>&1

# リントと提案
cargo clippy -- -D warnings 2>&1

# フォーマットチェック
cargo fmt --check 2>&1

# 依存関係の問題
cargo tree --duplicates

# セキュリティ監査（利用可能な場合）
if command -v cargo-audit >/dev/null; then cargo audit; else echo "cargo-audit not installed"; fi
```

## セッション例

````text
User: /rust-build

Agent:
# Rustビルド解決

## 初期診断

```bash
$ cargo check
error[E0502]: cannot borrow `map` as mutable because it is also borrowed as immutable
  --> src/service/cache.rs:25:5
error[E0308]: mismatched types
  --> src/handler/api.rs:42:12
error[E0425]: cannot find value `db` in this scope
  --> src/handler/api.rs:58:9
```

検出されたエラー: 3

## 修正 1: ボローチェッカーエラー

File: src/service/cache.rs:25
Error: E0502 — イミュータブルとしてもボローされているため、`map`をミュータブルとしてボローできない
Cause: ミュータブルなinsert中にイミュータブルなボローがまだアクティブ

```rust
// 変更: ミュータブルアクセス前にイミュータブルなボローを終了するよう再構築
if !map.contains_key("key") {
    map.insert("key".into(), default);
}
```

```bash
$ cargo check
# 残りエラー: 2
```

## 修正 2: 型の不一致

File: src/handler/api.rs:42
Error: E0308 — mismatched types: expected `usize`, found `&str`

```rust
// 変更前
let count = params.get("count");
// 変更後
let count: usize = params.get("count")
    .and_then(|s| s.parse().ok())
    .unwrap_or(0);
```

```bash
$ cargo check
# 残りエラー: 1
```

## 修正 3: 未解決の名前

File: src/handler/api.rs:58
Error: E0425 — cannot find value `db` in this scope
Cause: importの欠落

```rust
// 追加
use crate::db;
```

```bash
$ cargo check
# ビルド成功！
```

## 最終検証

```bash
$ cargo clippy -- -D warnings
# 警告なし

$ cargo test
running 6 tests
test service::cache::tests::test_insert ... ok
test service::cache::tests::test_get ... ok
test handler::api::tests::test_parse_count ... ok
test handler::api::tests::test_missing_count ... ok
test handler::api::tests::test_db_import ... ok
test handler::api::tests::test_response ... ok

test result: ok. 6 passed; 0 failed; 0 ignored
```

## サマリー

| メトリクス | 件数 |
|-----------|------|
| 修正されたビルドエラー | 3 |
| 修正されたClippy警告 | 0 |
| 変更されたファイル | 2 |
| 残りの問題 | 0 |

ビルドステータス: SUCCESS
````

## 一般的に修正されるエラー

| エラー | 典型的な修正 |
|--------|-------------|
| `cannot borrow as mutable` | イミュータブルなボローを先に終了するよう再構築。cloneは正当化された場合のみ |
| `does not live long enough` | 所有型を使用またはライフタイム注釈を追加 |
| `cannot move out of` | 所有権を取るよう再構築。cloneは最後の手段としてのみ |
| `mismatched types` | `.into()`、`as`、または明示的な変換を追加 |
| `trait X not implemented` | `#[derive(Trait)]`を追加または手動で実装 |
| `unresolved import` | Cargo.tomlに追加または`use`パスを修正 |
| `cannot find value` | importを追加またはパスを修正 |

## 修正戦略

1. **ビルドエラーを最初に** — コードがコンパイルされなければならない
2. **Clippy警告を次に** — 疑わしい構造を修正
3. **フォーマットを3番目に** — `cargo fmt`準拠
4. **一度に1つの修正** — 各変更を検証
5. **最小限の変更** — リファクタリングせず、修正のみ

## 停止条件

エージェントは以下の場合に停止して報告する:
- 3回の試行後も同じエラーが持続
- 修正がより多くのエラーを導入
- アーキテクチャ変更が必要
- ボローチェッカーエラーがデータ所有権の再設計を必要とする

## 関連コマンド

- `/rust-test` — ビルド成功後にテストを実行
- `/rust-review` — コード品質をレビュー
- `verification-loop`スキル — 完全な検証ループ

## 関連

- エージェント: `agents/rust-build-resolver.md`
- スキル: `skills/rust-patterns/`
