---
description: RustにおけるTDDワークフローを強制します。テストを先に書き、その後に実装します。cargo-llvm-covで80%以上のカバレッジを検証します。
---

# Rust TDD コマンド

このコマンドは、`#[test]`、rstest、proptest、mockall を使用した Rust コードのテスト駆動開発手法を強制します。

## このコマンドの機能

1. **型/トレイトの定義**: `todo!()` で関数シグネチャをスキャフォールドする
2. **テストの作成**: 包括的なテストモジュールを作成する（RED）
3. **テストの実行**: テストが正しい理由で失敗することを確認する
4. **コードの実装**: テストを通過する最小限のコードを書く（GREEN）
5. **リファクタリング**: テストをグリーンに保ちながら改善する
6. **カバレッジの確認**: cargo-llvm-cov で80%以上のカバレッジを確保する

## 使用するタイミング

以下の場合に `/rust-test` を使用してください：
- 新しい Rust の関数、メソッド、トレイトを実装する場合
- 既存の Rust コードにテストカバレッジを追加する場合
- バグを修正する場合（先に失敗するテストを書く）
- 重要なビジネスロジックを構築する場合
- Rust での TDD ワークフローを学習する場合

## TDD サイクル

```
RED     -> 先に失敗するテストを書く
GREEN   -> テストを通過する最小限のコードを実装する
REFACTOR -> コードを改善し、テストはグリーンを維持する
REPEAT  -> 次のテストケースへ
```

## セッション例

````text
User: /rust-test ユーザー登録を検証する関数が必要です

エージェント:
# TDD セッション: 登録バリデーター

## ステップ 1: インターフェースの定義

```rust
// src/validator.rs
pub struct RegistrationRequest {
    pub name: String,
    pub email: String,
    pub password: String,
}

pub enum ValidationResult {
    Valid,
    Invalid(Vec<String>),
}

pub fn validate_registration(request: &RegistrationRequest) -> ValidationResult {
    todo!()
}
```

## ステップ 2: テストの作成（RED）

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_registration_returns_valid() {
        let request = RegistrationRequest {
            name: "Alice".into(),
            email: "alice@example.com".into(),
            password: "SecureP@ss1".into(),
        };
        assert!(matches!(validate_registration(&request), ValidationResult::Valid));
    }

    #[test]
    fn blank_name_returns_invalid() {
        let request = RegistrationRequest {
            name: "".into(),
            email: "alice@example.com".into(),
            password: "SecureP@ss1".into(),
        };
        match validate_registration(&request) {
            ValidationResult::Invalid(errors) => {
                assert!(errors.contains(&"Name is required".to_string()));
            }
            ValidationResult::Valid => panic!("expected Invalid"),
        }
    }

    #[test]
    fn invalid_email_returns_invalid() {
        let request = RegistrationRequest {
            name: "Alice".into(),
            email: "not-an-email".into(),
            password: "SecureP@ss1".into(),
        };
        assert!(matches!(
            validate_registration(&request),
            ValidationResult::Invalid(_)
        ));
    }

    #[test]
    fn short_password_returns_invalid() {
        let request = RegistrationRequest {
            name: "Alice".into(),
            email: "alice@example.com".into(),
            password: "short".into(),
        };
        assert!(matches!(
            validate_registration(&request),
            ValidationResult::Invalid(_)
        ));
    }
}
```

## ステップ 3: テストの実行 — 失敗を確認

```bash
$ cargo test
running 4 tests
test tests::valid_registration_returns_valid ... FAILED (not yet implemented)
test tests::blank_name_returns_invalid ... FAILED
test tests::invalid_email_returns_invalid ... FAILED
test tests::short_password_returns_invalid ... FAILED
```

テストは想定通り失敗しました（todo! パニック）。

## ステップ 4: 最小限のコードを実装（GREEN）

```rust
pub fn validate_registration(request: &RegistrationRequest) -> ValidationResult {
    let mut errors = Vec::new();

    if request.name.trim().is_empty() {
        errors.push("Name is required".into());
    }
    if !request.email.contains('@') {
        errors.push("Invalid email format".into());
    }
    if request.password.len() < 8 {
        errors.push("Password must be at least 8 characters".into());
    }

    if errors.is_empty() {
        ValidationResult::Valid
    } else {
        ValidationResult::Invalid(errors)
    }
}
```

## ステップ 5: テストの実行 — 成功を確認

```bash
$ cargo test
running 4 tests
test tests::valid_registration_returns_valid ... ok
test tests::blank_name_returns_invalid ... ok
test tests::invalid_email_returns_invalid ... ok
test tests::short_password_returns_invalid ... ok

test result: ok. 4 passed; 0 failed
```

すべてのテストが成功しました！

## ステップ 6: カバレッジの確認

```bash
$ cargo llvm-cov
Coverage: 100.0% of lines
```

カバレッジ: 100%

## TDD 完了！
````

## テストパターン

### ユニットテスト

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_two_numbers() {
        assert_eq!(add(2, 3), 5);
    }

    #[test]
    fn handles_error() -> Result<(), Box<dyn std::error::Error>> {
        let result = parse_config(r#"port = 8080"#)?;
        assert_eq!(result.port, 8080);
        Ok(())
    }
}
```

### rstest によるパラメータ化テスト

```rust
use rstest::{rstest, fixture};

#[rstest]
#[case("hello", 5)]
#[case("", 0)]
#[case("rust", 4)]
fn test_string_length(#[case] input: &str, #[case] expected: usize) {
    assert_eq!(input.len(), expected);
}
```

### 非同期テスト

```rust
#[tokio::test]
async fn fetches_data_successfully() {
    let client = TestClient::new().await;
    let result = client.get("/data").await;
    assert!(result.is_ok());
}
```

### プロパティベーステスト

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn encode_decode_roundtrip(input in ".*") {
        let encoded = encode(&input);
        let decoded = decode(&encoded).unwrap();
        assert_eq!(input, decoded);
    }
}
```

## カバレッジコマンド

```bash
# サマリーレポート
cargo llvm-cov

# HTMLレポート
cargo llvm-cov --html

# しきい値を下回った場合に失敗
cargo llvm-cov --fail-under-lines 80

# 特定のテストを実行
cargo test test_name

# 出力付きで実行
cargo test -- --nocapture

# 最初の失敗で停止しない
cargo test --no-fail-fast
```

## カバレッジ目標

| コードの種類 | 目標 |
|-----------|--------|
| 重要なビジネスロジック | 100% |
| パブリック API | 90%以上 |
| 一般的なコード | 80%以上 |
| 生成コード / FFI バインディング | 除外 |

## TDD ベストプラクティス

**すべきこと:**
- 実装の前にまずテストを書く
- 変更のたびにテストを実行する
- より良いエラーメッセージのために `assert!` よりも `assert_eq!` を使用する
- よりクリーンな出力のために `Result` を返すテストで `?` を使用する
- 実装ではなく振る舞いをテストする
- エッジケースを含める（空、境界値、エラーパス）

**すべきでないこと:**
- テストの前に実装を書く
- RED フェーズをスキップする
- `Result::is_err()` で対応できる場合に `#[should_panic]` を使用する
- テストで `sleep()` を使用する — チャネルまたは `tokio::time::pause()` を使用する
- すべてをモック化する — 可能な場合は統合テストを優先する

## 関連コマンド

- `/rust-build` - ビルドエラーの修正
- `/rust-review` - 実装後のコードレビュー
- `verification-loop` スキル - 完全な検証ループの実行

## 関連

- スキル: `skills/rust-testing/`
- スキル: `skills/rust-patterns/`
