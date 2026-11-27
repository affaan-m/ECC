---
name: cpp-testing
description: C++ テストの作成/更新/修正、GoogleTest/CTest の設定、失敗またはフレーキーなテストの診断、カバレッジ/サニタイザーの追加時にのみ使用します。
---

# C++ Testing（エージェントスキル）

CMake/CTest を使用した GoogleTest/GoogleMock による最新の C++（C++17/20）向けのエージェント重視のテストワークフローです。

## 使用タイミング

- 新しい C++ テストの作成または既存のテストの修正
- C++ コンポーネントのユニット/統合テストカバレッジの設計
- テストカバレッジ、CI ゲーティング、リグレッション保護の追加
- 一貫した実行のための CMake/CTest ワークフローの設定
- テスト失敗またはフレーキーな動作の調査
- メモリ/レース診断のためのサニタイザーの有効化

### 使用すべきでない場合

- テスト変更を伴わない新しい製品機能の実装
- テストカバレッジや失敗に関連しない大規模なリファクタリング
- 検証するテストリグレッションのないパフォーマンスチューニング
- C++ 以外のプロジェクトまたはテスト以外のタスク

## コア概念

- **TDD ループ**: red → green → refactor（テスト優先、最小限の修正、その後クリーンアップ）
- **分離**: グローバル状態よりも依存性注入とフェイクを優先
- **テストレイアウト**: `tests/unit`、`tests/integration`、`tests/testdata`
- **モック vs フェイク**: 相互作用にはモック、ステートフルな動作にはフェイク
- **CTest ディスカバリー**: 安定したテストディスカバリーのために `gtest_discover_tests()` を使用
- **CI シグナル**: 最初にサブセットを実行し、次に `--output-on-failure` でフルスイートを実行

## TDD ワークフロー

RED → GREEN → REFACTOR ループに従います：

1. **RED**: 新しい動作をキャプチャする失敗するテストを書く
2. **GREEN**: 合格する最小限の変更を実装する
3. **REFACTOR**: テストがグリーンのままクリーンアップする

```cpp
// tests/add_test.cpp
#include <gtest/gtest.h>

int Add(int a, int b); // プロダクションコードによって提供されます。

TEST(AddTest, AddsTwoNumbers) { // RED
  EXPECT_EQ(Add(2, 3), 5);
}

// src/add.cpp
int Add(int a, int b) { // GREEN
  return a + b;
}

// REFACTOR: テストが合格したら簡素化/名前変更
```

## コード例

### 基本的なユニットテスト（gtest）

```cpp
// tests/calculator_test.cpp
#include <gtest/gtest.h>

int Add(int a, int b); // プロダクションコードによって提供されます。

TEST(CalculatorTest, AddsTwoNumbers) {
    EXPECT_EQ(Add(2, 3), 5);
}
```

### フィクスチャ（gtest）

```cpp
// tests/user_store_test.cpp
// 擬似コードスタブ: UserStore/User をプロジェクトの型に置き換えてください。
#include <gtest/gtest.h>
#include <memory>
#include <optional>
#include <string>

struct User { std::string name; };
class UserStore {
public:
    explicit UserStore(std::string /*path*/) {}
    void Seed(std::initializer_list<User> /*users*/) {}
    std::optional<User> Find(const std::string &/*name*/) { return User{"alice"}; }
};

class UserStoreTest : public ::testing::Test {
protected:
    void SetUp() override {
        store = std::make_unique<UserStore>(":memory:");
        store->Seed({{"alice"}, {"bob"}});
    }

    std::unique_ptr<UserStore> store;
};

TEST_F(UserStoreTest, FindsExistingUser) {
    auto user = store->Find("alice");
    ASSERT_TRUE(user.has_value());
    EXPECT_EQ(user->name, "alice");
}
```

### モック（gmock）

```cpp
// tests/notifier_test.cpp
#include <gmock/gmock.h>
#include <gtest/gtest.h>
#include <string>

class Notifier {
public:
    virtual ~Notifier() = default;
    virtual void Send(const std::string &message) = 0;
};

class MockNotifier : public Notifier {
public:
    MOCK_METHOD(void, Send, (const std::string &message), (override));
};

class Service {
public:
    explicit Service(Notifier &notifier) : notifier_(notifier) {}
    void Publish(const std::string &message) { notifier_.Send(message); }

private:
    Notifier &notifier_;
};

TEST(ServiceTest, SendsNotifications) {
    MockNotifier notifier;
    Service service(notifier);

    EXPECT_CALL(notifier, Send("hello")).Times(1);
    service.Publish("hello");
}
```

### CMake/CTest クイックスタート

```cmake
# CMakeLists.txt（抜粋）
cmake_minimum_required(VERSION 3.20)
project(example LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
# プロジェクトロックされたバージョンを優先します。タグを使用する場合は、プロジェクトポリシーに従って固定されたバージョンを使用します。
set(GTEST_VERSION v1.17.0) # プロジェクトポリシーに合わせて調整します。
FetchContent_Declare(
  googletest
  URL Google Test framework (official repository) https://github.com/google/googletest/archive/refs/tags/${GTEST_VERSION}.zip
)
FetchContent_MakeAvailable(googletest)

add_executable(example_tests
  tests/calculator_test.cpp
  src/calculator.cpp
)
target_link_libraries(example_tests GTest::gtest GTest::gmock GTest::gtest_main)

enable_testing()
include(GoogleTest)
gtest_discover_tests(example_tests)
```

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j
ctest --test-dir build --output-on-failure
```

## テストの実行

```bash
ctest --test-dir build --output-on-failure
ctest --test-dir build -R ClampTest
ctest --test-dir build -R "UserStoreTest.*" --output-on-failure
```

```bash
./build/example_tests --gtest_filter=ClampTest.*
./build/example_tests --gtest_filter=UserStoreTest.FindsExistingUser
```

## 失敗のデバッグ

1. gtest フィルタで単一の失敗したテストを再実行します。
2. 失敗したアサーションの周りにスコープ付きログを追加します。
3. サニタイザーを有効にして再実行します。
4. 根本原因が修正されたら、フルスイートに拡張します。

## カバレッジ

グローバルフラグではなく、ターゲットレベルの設定を優先します。

```cmake
option(ENABLE_COVERAGE "Enable coverage flags" OFF)

