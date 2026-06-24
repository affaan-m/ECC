---
paths:
  - "**/*.rs"
---
# Rust テスト

> このファイルは [common/testing.md](../common/testing.md) を Rust 固有のコンテンツで拡張します。

## テストフレームワーク

- ユニットテストには `#[cfg(test)]` モジュール内の **`#[test]`** を使用する
- パラメータ化テストとフィクスチャには **rstest** を使用する
- プロパティベーステストには **proptest** を使用する
- トレイトベースのモッキングには **mockall** を使用する
- 非同期テストには **`#[tokio::test]`** を使用する

## テストの構成

```text
my_crate/
├── src/
│   ├── lib.rs           # #[cfg(test)] モジュール内のユニットテスト
│   ├── auth/
│   │   └── mod.rs       # #[cfg(test)] mod tests { ... }
│   └── orders/
│       └── service.rs   # #[cfg(test)] mod tests { ... }
├── tests/               # 統合テスト（各ファイル = 個別のバイナリ）
│   ├── api_test.rs
│   ├── db_test.rs
│   └── common/          # 共有テストユーティリティ
│       └── mod.rs
└── benches/             # Criterion ベンチマーク
    └── benchmark.rs
```

ユニットテストは同じファイル内の `#[cfg(test)]` モジュールに配置する。統合テストは `tests/` に配置する。

## ユニットテストのパターン

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_user_with_valid_email() {
        let user = User::new("Alice", "alice@example.com").unwrap();
        assert_eq!(user.name, "Alice");
    }

    #[test]
    fn rejects_invalid_email() {
        let result = User::new("Bob", "not-an-email");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("invalid email"));
    }
}
```

## パラメータ化テスト

```rust
use rstest::rstest;

#[rstest]
#[case("hello", 5)]
#[case("", 0)]
#[case("rust", 4)]
fn test_string_length(#[case] input: &str, #[case] expected: usize) {
    assert_eq!(input.len(), expected);
}
```

## 非同期テスト

```rust
#[tokio::test]
async fn fetches_data_successfully() {
    let client = TestClient::new().await;
    let result = client.get("/data").await;
    assert!(result.is_ok());
}
```

## mockall によるモッキング

本番コードでトレイトを定義し、テストモジュールでモックを生成する:

```rust
// 本番トレイト — 統合テストがインポートできるように pub にする
pub trait UserRepository {
    fn find_by_id(&self, id: u64) -> Option<User>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockall::predicate::eq;

    mockall::mock! {
        pub Repo {}
        impl UserRepository for Repo {
            fn find_by_id(&self, id: u64) -> Option<User>;
        }
    }

    #[test]
    fn service_returns_user_when_found() {
        let mut mock = MockRepo::new();
        mock.expect_find_by_id()
            .with(eq(42))
            .times(1)
            .returning(|_| Some(User { id: 42, name: "Alice".into() }));

        let service = UserService::new(Box::new(mock));
        let user = service.get_user(42).unwrap();
        assert_eq!(user.name, "Alice");
    }
}
```

## テストの命名

シナリオを説明する記述的な名前を使用する:
- `creates_user_with_valid_email()`
- `rejects_order_when_insufficient_stock()`
- `returns_none_when_not_found()`

## カバレッジ

- 80%以上の行カバレッジを目標にする
- カバレッジレポートには **cargo-llvm-cov** を使用する
- ビジネスロジックに集中する — 生成コードと FFI バインディングは除外する

```bash
cargo llvm-cov                       # サマリー
cargo llvm-cov --html                # HTML レポート
cargo llvm-cov --fail-under-lines 80 # しきい値以下で失敗
```

## テストコマンド

```bash
cargo test                       # すべてのテストを実行
cargo test -- --nocapture        # println 出力を表示
cargo test test_name             # パターンに一致するテストを実行
cargo test --lib                 # ユニットテストのみ
cargo test --test api_test       # 特定の統合テスト（tests/api_test.rs）
cargo test --doc                 # ドキュメントテストのみ
```

## 参考

プロパティベーステスト、フィクスチャ、Criterion によるベンチマークを含む包括的なテストパターンについてはスキル: `rust-testing` を参照。
