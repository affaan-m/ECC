---
name: cpp-testing
description: 仅用于编写/更新/修复C++测试、配置GoogleTest/CTest、诊断失败或不稳定的测试，或添加覆盖率/消毒器时使用。
origin: ECC
---

# C++ 测试（代理技能）

针对现代 C++（C++17/20）的代理导向测试工作流，使用 GoogleTest/GoogleMock 和 CMake/CTest。

## 使用时机

* 编写新的 C++ 测试或修复现有测试
* 为 C++ 组件设计单元/集成测试覆盖
* 添加测试覆盖、CI 门控或回归保护
* 配置 CMake/CTest 工作流以实现一致的执行
* 调查测试失败或偶发性行为
* 启用用于内存/竞态诊断的消毒剂

### 不适用时机

* 在不修改测试的情况下实现新的产品功能
* 与测试覆盖或失败无关的大规模重构
* 没有测试回归需要验证的性能调优
* 非 C++ 项目或非测试任务

## 核心概念

* **TDD 循环**：红 → 绿 → 重构（先写测试，最小化修复，然后清理）。
* **隔离**：优先使用依赖注入和仿制品，而非全局状态。
* **测试布局**：`tests/unit`、`tests/integration`、`tests/testdata`。
* **Mock 与 Fake**：Mock 用于交互，Fake 用于有状态行为。
* **CTest 发现**：使用 `gtest_discover_tests()` 进行稳定的测试发现。
* **CI 信号**：先运行子集，然后使用 `--output-on-failure` 运行完整套件。

## TDD 工作流

遵循 RED → GREEN → REFACTOR 循环：

1. **RED**：编写一个捕获新行为的失败测试
2. **GREEN**：实现最小的更改以使其通过
3. **REFACTOR**：在测试保持通过的同时进行清理

```cpp
// tests/add_test.cpp
#include <gtest/gtest.h>

int Add(int a, int b); // Provided by production code.

TEST(AddTest, AddsTwoNumbers) { // RED
  EXPECT_EQ(Add(2, 3), 5);
}

// src/add.cpp
int Add(int a, int b) { // GREEN
  return a + b;
}

// REFACTOR: simplify/rename once tests pass
```

## 代码示例

### 基础单元测试 (gtest)

```cpp
// tests/calculator_test.cpp
#include <gtest/gtest.h>

int Add(int a, int b); // Provided by production code.

TEST(CalculatorTest, AddsTwoNumbers) {
    EXPECT_EQ(Add(2, 3), 5);
}
```

### 夹具 (gtest)

```cpp
// tests/user_store_test.cpp
// Pseudocode stub: replace UserStore/User with project types.
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

### Mock (gmock)

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

### CMake/CTest 快速入门

```cmake
# CMakeLists.txt (excerpt)
cmake_minimum_required(VERSION 3.20)
project(example LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
# Prefer project-locked versions. If using a tag, use a pinned version per project policy.
set(GTEST_VERSION v1.17.0) # Adjust to project policy.
FetchContent_Declare(
  googletest
  # Google Test framework (official repository)
  URL https://github.com/google/googletest/archive/refs/tags/${GTEST_VERSION}.zip
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

## 运行测试

```bash
ctest --test-dir build --output-on-failure
ctest --test-dir build -R ClampTest
ctest --test-dir build -R "UserStoreTest.*" --output-on-failure
```

```bash
./build/example_tests --gtest_filter=ClampTest.*
./build/example_tests --gtest_filter=UserStoreTest.FindsExistingUser
```

## 调试失败

1. 使用 gtest 过滤器重新运行单个失败的测试。
2. 在失败的断言周围添加作用域日志记录。
3. 启用消毒剂后重新运行。
4. 根本原因修复后，扩展到完整套件。

## 覆盖率

优先使用目标级别的设置，而非全局标志。

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

GCC + gcov + lcov：

```bash
cmake -S . -B build-cov -DENABLE_COVERAGE=ON
cmake --build build-cov -j
ctest --test-dir build-cov
lcov --capture --directory build-cov --output-file coverage.info
lcov --remove coverage.info '/usr/*' --output-file coverage.info
genhtml coverage.info --output-directory coverage
```

Clang + llvm-cov：

```bash
cmake -S . -B build-llvm -DENABLE_COVERAGE=ON -DCMAKE_CXX_COMPILER=clang++
cmake --build build-llvm -j
LLVM_PROFILE_FILE="build-llvm/default.profraw" ctest --test-dir build-llvm
llvm-profdata merge -sparse build-llvm/default.profraw -o build-llvm/default.profdata
llvm-cov report build-llvm/example_tests -instr-profile=build-llvm/default.profdata
```

## 消毒剂

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

## 偶发性测试防护

* 切勿使用 `sleep` 进行同步；使用条件变量或门闩。
* 为每个测试创建唯一的临时目录并始终清理它们。
* 避免在单元测试中依赖真实时间、网络或文件系统。
* 对随机化输入使用确定性种子。

## 最佳实践

### 应该做

* 保持测试的确定性和隔离性
* 优先使用依赖注入而非全局变量
* 对前置条件使用 `ASSERT_*`，对多个检查使用 `EXPECT_*`
* 在 CTest 标签或目录中分离单元测试与集成测试
* 在 CI 中运行消毒剂以进行内存和竞态检测

### 不应该做

* 不要在单元测试中依赖真实时间或网络
* 当可以使用条件变量时，不要使用睡眠作为同步手段
* 不要过度模拟简单的值对象
* 不要对非关键日志使用脆弱的字符串匹配

### 常见陷阱

* **使用固定的临时路径** → 为每个测试生成唯一的临时目录并清理它们。
* **依赖挂钟时间** → 注入时钟或使用模拟时间源。
* **偶发性并发测试** → 使用条件变量/门闩和有界等待。
* **隐藏的全局状态** → 在夹具中重置全局状态或移除全局变量。
* **过度模拟** → 对有状态行为优先使用 Fake，仅对交互进行 Mock。
* **缺少消毒剂运行** → 在 CI 中添加 ASan/UBSan/TSan 构建。
* **仅在调试版本上计算覆盖率** → 确保覆盖率目标使用一致的标志。

## 可选附录：模糊测试 / 属性测试

仅在项目已支持 LLVM/libFuzzer 或属性测试库时使用。

* **libFuzzer**：最适合 I/O 最少的纯函数。
* **RapidCheck**：基于属性的测试，用于验证不变量。

最小的 libFuzzer 测试框架（伪代码：替换 ParseConfig）：

```cpp
#include <cstddef>
#include <cstdint>
#include <string>

extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
    std::string input(reinterpret_cast<const char *>(data), size);
    // ParseConfig(input); // project function
    return 0;
}
```

## GoogleTest 的替代方案

* **Catch2**：仅头文件，表达性强的匹配器
* **doctest**：轻量级，编译开销最小
