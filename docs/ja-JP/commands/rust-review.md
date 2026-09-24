---
description: Rustコードの所有権、ライフタイム、エラーハンドリング、unsafeの使用、イディオマティックパターンに関する包括的なコードレビュー。rust-reviewerエージェントを呼び出します。
---

# Rustコードレビュー

このコマンドは**rust-reviewer**エージェントを呼び出し、Rust固有の包括的なコードレビューを行います。

## このコマンドの動作

1. **自動チェックを検証**: `cargo check`、`cargo clippy -- -D warnings`、`cargo fmt --check`、`cargo test`を実行 — いずれか失敗したら停止
2. **Rustの変更を特定**: `git diff HEAD~1`（PRの場合は`git diff main...HEAD`）で変更された`.rs`ファイルを検出
3. **セキュリティ監査を実行**: 利用可能な場合`cargo audit`を実行
4. **セキュリティスキャン**: unsafe使用、コマンドインジェクション、ハードコードされたシークレットを確認
5. **所有権レビュー**: 不要なclone、ライフタイムの問題、ボローイングパターンを分析
6. **レポートを生成**: 重大度別に問題を分類

## 使用するタイミング

`/rust-review`を使用するのは:
- Rustコードを書いたり変更した後
- Rustの変更をコミットする前
- Rustコードを含むプルリクエストをレビューする時
- 新しいRustコードベースにオンボーディングする時
- イディオマティックなRustパターンを学ぶ時

## レビューカテゴリ

### CRITICAL（修正必須）
- プロダクションコードパスでの未チェック`unwrap()`/`expect()`
- 不変条件を文書化する`// SAFETY:`コメントなしの`unsafe`
- クエリでの文字列補間によるSQLインジェクション
- `std::process::Command`での未検証入力によるコマンドインジェクション
- ハードコードされた認証情報
- rawポインタ経由のuse-after-free

### HIGH（修正すべき）
- ボローチェッカーを満たすための不要な`.clone()`
- `&str`や`impl AsRef<str>`で十分な場合の`String`パラメータ
- asyncコンテキストでのブロッキング（`std::thread::sleep`、`std::fs`）
- 共有型での`Send`/`Sync`バウンドの欠落
- ビジネスクリティカルなenumでのワイルドカード`_ =>`マッチ
- 大きな関数（50行超）

### MEDIUM（検討すべき）
- ホットパスでの不要なアロケーション
- サイズが既知の場合の`with_capacity`の欠落
- 正当化なしの抑制されたclippy警告
- `///`ドキュメントなしのパブリックAPI
- 値を無視することがバグになりやすい非`must_use`戻り値型での`#[must_use]`の検討

## 実行される自動チェック

```bash
# ビルドゲート（レビュー前に通る必要あり）
cargo check

# リントと提案
cargo clippy -- -D warnings

# フォーマット
cargo fmt --check

# テスト
cargo test

# セキュリティ監査（利用可能な場合）
if command -v cargo-audit >/dev/null; then cargo audit; else echo "cargo-audit not installed"; fi
```

## 使用例

````text
User: /rust-review

Agent:
# Rustコードレビューレポート

## レビュー対象ファイル
- src/service/user.rs（変更）
- src/handler/api.rs（変更）

## 静的解析結果
- ビルド: 成功
- Clippy: 警告なし
- フォーマット: 通過
- テスト: 全通過

## 検出された問題

[CRITICAL] プロダクションパスでの未チェックunwrap
File: src/service/user.rs:28
Issue: データベースクエリ結果に`.unwrap()`を使用
```rust
let user = db.find_by_id(id).unwrap();  // ユーザーが見つからない場合にパニック
```
Fix: コンテキスト付きでエラーを伝搬
```rust
let user = db.find_by_id(id)
    .context("failed to fetch user")?;
```

[HIGH] 不要なClone
File: src/handler/api.rs:45
Issue: ボローチェッカーを満たすためにStringをクローン
```rust
let name = user.name.clone();
process(&user, &name);
```
Fix: cloneを回避するよう再構築
```rust
let result = process_name(&user.name);
use_user(&user, result);
```

## サマリー
- CRITICAL: 1
- HIGH: 1
- MEDIUM: 0

推奨: CRITICALの問題が修正されるまでマージをブロック
````

## 承認基準

| ステータス | 条件 |
|-----------|------|
| 承認 | CRITICALまたはHIGHの問題がない |
| 警告 | MEDIUMの問題のみ（注意してマージ） |
| ブロック | CRITICALまたはHIGHの問題が検出 |

## 他のコマンドとの統合

- まず`/rust-test`を使用してテストが通ることを確認
- ビルドエラーが発生した場合は`/rust-build`を使用
- コミット前に`/rust-review`を使用
- Rust固有でない懸念には`/code-review`を使用

## 関連

- エージェント: `agents/rust-reviewer.md`
- スキル: `skills/rust-patterns/`、`skills/rust-testing/`
