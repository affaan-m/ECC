---
description: C++のTDDワークフローを強制します。最初にGoogleTestテストを書き、その後実装します。gcov/lcovでカバレッジを検証します。
---

# C++ TDDコマンド

このコマンドはCMake/CTestとGoogleTest/GoogleMockを使用したC++コードのテスト駆動開発方法論を強制します。

## このコマンドの動作

1. **インターフェース定義**: クラス/関数のシグネチャを先にスキャフォールド
2. **テストを書く**: 包括的なGoogleTestテストケースを作成（RED）
3. **テストを実行**: テストが正しい理由で失敗することを検証
4. **コードを実装**: テストを通す最小限のコードを書く（GREEN）
5. **リファクタリング**: テストをグリーンに保ちながら改善
6. **カバレッジをチェック**: 80%以上のカバレッジを確保

## 使用するタイミング

`/cpp-test`を使用するのは:
- 新しいC++の関数やクラスを実装する時
- 既存コードにテストカバレッジを追加する時
- バグを修正する時（失敗するテストを最初に書く）
- 重要なビジネスロジックを構築する時
- C++でTDDワークフローを学ぶ時

## TDDサイクル

```
RED     → 失敗するGoogleTestテストを書く
GREEN   → テストを通す最小限のコードを実装
REFACTOR → コードを改善、テストはグリーンのまま
REPEAT  → 次のテストケースへ
```

## テストパターン

### 基本テスト
```cpp
TEST(SuiteName, TestName) {
    EXPECT_EQ(add(2, 3), 5);
    EXPECT_NE(result, nullptr);
    EXPECT_TRUE(is_valid);
    EXPECT_THROW(func(), std::invalid_argument);
}
```

### フィクスチャ
```cpp
class DatabaseTest : public ::testing::Test {
protected:
    void SetUp() override { db_ = create_test_db(); }
    void TearDown() override { db_.reset(); }
    std::unique_ptr<Database> db_;
};

TEST_F(DatabaseTest, InsertsRecord) {
    db_->insert("key", "value");
    EXPECT_EQ(db_->get("key"), "value");
}
```

### パラメータ化テスト
```cpp
class PrimeTest : public ::testing::TestWithParam<std::pair<int, bool>> {};

TEST_P(PrimeTest, ChecksPrimality) {
    auto [input, expected] = GetParam();
    EXPECT_EQ(is_prime(input), expected);
}

INSTANTIATE_TEST_SUITE_P(Primes, PrimeTest, ::testing::Values(
    std::make_pair(2, true),
    std::make_pair(4, false),
    std::make_pair(7, true)
));
```

## カバレッジコマンド

```bash
# カバレッジ付きビルド
cmake -DCMAKE_CXX_FLAGS="--coverage" -DCMAKE_EXE_LINKER_FLAGS="--coverage" -B build

# テスト実行
cmake --build build && ctest --test-dir build

# カバレッジレポート生成
lcov --capture --directory build --output-file coverage.info
lcov --remove coverage.info '/usr/*' --output-file coverage.info
genhtml coverage.info --output-directory coverage_html
```

## カバレッジ目標

| コードの種類 | 目標 |
|-------------|------|
| 重要なビジネスロジック | 100% |
| パブリックAPI | 90%以上 |
| 一般コード | 80%以上 |
| 生成コード | 除外 |

## TDDベストプラクティス

**すべきこと:**
- 実装の前にテストを先に書く
- 各変更後にテストを実行
- 適切な場合は`ASSERT_*`（停止）より`EXPECT_*`（続行）を使用
- 実装の詳細ではなく動作をテスト
- エッジケースを含める（空、null、最大値、境界条件）

**すべきでないこと:**
- テストの前に実装を書く
- RED段階をスキップ
- プライベートメソッドを直接テスト（パブリックAPIを通じてテスト）
- テストで`sleep`を使用
- フレイキーなテストを無視

## 関連コマンド

- `/cpp-build` — ビルドエラーを修正
- `/cpp-review` — 実装後にコードをレビュー
- `verification-loop`スキル — 完全な検証ループを実行

## 関連

- スキル: `skills/cpp-testing/`
- スキル: `skills/tdd-workflow/`