if(ENABLE_COVERAGE)
  if(CMAKE_CXX_COMPILER_ID MATCHES "GNU")
    target_compile_options(example_tests PRIVATE --coverage)
    target_link_options(example_tests PRIVATE --coverage)
  elseif(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    target_compile_options(example_tests PRIVATE -fprofile-instr-generate -fcoverage-mapping)
    target_link_options(example_tests PRIVATE -fprofile-instr-generate)
  endif()
endif()
```

GCC + gcov + lcov:

```bash
cmake -S . -B build-cov -DENABLE_COVERAGE=ON
cmake --build build-cov -j
ctest --test-dir build-cov
lcov --capture --directory build-cov --output-file coverage.info
lcov --remove coverage.info '/usr/*' --output-file coverage.info
genhtml coverage.info --output-directory coverage
```

Clang + llvm-cov:

```bash
cmake -S . -B build-llvm -DENABLE_COVERAGE=ON -DCMAKE_CXX_COMPILER=clang++
cmake --build build-llvm -j
LLVM_PROFILE_FILE="build-llvm/default.profraw" ctest --test-dir build-llvm
llvm-profdata merge -sparse build-llvm/default.profraw -o build-llvm/default.profdata
llvm-cov report build-llvm/example_tests -instr-profile=build-llvm/default.profdata
```

## サニタイザー

```cmake
option(ENABLE_ASAN "Enable AddressSanitizer" OFF)
option(ENABLE_UBSAN "Enable UndefinedBehaviorSanitizer" OFF)
option(ENABLE_TSAN "Enable ThreadSanitizer" OFF)

if(ENABLE_ASAN)
  add_compile_options(-fsanitize=address -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address)
endif()
if(ENABLE_UBSAN)
  add_compile_options(-fsanitize=undefined -fno-omit-frame-pointer)
  add_link_options(-fsanitize=undefined)
endif()
if(ENABLE_TSAN)
  add_compile_options(-fsanitize=thread)
  add_link_options(-fsanitize=thread)
endif()
```

## フレーキーテストのガードレール

- 同期に `sleep` を使用しないでください。条件変数またはラッチを使用してください。
- 一時ディレクトリをテストごとに一意にし、常にクリーンアップしてください。
- ユニットテストで実際の時間、ネットワーク、ファイルシステムの依存関係を避けてください。
- ランダム化された入力には決定論的シードを使用してください。

## ベストプラクティス

### すべきこと

- テストを決定論的かつ分離されたものに保つ
- グローバル変数よりも依存性注入を優先する
- 前提条件には `ASSERT_*` を使用し、複数のチェックには `EXPECT_*` を使用する
- CTest ラベルまたはディレクトリでユニットテストと統合テストを分離する
- メモリとレース検出のために CI でサニタイザーを実行する

### すべきでないこと

- ユニットテストで実際の時間やネットワークに依存しない
- 条件変数を使用できる場合、同期としてスリープを使用しない
- 単純な値オブジェクトをオーバーモックしない
- 重要でないログに脆弱な文字列マッチングを使用しない

### よくある落とし穴

- **固定一時パスの使用** → テストごとに一意の一時ディレクトリを生成し、クリーンアップします。
- **ウォールクロック時間への依存** → クロックを注入するか、偽の時間ソースを使用します。
- **フレーキーな並行性テスト** → 条件変数/ラッチと境界付き待機を使用します。
- **隠れたグローバル状態** → フィクスチャでグローバル状態をリセットするか、グローバル変数を削除します。
- **オーバーモック** → ステートフルな動作にはフェイクを優先し、相互作用のみをモックします。
- **サニタイザー実行の欠落** → CI に ASan/UBSan/TSan ビルドを追加します。
- **デバッグのみのビルドでのカバレッジ** → カバレッジターゲットが一貫したフラグを使用することを確認します。

## オプションの付録: ファジングとプロパティテスト

プロジェクトがすでに LLVM/libFuzzer またはプロパティテストライブラリをサポートしている場合にのみ使用してください。

- **libFuzzer**: 最小限の I/O で純粋関数に最適です。
- **RapidCheck**: 不変条件を検証するプロパティベースのテストです。

最小限の libFuzzer ハーネス（擬似コード: ParseConfig を置き換えてください）：

```cpp
#include <cstddef>
#include <cstdint>
#include <string>

extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
    std::string input(reinterpret_cast<const char *>(data), size);
    // ParseConfig(input); // プロジェクト関数
    return 0;
}
```

## GoogleTest の代替

- **Catch2**: ヘッダーオンリー、表現力豊かなマッチャー
- **doctest**: 軽量、最小限のコンパイルオーバーヘッド
