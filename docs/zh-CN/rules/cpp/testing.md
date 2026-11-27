---
paths:
  - "**/*.cpp"
  - "**/*.hpp"
  - "**/*.cc"
  - "**/*.hh"
  - "**/*.cxx"
  - "**/*.h"
  - "**/CMakeLists.txt"
---

# C++ 测试

> 本文档扩展了 [common/testing.md](../common/testing.md) 中关于 C++ 的特定内容。

## 框架

使用 **GoogleTest** (gtest/gmock) 配合 **CMake/CTest**。

## 运行测试

```bash
cmake --build build && ctest --test-dir build --output-on-failure
```

## 覆盖率

```bash
cmake -DCMAKE_CXX_FLAGS="--coverage" -DCMAKE_EXE_LINKER_FLAGS="--coverage" ..
cmake --build .
ctest --output-on-failure
lcov --capture --directory . --output-file coverage.info
```

## 内存消毒工具

在 CI 中应始终使用内存消毒工具运行测试：

```bash
cmake -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined" ..
```

## 参考

查看技能：`cpp-testing` 以获取详细的 C++ 测试模式、TDD 工作流以及 GoogleTest/GMock 使用指南。
