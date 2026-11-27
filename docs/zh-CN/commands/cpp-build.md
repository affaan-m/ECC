---
description: 逐步修复C++构建错误、CMake问题和链接器问题。调用cpp-build-resolver代理进行最小化、精准的修复。
---

# C++ 构建与修复

此命令调用 **cpp-build-resolver** 代理，以最小的更改逐步修复 C++ 构建错误。

## 此命令的作用

1. **运行诊断**：执行 `cmake --build`、`clang-tidy`、`cppcheck`
2. **解析错误**：按文件分组并按严重性排序
3. **逐步修复**：一次修复一个错误
4. **验证每个修复**：每次更改后重新运行构建
5. **报告摘要**：显示已修复的内容和剩余的问题

## 何时使用

在以下情况下使用 `/cpp-build`：

* `cmake --build build` 因错误而失败时
* 链接器错误（未定义的引用，多重定义）
* 模板实例化失败
* 包含/依赖项问题
* 拉取更改后导致构建失败时

## 运行的诊断命令

```bash
# CMake configure
cmake -B build -S .

# Build
cmake --build build 2>&1 | head -100

# Static analysis (if available)
clang-tidy src/*.cpp -- -std=c++17
cppcheck --enable=all src/
```

## 示例会话

````text
# C++ 构建问题解决

## 初始诊断

```bash
$ cmake --build build
src/service/user.cpp:25:15: error: use of undeclared identifier 'UserRepository'
src/handler/api.cpp:42:9: error: no matching function for call to 'process'
src/handler/api.cpp:58:1: error: non-void function does not return a value

````

发现的错误：3

## 修复 1：未声明的标识符

文件：src/service/user.cpp:25
错误：使用了未声明的标识符 'UserRepository'
原因：缺少包含

```cpp
// Added include
#include "repository/user_repository.hpp"
```

```bash
$ cmake --build build
# 2 errors remaining
```

## 修复 2：无匹配函数

文件：src/handler/api.cpp:42
错误：没有匹配的函数用于调用 'process'

```cpp
// Changed
process(params.get("count"));
// To
process(std::stoi(params.get("count")));
```

```bash
$ cmake --build build
# 1 error remaining
```

## 修复 3：缺少返回

文件：src/handler/api.cpp:58
错误：非 void 函数未返回值

```cpp
std::optional<User> getUser(const std::string& id) {
    if (id.empty()) {
        return std::nullopt;
    }
    auto user = findUser(id);
    // Added missing return
    return user;
}
```

```bash
$ cmake --build build
# Build successful!
```

## 最终验证

```bash
$ ctest --test-dir build --output-on-failure
Test project build
    1/5 Test #1: unit_tests ........   Passed    0.02 sec
    2/5 Test #2: integration_tests    Passed    0.15 sec
All tests passed.
```

## 摘要

| 指标 | 数量 |
|--------|-------|
| 已修复的构建错误 | 3 |
| 已修复的链接器错误 | 0 |
| 已修改的文件 | 2 |
| 剩余问题 | 0 |

构建状态：PASS: 成功

```
## 常见错误修复

| 错误 | 典型修复方法 |
|-------|-------------|
| `undeclared identifier` | 添加 `#include` 或修正拼写错误 |
| `no matching function` | 修正参数类型或添加重载函数 |
| `undefined reference` | 链接库或添加实现 |
| `multiple definition` | 使用 `inline` 或移至 .cpp 文件 |
| `incomplete type` | 将前向声明替换为 `#include` |
| `no member named X` | 修正成员名称或包含头文件 |
| `cannot convert X to Y` | 添加适当的类型转换 |
| `CMake Error` | 修正 CMakeLists.txt 配置 |

## 修复策略

1. **优先处理编译错误** - 代码必须能够编译
2. **其次处理链接器错误** - 解决未定义引用
3. **第三处理警告** - 使用 `-Wall -Wextra` 进行修复
4. **一次只修复一个问题** - 验证每个更改
5. **最小化改动** - 仅修复问题，不重构代码

## 停止条件

在以下情况下，代理将停止并报告：
- 同一错误经过 3 次尝试后仍然存在
- 修复引入了更多错误
- 需要架构性更改
- 缺少外部依赖项

## 相关命令

- `/cpp-test` - 构建成功后运行测试
- `/cpp-review` - 审查代码质量
- `/verify` - 完整验证循环

## 相关

- 代理: `agents/cpp-build-resolver.md`
- 技能: `skills/cpp-coding-standards/`
```
