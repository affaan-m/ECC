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

# C++ 钩子

> 本文档基于 [common/hooks.md](../common/hooks.md) 扩展了 C++ 相关内容。

## 构建钩子

在提交 C++ 更改前运行以下检查：

```bash
# Format check
clang-format --dry-run --Werror src/*.cpp src/*.hpp

# Static analysis
clang-tidy src/*.cpp -- -std=c++17

# Build
cmake --build build

# Tests
ctest --test-dir build --output-on-failure
```

## 推荐的 CI 流水线

1. **clang-format** — 代码格式化检查
2. **clang-tidy** — 静态分析
3. **cppcheck** — 补充分析
4. **cmake build** — 编译
5. **ctest** — 使用清理器执行测试
